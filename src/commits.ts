import type { Commit, CommitSection, RawCommit } from './types';

export interface CommitOptions {
  excludeBots: boolean;
  includeMergeCommits: boolean;
  includePrNumbers: boolean;
  breakingChanges: boolean;
}

const CONVENTIONAL_PATTERN = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const CONVENTIONAL_CHECK = /^(\w+)(?:\([^)]+\))?!?:\s*.+$/;
const PR_PATTERN = /\s*\(#(\d+)\)\s*$/;
const BREAKING_FOOTER = /(^|\n)BREAKING CHANGE:\s*\S/;

/**
 * Bot detection works on the raw identity available from git. The commit API
 * login, when it is later resolved, follows the same `[bot]` convention.
 */
export function isBotIdentity(
  name: string | null | undefined,
  email: string | null | undefined,
  login?: string | null,
): boolean {
  return [name, email, login].some((value) => typeof value === 'string' && /\[bot\]/i.test(value));
}

export function classifyType(type: string | null): CommitSection {
  switch (type?.toLowerCase()) {
    case 'feat':
    case 'feature':
      return 'features';
    case 'fix':
    case 'bugfix':
    case 'hotfix':
      return 'fixes';
    case 'docs':
    case 'doc':
      return 'docs';
    default:
      return 'other';
  }
}

/** Parses and classifies one commit, returning null when it should be skipped. */
export function parseCommit(raw: RawCommit, options: CommitOptions): Commit | null {
  if (options.excludeBots && isBotIdentity(raw.authorName, raw.authorEmail)) {
    return null;
  }

  if (
    !options.includeMergeCommits &&
    raw.parents.length > 1 &&
    !CONVENTIONAL_CHECK.test(raw.title)
  ) {
    return null;
  }

  let desc = raw.title.trim();
  let prNumber: number | null = null;

  if (options.includePrNumbers) {
    const prMatch = PR_PATTERN.exec(desc);
    if (prMatch?.[1]) {
      prNumber = Number.parseInt(prMatch[1], 10);
      desc = desc.replace(PR_PATTERN, '').trimEnd();
    }
  }

  const match = CONVENTIONAL_PATTERN.exec(desc);
  const type = match?.[1]?.toLowerCase() ?? null;
  const scope = match?.[2] ?? null;
  const hasBang = match?.[3] === '!';
  const subject = match?.[4]?.trim() ?? desc;

  const breakingDetected = hasBang || BREAKING_FOOTER.test(raw.body);

  return {
    sha: raw.sha,
    shortSha: raw.sha.slice(0, 7),
    authorLogin: null,
    authorName: raw.authorName,
    authorEmail: raw.authorEmail,
    prNumber,
    desc,
    subject,
    scope,
    type,
    breaking: options.breakingChanges && breakingDetected,
    section: classifyType(type),
  };
}

export function collectCommits(rawCommits: RawCommit[], options: CommitOptions): Commit[] {
  return rawCommits
    .map((raw) => parseCommit(raw, options))
    .filter((commit): commit is Commit => commit !== null);
}
