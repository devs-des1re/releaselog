import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as core from '@actions/core';

import { collectCommits } from './commits';
import {
  ContributorResolutionError,
  GitHubContributorApi,
  resolveContributors,
  type ContributorResolution,
} from './contributors';
import { Git, GitError } from './git';
import { humanizeChangelog } from './humanize';
import { InputError, loadSettings, type Settings } from './inputs';
import { appendChangelog, publishRelease, writeOutputFile } from './publish';
import {
  DEFAULT_BULLET_TEMPLATE,
  buildRenderContext,
  renderChangelog,
  renderCustomTemplate,
} from './render';
import { TagResolutionError, resolvePreviousTag } from './tags';
import type { RepoInfo } from './types';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getRepoInfo(): RepoInfo {
  const slug = process.env.GITHUB_REPOSITORY ?? '';
  const [owner, repo] = slug.split('/');
  if (!owner || !repo) {
    throw new InputError('GITHUB_REPOSITORY is not set. Run this action inside GitHub Actions.');
  }
  return { owner, repo };
}

function actionRoot(): string {
  return process.env.GITHUB_ACTION_PATH || resolve(__dirname, '..');
}

function readDefaultBulletTemplate(): string {
  try {
    return readFileSync(resolve(actionRoot(), 'templates', 'default.hbs'), 'utf8').trim();
  } catch {
    return DEFAULT_BULLET_TEMPLATE;
  }
}

function readCustomTemplate(path: string): string {
  try {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
  } catch (error) {
    throw new InputError(`Could not read template-path "${path}": ${messageOf(error)}`);
  }
}

function validateHumanizeSettings(settings: Settings): void {
  if (!settings.humanize) {
    return;
  }
  if (!settings.aiApiKey.trim()) {
    throw new InputError('Input "ai-api-key" is required when humanize is true.');
  }
  if (!settings.aiModel.trim()) {
    throw new InputError('Input "ai-model" must not be empty.');
  }
  if (settings.aiProvider === 'openai-compatible' && !settings.aiEndpoint.trim()) {
    throw new InputError('Input "ai-endpoint" is required when ai-provider is openai-compatible.');
  }
}

function logUnresolvedContributors(
  unresolved: Array<{ name: string; email: string; sha: string }>,
): void {
  if (unresolved.length === 0) {
    return;
  }
  const rows = unresolved.map((author) => `- ${author.name} <${author.email}> (${author.sha})`);
  core.warning(`Could not resolve GitHub logins for these authors:\n${rows.join('\n')}`);
}

