/** A tag as reported by `git for-each-ref`. */
export interface GitTag {
  name: string;
  sha: string;
  createdAt: string;
}

export type TagOrder = 'semver' | 'date';
export type BaseVersionGranularity = 'patch' | 'minor';
export type AiMode = 'vercel' | 'raw';
export type AiProvider = 'openai' | 'anthropic' | 'google' | 'openai-compatible';
export type AiOnError = 'fallback' | 'fail';

/** A commit exactly as read from `git log`, before classification. */
export interface RawCommit {
  sha: string;
  shortSha: string;
  parents: string[];
  title: string;
  body: string;
  authorName: string;
  authorEmail: string;
}

/** Primary changelog section for a commit. Breaking changes are additive. */
export type CommitSection = 'features' | 'fixes' | 'docs' | 'other';

/** A commit after parsing and classification. */
export interface Commit {
  sha: string;
  shortSha: string;
  authorLogin: string | null;
  authorName: string;
  authorEmail: string;
  prNumber: number | null;
  /** Display description: conventional prefix preserved, trailing PR number stripped. */
  desc: string;
  /** Description text after the conventional prefix, used for classification. */
  subject: string;
  scope: string | null;
  type: string | null;
  breaking: boolean;
  section: CommitSection;
}

/** A contributor, resolved to a login when possible. */
export interface Contributor {
  login: string | null;
  name: string;
  email: string;
  commitCount: number;
  resolved: boolean;
}

/** An author that could not be resolved to a GitHub login. */
export interface UnresolvedContributor {
  name: string;
  email: string;
  sha: string;
}

/** A commit prepared for template rendering. */
export interface RenderedCommit {
  sha: string;
  shortSha: string;
  desc: string;
  commitUrl: string;
  prNumber: number | null;
  prUrl: string | null;
  type: string | null;
  scope: string | null;
  breaking: boolean;
}

/** Template context exposed to custom Handlebars templates. */
export interface RenderContext {
  tag: string;
  previous_tag: string;
  compare_url: string;
  owner: string;
  repo: string;
  breaking_changes: RenderedCommit[];
  new_features: RenderedCommit[];
  bug_fixes: RenderedCommit[];
  docs_changes: RenderedCommit[];
  other_changes: RenderedCommit[];
  contributors: Contributor[];
}

/** Resolved tag pair for the release being generated. */
export interface TagResolution {
  currentTag: string;
  currentSha: string;
  previousTag: string;
  previousSha: string | null;
  firstRelease: boolean;
}

export interface RepoInfo {
  owner: string;
  repo: string;
}

export interface HumanizeResult {
  markdown: string;
  humanized: boolean;
}
