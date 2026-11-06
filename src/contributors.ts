import { createOctokit, type GitHubApi } from './github';

import type { Commit, Contributor, UnresolvedContributor } from './types';

export interface UserMatch {
  login: string;
  email?: string | null;
}

/** Minimal GitHub surface used by the contributor pipeline. */
export interface ContributorApi {
  getCommitAuthorLogin(sha: string): Promise<string | null>;
  searchUsersByEmail(email: string): Promise<UserMatch[]>;
  searchUsersByName(name: string): Promise<UserMatch[]>;
}

export interface ContributorResolverOptions {
  api: ContributorApi;
  requirePings?: boolean;
  fuzzyNameSearch?: boolean;
  /** Minimum gap between search API calls. 30 requests/minute by default. */
  searchIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface ContributorResolution {
  contributors: Contributor[];
  unresolved: UnresolvedContributor[];
}

export class ContributorResolutionError extends Error {
  constructor(readonly unresolved: UnresolvedContributor[]) {
    const rows = unresolved
      .map(
        (author) =>
          `| ${author.name.replace(/\|/g, '\\|')} | ${author.email.replace(/\|/g, '\\|')} | ${author.sha} |`,
      )
      .join('\n');

    super(
      `Could not resolve ${unresolved.length} contributor(s) to GitHub logins:\n\n` +
        `| Name | Email | Commit |\n| --- | --- | --- |\n${rows}`,
    );
    this.name = 'ContributorResolutionError';
  }
}

const NOREPLY_PATTERN = /^(?:\d+\+)?([^@+]+)@users\.noreply\.github\.com$/i;

/** Reads the login out of a GitHub noreply address without any network call. */
export function noreplyLogin(email: string): string | null {
  return NOREPLY_PATTERN.exec(email)?.[1] ?? null;
}

class SearchThrottle {
  private lastSearch = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly sleep: (milliseconds: number) => Promise<void>,
  ) {}

  async wait(): Promise<void> {
    if (this.intervalMs <= 0) {
      return;
    }
    const now = Date.now();
    const waitFor = this.lastSearch + this.intervalMs - now;
    if (waitFor > 0) {
      await this.sleep(waitFor);
    }
    this.lastSearch = Date.now();
  }
}

function groupByEmail(commits: Commit[]): Map<string, Commit[]> {
  const groups = new Map<string, Commit[]>();
  for (const commit of commits) {
    const key = commit.authorEmail.trim().toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.push(commit);
    } else {
      groups.set(key, [commit]);
    }
  }
  return groups;
}

async function resolveGroup(
  group: Commit[],
  api: ContributorApi,
  throttle: SearchThrottle,
  shaCache: Map<string, string | null>,
  fuzzyNameSearch: boolean,
): Promise<string | null> {
  const first = group[0];
  const email = first.authorEmail.trim();
  const noreply = noreplyLogin(email);
  if (noreply) {
    return noreply;
  }

  for (const commit of group) {
    if (shaCache.has(commit.sha)) {
      const cached = shaCache.get(commit.sha) ?? null;
      if (cached) {
        return cached;
      }
      continue;
    }

    const login = await api.getCommitAuthorLogin(commit.sha);
    shaCache.set(commit.sha, login);
    if (login) {
      return login;
    }
  }

  await throttle.wait();
  const emailMatches = await api.searchUsersByEmail(email);
  if (emailMatches[0]) {
    return emailMatches[0].login;
  }

  if (fuzzyNameSearch) {
    const name = first.authorName.trim();
    if (name) {
      await throttle.wait();
      const nameMatches = await api.searchUsersByName(name);
      if (nameMatches[0]) {
        return nameMatches[0].login;
      }
    }
  }

  return null;
}

/**
 * Resolves every unique author email through the four-step pipeline:
 * noreply regex, commit API, email search, and optional fuzzy name search.
 */
export async function resolveContributors(
  commits: Commit[],
  options: ContributorResolverOptions,
): Promise<ContributorResolution> {
  const {
    api,
    requirePings = false,
    fuzzyNameSearch = false,
    searchIntervalMs = 2000,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = options;

  const throttle = new SearchThrottle(searchIntervalMs, sleep);
  const shaCache = new Map<string, string | null>();
  const byLogin = new Map<string, Contributor>();
  const contributors: Contributor[] = [];
  const unresolved: UnresolvedContributor[] = [];

  for (const group of groupByEmail(commits).values()) {
    const first = group[0];
    const login = await resolveGroup(group, api, throttle, shaCache, fuzzyNameSearch);
    const commitCount = group.length;

    if (login) {
      const existing = byLogin.get(login);
      if (existing) {
        existing.commitCount += commitCount;
      } else {
        const contributor: Contributor = {
          login,
          name: first.authorName,
          email: first.authorEmail,
          commitCount,
          resolved: true,
        };
        byLogin.set(login, contributor);
        contributors.push(contributor);
      }
    } else {
      contributors.push({
        login: null,
        name: first.authorName,
        email: first.authorEmail,
        commitCount,
        resolved: false,
      });
      unresolved.push({
        name: first.authorName,
        email: first.authorEmail,
        sha: first.sha,
      });
    }
  }

  if (requirePings && unresolved.length > 0) {
    throw new ContributorResolutionError(unresolved);
  }

  return { contributors, unresolved };
}

function isMissingCommitError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return false;
  }
  const status = (error as { status?: unknown }).status;
  return status === 404 || status === 422;
}

/** Production adapter backed by the GitHub REST API. */
export class GitHubContributorApi implements ContributorApi {
  private readonly octokit: GitHubApi;

  constructor(
    token: string,
    private readonly owner: string,
    private readonly repo: string,
    fetchImpl?: typeof fetch,
  ) {
    this.octokit = createOctokit(token, fetchImpl);
  }

  async getCommitAuthorLogin(sha: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getCommit({
        owner: this.owner,
        repo: this.repo,
        ref: sha,
      });
      return data.author?.login ?? null;
    } catch (error) {
      if (isMissingCommitError(error)) {
        return null;
      }
      throw error;
    }
  }

  async searchUsersByEmail(email: string): Promise<UserMatch[]> {
    const { data } = await this.octokit.rest.search.users({
      q: `${email} in:email`,
      per_page: 10,
    });

    const matches: UserMatch[] = [];
    for (const item of data.items) {
      const { data: profile } = await this.octokit.rest.users.getByUsername({
        username: item.login,
      });
      if (profile.email?.toLowerCase() === email.toLowerCase()) {
        matches.push({ login: item.login, email: profile.email });
      }
    }
    return matches;
  }

  async searchUsersByName(name: string): Promise<UserMatch[]> {
    const { data } = await this.octokit.rest.search.users({
      q: `${name} in:fullname`,
      per_page: 5,
    });
    return data.items.map((item) => ({ login: item.login }));
  }
}