async function run(): Promise<void> {
  const settings = loadSettings();
  const { owner, repo } = getRepoInfo();

  core.setSecret(settings.token);
  if (settings.aiApiKey) {
    core.setSecret(settings.aiApiKey);
  }

  validateHumanizeSettings(settings);

  const git = new Git(undefined, process.cwd());

  if (await git.isShallow()) {
    throw new InputError(
      'A shallow clone was detected. Set fetch-depth: 0 on actions/checkout so releaselog can read tags and history.',
    );
  }

  let currentSha: string;
  try {
    currentSha = await git.resolveCommit(settings.currentTag);
  } catch (error) {
    throw new InputError(
      `Could not resolve tag "${settings.currentTag}". Ensure the checkout includes tags ` +
        `(fetch-depth: 0, fetch-tags: true) and that refs/tags/${settings.currentTag} exists. ` +
        messageOf(error),
    );
  }

  const tags = await git.listTags();
  const mainHead = await git.resolveBranchHead(settings.mainBranch);
  const devHead = await git.resolveBranchHead(settings.devBranch);

  const resolution = await resolvePreviousTag({
    currentTag: settings.currentTag,
    previousTagInput: settings.previousTagInput,
    tags,
    tagOrder: settings.tagOrder,
    baseVersionGranularity: settings.baseVersionGranularity,
    mainBranch: settings.mainBranch,
    devBranch: settings.devBranch,
    mainHead,
    devHead,
    isAncestor: (ancestor, descendant) => git.isAncestor(ancestor, descendant),
  });

  const previousTag = resolution.previousTag;
  core.info(`Resolved tags: ${previousTag || '(none)'} -> ${settings.currentTag}`);

  let rangeEnd = currentSha;
  if (settings.allowPostTagCommits) {
    const isPrerelease = settings.currentTag.includes('-');
    const branch = isPrerelease ? settings.devBranch : settings.mainBranch;
    const head = isPrerelease ? devHead : mainHead;
    if (!head) {
      throw new InputError(
        `Could not resolve the "${branch}" branch head required by allow-post-tag-commits.`,
      );
    }
    rangeEnd = head;
  }

  const revisions = previousTag ? [`${previousTag}..${rangeEnd}`] : [rangeEnd];
  const rawCommits = await git.log(revisions);
  const commits = collectCommits(rawCommits, {
    excludeBots: settings.excludeBots,
    includeMergeCommits: settings.includeMergeCommits,
    includePrNumbers: settings.includePrNumbers,
    breakingChanges: settings.breakingChanges,
  });

  core.info(`Collected ${commits.length} commit(s).`);

  const api = new GitHubContributorApi(settings.token, owner, repo);
  let contributorResult: ContributorResolution;
  try {
    contributorResult = await resolveContributors(commits, {
      api,
      requirePings: settings.requireContributorPings,
      fuzzyNameSearch: settings.fuzzyNameSearch,
    });
  } catch (error) {
    if (error instanceof ContributorResolutionError) {
      throw new InputError(error.message);
    }
    throw error;
  }
  logUnresolvedContributors(contributorResult.unresolved);

  const renderOptions = {
    tag: settings.currentTag,
    previousTag,
    owner,
    repo,
    serverUrl: process.env.GITHUB_SERVER_URL,
    commits,
    contributors: contributorResult.contributors,
    headers: settings.sectionHeaders,
  };

  let markdown = settings.templatePath
    ? renderCustomTemplate(
        readCustomTemplate(settings.templatePath),
        buildRenderContext(renderOptions),
      )
    : renderChangelog({ ...renderOptions, bulletTemplate: readDefaultBulletTemplate() });

  let humanized = false;
  if (settings.humanize && commits.length > 0) {
    try {
      const outcome = await humanizeChangelog(markdown, {
        mode: settings.aiMode,
        provider: settings.aiProvider,
        model: settings.aiModel,
        apiKey: settings.aiApiKey,
        endpoint: settings.aiEndpoint,
        temperature: settings.aiTemperature,
        systemPrompt: settings.aiSystemPrompt,
        onError: settings.aiOnError,
        onWarning: (message) => core.warning(message),
      });
      markdown = outcome.markdown;
      humanized = outcome.humanized;
    } catch (error) {
      throw new InputError(messageOf(error));
    }
  }

  core.setOutput('changelog', markdown);
  core.setOutput('previous-tag', previousTag);
  core.setOutput('current-tag', settings.currentTag);
  core.setOutput('humanized', humanized.toString());
  core.setOutput('release-url', '');

  let releaseUrl = '';
  if (!settings.dryRun && settings.publish) {
    const prerelease =
      settings.releasePrerelease === 'auto'
        ? settings.currentTag.includes('-')
        : settings.releasePrerelease;

    releaseUrl = await publishRelease({
      token: settings.token,
      owner,
      repo,
      tag: settings.currentTag,
      name: settings.releaseName,
      body: markdown,
      draft: settings.releaseDraft,
      prerelease,
    });
    core.info(`Published release: ${releaseUrl}`);
  }

  if (settings.outputFile) {
    writeOutputFile(settings.outputFile, markdown);
    core.info(`Wrote ${settings.outputFile}.`);
  }

  if (settings.changelogFile) {
    appendChangelog(settings.changelogFile, settings.currentTag, markdown);
    core.info(`Appended to ${settings.changelogFile}.`);
  }

  core.setOutput('release-url', releaseUrl);
}

run().catch((error: unknown) => {
  if (error instanceof GitError) {
    core.setFailed(error.message);
    return;
  }
  if (error instanceof TagResolutionError || error instanceof InputError) {
    core.setFailed(error.message);
    return;
  }
  core.setFailed(messageOf(error));
});
