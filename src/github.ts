import { getOctokit } from '@actions/github';

export interface GitHubUser {
  login: string;
}

export interface GitHubProfile {
  email?: string | null;
}

export interface GitHubCommit {
  author?: { login?: string } | null;
}

export interface GitHubRelease {
  id: number;
  html_url: string;
}

/** The small, stable slice of Octokit that releaselog relies on. */
export interface GitHubApi {
  rest: {
    repos: {
      getCommit(params: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: GitHubCommit }>;
      getReleaseByTag(params: {
        owner: string;
        repo: string;
        tag: string;
      }): Promise<{ data: GitHubRelease }>;
      createRelease(params: {
        owner: string;
        repo: string;
        tag_name: string;
        name: string;
        body: string;
        draft: boolean;
        prerelease: boolean;
      }): Promise<{ data: GitHubRelease }>;
      updateRelease(params: {
        owner: string;
        repo: string;
        release_id: number;
        tag_name: string;
        name: string;
        body: string;
        draft: boolean;
        prerelease: boolean;
      }): Promise<{ data: GitHubRelease }>;
    };
    search: {
      users(params: { q: string; per_page: number }): Promise<{ data: { items: GitHubUser[] } }>;
    };
    users: {
      getByUsername(params: { username: string }): Promise<{ data: GitHubProfile }>;
    };
  };
}

/**
 * The published Octokit types do not resolve cleanly under every TypeScript
 * resolution mode, so the client is narrowed to the interface above.
 */
export function createOctokit(token: string, fetchImpl?: typeof fetch): GitHubApi {
  const options = fetchImpl ? { request: { fetch: fetchImpl } } : undefined;
  const factory = getOctokit as (auth: string, clientOptions?: unknown) => unknown;
  return factory(token, options) as GitHubApi;
}
