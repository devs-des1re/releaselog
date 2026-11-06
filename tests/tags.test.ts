import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TagResolutionError, resolvePreviousTag, type TagResolverOptions } from '../src/tags';
import type { GitTag } from '../src/types';

let shaCounter = 0;

function tag(name: string, createdAt = '2025-01-01T00:00:00Z'): GitTag {
  shaCounter += 1;
  return {
    name,
    createdAt,
    sha: shaCounter.toString(16).padStart(40, '0'),
  };
}

const noAncestry = (): Promise<boolean> => Promise.resolve(false);

function ancestry(edges: string[]): (ancestor: string, descendant: string) => Promise<boolean> {
  return (ancestor, descendant) => Promise.resolve(edges.includes(`${ancestor}->${descendant}`));
}

function fixtureTags(): GitTag[] {
  const contents = readFileSync(resolvePath('tests/fixtures/tags.txt'), 'utf8');
  return contents
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const [name, createdAt] = line.split('\t');
      return {
        name,
        createdAt,
        sha: index.toString(16).padStart(40, '0'),
      };
    });
}

function resolveTag(
  overrides: Partial<TagResolverOptions> & Pick<TagResolverOptions, 'currentTag' | 'tags'>,
): ReturnType<typeof resolvePreviousTag> {
  return resolvePreviousTag({
    isAncestor: noAncestry,
    mainHead: 'main-head',
    devHead: 'dev-head',
    ...overrides,
  });
}

describe('resolvePreviousTag', () => {
  it('picks the highest earlier pre-release of the same patch base', async () => {
    const result = await resolveTag({
      currentTag: 'v0.2.0-beta.3',
      tags: [tag('v0.1.0'), tag('v0.2.0-alpha.1'), tag('v0.2.0-beta.1'), tag('v0.2.0-beta.2')],
    });

    expect(result).toEqual({ previousTag: 'v0.2.0-beta.2', firstRelease: false });
  });

  it('falls back to the stable release of the same patch base', async () => {
    const result = await resolveTag({
      currentTag: 'v0.2.0-beta.1',
      tags: [tag('v0.1.0'), tag('v0.2.0')],
    });

    expect(result).toEqual({ previousTag: 'v0.2.0', firstRelease: false });
  });

  it('groups pre-releases by minor version when granularity is minor', async () => {
    const result = await resolveTag({
      currentTag: 'v0.2.0-beta.3',
      baseVersionGranularity: 'minor',
      tags: [tag('v0.2.0-beta.2'), tag('v0.2.1-beta.1'), tag('v0.3.0-beta.1')],
    });

    expect(result).toEqual({ previousTag: 'v0.2.1-beta.1', firstRelease: false });
  });

  it('finds the stable release of a minor base when no pre-releases exist', async () => {
    const result = await resolveTag({
      currentTag: 'v0.2.0-rc.1',
      baseVersionGranularity: 'minor',
      tags: [tag('v0.2.1'), tag('v0.3.0')],
    });

    expect(result).toEqual({ previousTag: 'v0.2.1', firstRelease: false });
  });

  it('falls back to a stable ancestor reachable from the dev branch', async () => {
    const result = await resolveTag({
      currentTag: 'v0.3.0-rc.1',
      tags: [tag('v0.1.0'), tag('v0.2.0'), tag('v0.2.5'), tag('v0.4.0')],
      isAncestor: ancestry([
        'v0.1.0->v0.3.0-rc.1',
        'v0.1.0->dev-head',
        'v0.2.0->v0.3.0-rc.1',
        'v0.2.0->dev-head',
        'v0.2.5->v0.3.0-rc.1',
      ]),
    });

    expect(result).toEqual({ previousTag: 'v0.2.0', firstRelease: false });
  });

  it('returns first-release mode when a pre-release has no earlier tag', async () => {
    const result = await resolveTag({ currentTag: 'v0.5.0-beta.1', tags: [] });

    expect(result).toEqual({ previousTag: '', firstRelease: true });
  });

  it('picks a stable ancestor reachable from the main branch', async () => {
    const result = await resolveTag({
      currentTag: 'v1.1.0',
      tags: [tag('v1.0.0'), tag('v0.9.0'), tag('v1.1.0-rc.1')],
      isAncestor: ancestry([
        'v1.0.0->v1.1.0',
        'v1.0.0->main-head',
        'v0.9.0->v1.1.0',
        'v0.9.0->main-head',
        'v1.1.0-rc.1->v1.1.0',
      ]),
    });

    expect(result).toEqual({ previousTag: 'v1.0.0', firstRelease: false });
  });

  it('excludes stable tags that are not reachable from the main branch', async () => {
    const result = await resolveTag({
      currentTag: 'v1.1.0',
      tags: [tag('v1.0.0'), tag('v0.9.0')],
      isAncestor: ancestry(['v0.9.0->v1.1.0', 'v0.9.0->main-head', 'v1.0.0->v1.1.0']),
    });

    expect(result).toEqual({ previousTag: 'v0.9.0', firstRelease: false });
  });

  it('ignores pre-release tags for stable releases', async () => {
    const result = await resolveTag({
      currentTag: 'v1.0.0',
      tags: [tag('v0.9.0-rc.1')],
      isAncestor: ancestry(['v0.9.0-rc.1->v1.0.0', 'v0.9.0-rc.1->main-head']),
    });

    expect(result).toEqual({ previousTag: '', firstRelease: true });
  });

  it('uses a supplied previous tag verbatim, even when it does not exist', async () => {
    const result = await resolveTag({
      currentTag: 'v1.0.0',
      previousTagInput: 'custom-previous-tag',
      tags: [],
      mainHead: null,
    });

    expect(result).toEqual({ previousTag: 'custom-previous-tag', firstRelease: false });
  });

  it('sorts by creation date when tag order is date', async () => {
    const tags = [tag('v0.2.0', '2025-01-01T00:00:00Z'), tag('v0.1.9', '2025-06-01T00:00:00Z')];
    const edges = ancestry([
      'v0.2.0->v1.0.0',
      'v0.2.0->main-head',
      'v0.1.9->v1.0.0',
      'v0.1.9->main-head',
    ]);

    const byDate = await resolveTag({
      currentTag: 'v1.0.0',
      tagOrder: 'date',
      tags,
      isAncestor: edges,
    });
    const bySemver = await resolveTag({ currentTag: 'v1.0.0', tags, isAncestor: edges });

    expect(byDate).toEqual({ previousTag: 'v0.1.9', firstRelease: false });
    expect(bySemver).toEqual({ previousTag: 'v0.2.0', firstRelease: false });
  });

  it('resolves against the fixture tag list', async () => {
    const result = await resolveTag({
      currentTag: 'v0.3.0-rc.1',
      tags: fixtureTags(),
    });

    expect(result).toEqual({ previousTag: 'v0.3.0', firstRelease: false });
  });

  it('fails when the main branch cannot be resolved and stable tags exist', async () => {
    await expect(
      resolveTag({
        currentTag: 'v1.0.0',
        tags: [tag('v0.9.0')],
        mainHead: null,
      }),
    ).rejects.toBeInstanceOf(TagResolutionError);
  });

  it('fails when the dev branch cannot be resolved and a fallback is needed', async () => {
    await expect(
      resolveTag({
        currentTag: 'v0.3.0-rc.1',
        tags: [tag('v0.2.0')],
        devHead: null,
      }),
    ).rejects.toBeInstanceOf(TagResolutionError);
  });
});
