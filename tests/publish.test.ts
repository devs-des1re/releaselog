import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { appendChangelog, publishRelease, writeOutputFile } from '../src/publish';

const repositoryUrl = 'https://api.github.com/repos/acme/repo';
const releaseUrl = 'https://github.com/acme/repo/releases/tag/v1.0.0';

const server = setupServer();
let createBody: Record<string, unknown> | undefined;
let updateBody: Record<string, unknown> | undefined;

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});

beforeEach(() => {
  createBody = undefined;
  updateBody = undefined;
  server.use(
    http.get(`${repositoryUrl}/releases/tags/:tag`, () =>
      HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
    ),
    http.post(`${repositoryUrl}/releases`, async ({ request }) => {
      createBody = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ html_url: releaseUrl }, { status: 201 });
    }),
    http.patch(`${repositoryUrl}/releases/:id`, async ({ request }) => {
      updateBody = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ html_url: releaseUrl });
    }),
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

function publish(overrides: Partial<Parameters<typeof publishRelease>[0]> = {}) {
  return publishRelease({
    token: 'test-token',
    owner: 'acme',
    repo: 'repo',
    tag: 'v1.0.0',
    name: 'v1.0.0',
    body: '## Changes\n\n- feat: ship it',
    draft: false,
    prerelease: false,
    fetchImpl: (input, init) => fetch(input, init),
    ...overrides,
  });
}

describe('publishRelease', () => {
  it('creates a release when none exists for the tag', async () => {
    await expect(publish()).resolves.toBe(releaseUrl);

    expect(createBody).toMatchObject({
      tag_name: 'v1.0.0',
      name: 'v1.0.0',
      body: '## Changes\n\n- feat: ship it',
      draft: false,
      prerelease: false,
    });
    expect(updateBody).toBeUndefined();
  });

  it('updates an existing release instead of creating another one', async () => {
    server.use(
      http.get(`${repositoryUrl}/releases/tags/:tag`, () =>
        HttpResponse.json({ id: 123, html_url: releaseUrl }),
      ),
    );

    await expect(publish({ draft: true, prerelease: true, name: 'Release v1.0.0' })).resolves.toBe(
      releaseUrl,
    );

    expect(updateBody).toMatchObject({
      tag_name: 'v1.0.0',
      name: 'Release v1.0.0',
      draft: true,
      prerelease: true,
    });
    expect(createBody).toBeUndefined();
  });

  it('updates the release when a concurrent create wins the race', async () => {
    let gets = 0;
    server.use(
      http.get(`${repositoryUrl}/releases/tags/:tag`, () => {
        gets += 1;
        return gets === 1
          ? HttpResponse.json({ message: 'Not Found' }, { status: 404 })
          : HttpResponse.json({ id: 456, html_url: releaseUrl });
      }),
      http.post(`${repositoryUrl}/releases`, () =>
        HttpResponse.json({ message: 'already_exists' }, { status: 422 }),
      ),
    );

    await expect(publish({ name: 'Raced release' })).resolves.toBe(releaseUrl);

    expect(createBody).toBeUndefined();
    expect(updateBody).toMatchObject({
      tag_name: 'v1.0.0',
      name: 'Raced release',
    });
  });

  it('surfaces non-404 API errors', async () => {
    server.use(
      http.get(`${repositoryUrl}/releases/tags/:tag`, () =>
        HttpResponse.json({ message: 'Server Error' }, { status: 500 }),
      ),
    );

    await expect(publish()).rejects.toBeTruthy();
  });
});

describe('file output', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'releaselog-publish-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('writes the output file and creates parent directories', () => {
    writeOutputFile('nested/release.md', '## Changes\n\n- x\n', directory);

    expect(readFileSync(join(directory, 'nested/release.md'), 'utf8')).toBe('## Changes\n\n- x\n');
  });

  it('creates a changelog with a versioned entry when absent', () => {
    appendChangelog('CHANGELOG.md', 'v1.0.0', '## Changes\n\n- x\n', directory);

    expect(readFileSync(join(directory, 'CHANGELOG.md'), 'utf8')).toBe(
      '## v1.0.0\n\n## Changes\n\n- x\n',
    );
  });

  it('appends a versioned entry to an existing changelog with a blank-line separator', () => {
    writeFileSync(join(directory, 'CHANGELOG.md'), '# Changelog\n', 'utf8');

    appendChangelog('CHANGELOG.md', 'v1.1.0', '## Changes\n\n- y\n', directory);

    expect(readFileSync(join(directory, 'CHANGELOG.md'), 'utf8')).toBe(
      '# Changelog\n\n## v1.1.0\n\n## Changes\n\n- y\n',
    );
  });
});
