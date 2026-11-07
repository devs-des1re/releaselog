import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createOctokit } from './github';

export interface PublishReleaseOptions {
  token: string;
  owner: string;
  repo: string;
  tag: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  fetchImpl?: typeof fetch;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  return (error as { status?: number }).status;
}

/**
 * Creates the release for a tag, or updates it when a release already exists.
 * This keeps re-running the action idempotent.
 */
export async function publishRelease(options: PublishReleaseOptions): Promise<string> {
  const octokit = createOctokit(options.token, options.fetchImpl);

  const updateExisting = async (releaseId: number): Promise<string> => {
    const updated = await octokit.rest.repos.updateRelease({
      owner: options.owner,
      repo: options.repo,
      release_id: releaseId,
      tag_name: options.tag,
      name: options.name,
      body: options.body,
      draft: options.draft,
      prerelease: options.prerelease,
    });
    return updated.data.html_url;
  };

  const findByTag = async (): Promise<number> => {
    const existing = await octokit.rest.repos.getReleaseByTag({
      owner: options.owner,
      repo: options.repo,
      tag: options.tag,
    });
    return existing.data.id;
  };

  try {
    return await updateExisting(await findByTag());
  } catch (error) {
    if (statusOf(error) !== 404) {
      throw error;
    }
  }

  try {
    const created = await octokit.rest.repos.createRelease({
      owner: options.owner,
      repo: options.repo,
      tag_name: options.tag,
      name: options.name,
      body: options.body,
      draft: options.draft,
      prerelease: options.prerelease,
    });
    return created.data.html_url;
  } catch (error) {
    // A concurrent run may have created the release between the 404 and POST.
    if (statusOf(error) !== 422) {
      throw error;
    }
    return updateExisting(await findByTag());
  }
}

export function writeOutputFile(path: string, markdown: string, cwd = process.cwd()): void {
  const target = resolve(cwd, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown, 'utf8');
}

/** Appends a versioned entry without disturbing existing changelog content. */
export function appendChangelog(
  path: string,
  tag: string,
  markdown: string,
  cwd = process.cwd(),
): void {
  const target = resolve(cwd, path);
  mkdirSync(dirname(target), { recursive: true });

  const entry = `## ${tag}\n\n${markdown.replace(/\s+$/, '')}\n`;
  let combined = entry;

  if (existsSync(target)) {
    const existing = readFileSync(target, 'utf8');
    if (existing.trim().length > 0) {
      combined = `${existing.trimEnd()}\n\n${entry}`;
    }
  }

  writeFileSync(target, combined, 'utf8');
}
