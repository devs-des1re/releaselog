import Handlebars from 'handlebars';

import type { Commit, Contributor, RenderedCommit, RenderContext, SectionHeaders } from './types';

export interface RenderOptions {
  tag: string;
  previousTag: string;
  owner: string;
  repo: string;
  serverUrl?: string;
  commits: Commit[];
  contributors: Contributor[];
  headers?: Partial<SectionHeaders>;
  bulletTemplate?: string;
}

export const DEFAULT_BULLET_TEMPLATE =
  '- {{desc}} ([{{shortSha}}]({{commitUrl}})){{#if prNumber}} ([#{{prNumber}}]({{prUrl}})){{/if}}';

export const DEFAULT_HEADERS: SectionHeaders = {
  breaking: 'Breaking Changes',
  features: 'New Features',
  fixes: 'Bug Fixes',
  docs: 'Docs Changes',
  other: 'Other Changes',
};

/** Escapes the Markdown characters that can corrupt a rendered bullet. */
export function escapeMarkdown(value: string): string {
  return value.replace(/([*_`<>])/g, '\\$1');
}

function compareContributors(a: Contributor, b: Contributor): number {
  if (a.commitCount !== b.commitCount) {
    return b.commitCount - a.commitCount;
  }
  const aName = a.login ?? a.name;
  const bName = b.login ?? b.name;
  return aName.localeCompare(bName);
}

function toRenderedCommit(commit: Commit, repositoryUrl: string): RenderedCommit {
  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    desc: escapeMarkdown(commit.desc),
    commitUrl: `${repositoryUrl}/commit/${commit.sha}`,
    prNumber: commit.prNumber,
    prUrl: commit.prNumber === null ? null : `${repositoryUrl}/pull/${commit.prNumber}`,
    type: commit.type,
    scope: commit.scope,
    breaking: commit.breaking,
  };
}

export function buildRenderContext(options: RenderOptions): RenderContext {
  const serverUrl = (options.serverUrl ?? 'https://github.com').replace(/\/+$/, '');
  const repositoryUrl = `${serverUrl}/${options.owner}/${options.repo}`;
  const headers: SectionHeaders = { ...DEFAULT_HEADERS, ...options.headers };
  const nonBreaking = options.commits.filter((commit) => !commit.breaking);
  const inSection = (section: Commit['section']): RenderedCommit[] =>
    nonBreaking
      .filter((commit) => commit.section === section)
      .map((commit) => toRenderedCommit(commit, repositoryUrl));

  return {
    tag: options.tag,
    previous_tag: options.previousTag,
    compare_url: options.previousTag
      ? `${repositoryUrl}/compare/${options.previousTag}...${options.tag}`
      : `${repositoryUrl}/commits/${options.tag}`,
    owner: options.owner,
    repo: options.repo,
    server_url: serverUrl,
    section_headers: headers,
    breaking_changes: options.commits
      .filter((commit) => commit.breaking)
      .map((commit) => toRenderedCommit(commit, repositoryUrl)),
    new_features: inSection('features'),
    bug_fixes: inSection('fixes'),
    docs_changes: inSection('docs'),
    other_changes: inSection('other'),
    contributors: [...options.contributors].sort(compareContributors),
  };
}

function contributorLine(contributor: Contributor): string {
  const who = contributor.login ? `@${contributor.login}` : escapeMarkdown(contributor.name);
  return `- ${who} has made ${contributor.commitCount} commit(s)`;
}

function ensureTrailingNewline(value: string): string {
  return `${value.replace(/\s+$/, '')}\n`;
}

/** Renders the built-in changelog format. */
export function renderChangelog(options: RenderOptions): string {
  const context = buildRenderContext(options);
  const headers = context.section_headers;

  if (options.commits.length === 0) {
    const placeholder = options.previousTag
      ? `_No changes since ${options.previousTag}._`
      : '_No changes._';
    return `${placeholder}\n\n## Full Change Log\n${context.compare_url}\n`;
  }

  const bullet = Handlebars.compile<RenderedCommit>(
    options.bulletTemplate ?? DEFAULT_BULLET_TEMPLATE,
    { noEscape: true },
  );

  const blocks: string[] = ['## Changes'];

  const addSection = (header: string, commits: RenderedCommit[]): void => {
    if (commits.length === 0) {
      return;
    }
    const lines = commits.map((commit) => bullet(commit).trimEnd());
    blocks.push(`### ${header}\n${lines.join('\n')}`);
  };

  addSection(headers.breaking, context.breaking_changes);
  addSection(headers.features, context.new_features);
  addSection(headers.fixes, context.bug_fixes);
  addSection(headers.docs, context.docs_changes);
  addSection(headers.other, context.other_changes);

  if (context.contributors.length > 0) {
    blocks.push(`## Contributors\n${context.contributors.map(contributorLine).join('\n')}`);
  }

  blocks.push(`## Full Change Log\n${context.compare_url}`);

  return ensureTrailingNewline(blocks.join('\n\n'));
}

/** Renders a user-supplied full-document Handlebars template. */
export function renderCustomTemplate(source: string, context: RenderContext): string {
  const template = Handlebars.compile<RenderContext>(source, { noEscape: true });
  return ensureTrailingNewline(template(context));
}
