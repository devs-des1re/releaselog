import semver from 'semver';

import type { BaseVersionGranularity, GitTag, TagOrder } from './types';

export interface TagResolverOptions {
  currentTag: string;
  tags: GitTag[];
  /** Explicit override. Used verbatim, with no validation. */
  previousTagInput?: string;
  tagOrder?: TagOrder;
  baseVersionGranularity?: BaseVersionGranularity;
  mainBranch?: string;
  devBranch?: string;
  mainHead?: string | null;
  devHead?: string | null;
  isAncestor: (ancestor: string, descendant: string) => Promise<boolean>;
}

export interface PreviousTagResult {
  previousTag: string;
  firstRelease: boolean;
}

export class TagResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TagResolutionError';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function baseVersion(currentTag: string, granularity: BaseVersionGranularity): string {
  const stablePart = currentTag.split('-')[0];
  if (granularity === 'patch') {
    return stablePart;
  }
  return stablePart.split('.').slice(0, 2).join('.');
}

/** Newest first. Invalid semver tags sort after valid ones. */
export function compareTags(a: GitTag, b: GitTag, order: TagOrder): number {
  if (order === 'date') {
    const aDate = Date.parse(a.createdAt);
    const bDate = Date.parse(b.createdAt);
    if (!Number.isNaN(aDate) && !Number.isNaN(bDate) && aDate !== bDate) {
      return bDate - aDate;
    }
  }

  const aVersion = semver.parse(a.name);
  const bVersion = semver.parse(b.name);
  if (aVersion && bVersion) {
    return semver.rcompare(aVersion, bVersion);
  }
  if (aVersion) {
    return -1;
  }
  if (bVersion) {
    return 1;
  }
  return a.name.localeCompare(b.name);
}

function isStable(tag: GitTag): boolean {
  return !tag.name.includes('-');
}

function isStableBase(name: string, base: string, granularity: BaseVersionGranularity): boolean {
  if (name.includes('-')) {
    return false;
  }
  if (granularity === 'patch') {
    return name === base;
  }
  if (name === base) {
    return true;
  }
  return new RegExp(`^${escapeRegExp(base)}\\.\\d+$`).test(name);
}

/**
 * A pre-release belongs to the base when its stable part is the base itself.
 * With minor granularity, `v0.2.0-beta.1` and `v0.2.1-beta.1` both belong to
 * `v0.2`, even though their text does not literally start with `v0.2-`.
 */
function isPrereleaseOfBase(
  name: string,
  base: string,
  granularity: BaseVersionGranularity,
): boolean {
  if (!name.includes('-')) {
    return false;
  }
  if (granularity === 'patch') {
    return name.startsWith(`${base}-`);
  }
  const stablePart = name.split('-')[0];
  return stablePart === base || stablePart.startsWith(`${base}.`);
}

function requireBranchHead(head: string | null | undefined, branch: string): string {
  if (!head) {
    throw new TagResolutionError(
      `Could not resolve the "${branch}" branch. Fetch it or set the branch input explicitly.`,
    );
  }
  return head;
}

/**
 * Resolves the tag immediately preceding `currentTag`.
 *
 * Pre-release tags prefer an earlier pre-release of the same base version, then
 * the stable release of that base, then the newest stable ancestor reachable
 * from the dev branch. Stable tags only consider stable ancestors reachable
 * from the main branch.
 */
export async function resolvePreviousTag(options: TagResolverOptions): Promise<PreviousTagResult> {
  const { currentTag, tags, isAncestor } = options;
  if (!currentTag.trim()) {
    throw new TagResolutionError('A current tag is required to resolve the previous tag.');
  }

  const explicit = options.previousTagInput?.trim();
  if (explicit) {
    return { previousTag: explicit, firstRelease: false };
  }

  const order = options.tagOrder ?? 'semver';
  const granularity = options.baseVersionGranularity ?? 'patch';
  const sorted = [...tags].sort((a, b) => compareTags(a, b, order));
  const firstRelease: PreviousTagResult = { previousTag: '', firstRelease: true };

  if (currentTag.includes('-')) {
    const base = baseVersion(currentTag, granularity);

    const earlierPrereleases = sorted.filter(
      (tag) => tag.name !== currentTag && isPrereleaseOfBase(tag.name, base, granularity),
    );
    if (earlierPrereleases[0]) {
      return { previousTag: earlierPrereleases[0].name, firstRelease: false };
    }

    const stableBase = sorted.filter(
      (tag) => tag.name !== currentTag && isStableBase(tag.name, base, granularity),
    );
    if (stableBase[0]) {
      return { previousTag: stableBase[0].name, firstRelease: false };
    }

    const stableTags = sorted.filter((tag) => tag.name !== currentTag && isStable(tag));
    if (stableTags.length === 0) {
      return firstRelease;
    }

    const devBranch = options.devBranch ?? 'dev';
    const devHead = requireBranchHead(options.devHead, devBranch);
    for (const tag of stableTags) {
      if ((await isAncestor(tag.name, currentTag)) && (await isAncestor(tag.name, devHead))) {
        return { previousTag: tag.name, firstRelease: false };
      }
    }

    return firstRelease;
  }

  const stableTags = sorted.filter((tag) => tag.name !== currentTag && isStable(tag));
  if (stableTags.length === 0) {
    return firstRelease;
  }

  const mainBranch = options.mainBranch ?? 'main';
  const mainHead = requireBranchHead(options.mainHead, mainBranch);
  for (const tag of stableTags) {
    if ((await isAncestor(tag.name, currentTag)) && (await isAncestor(tag.name, mainHead))) {
      return { previousTag: tag.name, firstRelease: false };
    }
  }

  return firstRelease;
}
