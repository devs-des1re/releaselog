import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyType, collectCommits, isBotIdentity, type CommitOptions } from '../src/commits';
import type { CommitSection, RawCommit } from '../src/types';

const defaults: CommitOptions = {
  excludeBots: false,
  includeMergeCommits: true,
  includePrNumbers: true,
  breakingChanges: false,
};

function withOptions(overrides: Partial<CommitOptions> = {}): CommitOptions {
  return { ...defaults, ...overrides };
}

function raw(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    sha: 'abc1234',
    shortSha: 'abc1234',
    parents: ['0000000'],
    title: 'feat: add a feature',
    body: '',
    authorName: 'Arjun',
    authorEmail: 'arjun@example.com',
    ...overrides,
  };
}

function fixtureCommits(): RawCommit[] {
  const contents = readFileSync(resolvePath('tests/fixtures/commits.json'), 'utf8');
  return JSON.parse(contents) as RawCommit[];
}

describe('classifyType', () => {
  it('maps every supported conventional type to its section', () => {
    const cases: Array<[string, CommitSection]> = [
      ['feat', 'features'],
      ['feature', 'features'],
      ['fix', 'fixes'],
      ['bugfix', 'fixes'],
      ['hotfix', 'fixes'],
      ['docs', 'docs'],
      ['doc', 'docs'],
      ['chore', 'other'],
      ['refactor', 'other'],
    ];

    for (const [type, section] of cases) {
      expect(classifyType(type)).toBe(section);
    }
    expect(classifyType(null)).toBe('other');
  });
});

describe('parseCommit', () => {
  it('preserves the conventional prefix and scope in the display description', () => {
    const [commit] = collectCommits(
      [raw({ title: 'feat(api): add rate limiting (#12)' })],
      withOptions(),
    );

    expect(commit).toMatchObject({
      type: 'feat',
      scope: 'api',
      subject: 'add rate limiting',
      desc: 'feat(api): add rate limiting',
      prNumber: 12,
      section: 'features',
    });
  });

  it('leaves PR numbers in place when extraction is disabled', () => {
    const [commit] = collectCommits(
      [raw({ title: 'fix: repair cache (#9)' })],
      withOptions({ includePrNumbers: false }),
    );

    expect(commit).toMatchObject({
      desc: 'fix: repair cache (#9)',
      subject: 'repair cache (#9)',
      prNumber: null,
    });
  });

  it('only extracts a trailing PR number', () => {
    const [commit] = collectCommits(
      [raw({ title: 'fix: repair cache (#9) (#10)' })],
      withOptions(),
    );

    expect(commit).toMatchObject({
      desc: 'fix: repair cache (#9)',
      prNumber: 10,
    });
  });

  it('flags a bang as breaking only when breaking changes are enabled', () => {
    const enabled = collectCommits(
      [raw({ title: 'feat!: drop Node 18 support' })],
      withOptions({ breakingChanges: true }),
    );
    const disabled = collectCommits([raw({ title: 'feat!: drop Node 18 support' })], withOptions());

    expect(enabled[0]?.breaking).toBe(true);
    expect(enabled[0]?.section).toBe('features');
    expect(disabled[0]?.breaking).toBe(false);
  });

  it('flags a BREAKING CHANGE footer as breaking when enabled', () => {
    const [commit] = collectCommits(
      [
        raw({
          title: 'fix: rename config key',
          body: 'Some context.\n\nBREAKING CHANGE: config files must use the new key.',
        }),
      ],
      withOptions({ breakingChanges: true }),
    );

    expect(commit).toMatchObject({ breaking: true, section: 'fixes' });
  });

  it('treats commits without a conventional prefix as other changes', () => {
    const [commit] = collectCommits([raw({ title: 'Update README wording' })], withOptions());

    expect(commit).toMatchObject({
      type: null,
      scope: null,
      subject: 'Update README wording',
      desc: 'Update README wording',
      section: 'other',
    });
  });

  it('excludes bot authors when requested', () => {
    const commits = [
      raw({
        title: 'chore: bump deps',
        authorName: 'dependabot[bot]',
        authorEmail: '49699333+dependabot[bot]@users.noreply.github.com',
      }),
      raw({
        title: 'chore: bump other deps',
        authorName: 'Renovate Bot',
        authorEmail: 'renovate[bot]@users.noreply.github.com',
      }),
      raw({ title: 'chore: human change' }),
    ];

    expect(collectCommits(commits, withOptions({ excludeBots: true }))).toHaveLength(1);
    expect(collectCommits(commits, withOptions())).toHaveLength(3);
  });

  it('drops non-conventional merge commits when merge commits are disabled', () => {
    const merge = raw({
      title: 'Merge pull request #21 from dev',
      parents: ['aaaa', 'bbbb'],
    });
    const conventionalMerge = raw({
      title: 'feat: merge release branch',
      parents: ['cccc', 'dddd'],
    });

    const filtered = collectCommits(
      [merge, conventionalMerge],
      withOptions({ includeMergeCommits: false }),
    );
    expect(filtered.map((commit) => commit.desc)).toEqual(['feat: merge release branch']);

    const unfiltered = collectCommits([merge, conventionalMerge], withOptions());
    expect(unfiltered).toHaveLength(2);
  });
});

describe('isBotIdentity', () => {
  it('matches bot logins and noreply bot emails', () => {
    expect(isBotIdentity('dependabot[bot]', 'dependabot@example.com')).toBe(true);
    expect(isBotIdentity('Renovate', 'renovate[bot]@users.noreply.github.com')).toBe(true);
    expect(isBotIdentity('Arjun', 'arjun@example.com')).toBe(false);
    expect(isBotIdentity('Arjun', 'arjun@example.com', 'arjun')).toBe(false);
    expect(isBotIdentity('Arjun', 'arjun@example.com', 'release[bot]')).toBe(true);
  });
});

describe('collectCommits with fixtures', () => {
  it('parses the full fixture set into the expected sections', () => {
    const commits = collectCommits(fixtureCommits(), withOptions());
    const counts = commits.reduce<Record<CommitSection, number>>(
      (accumulator, commit) => {
        accumulator[commit.section] += 1;
        return accumulator;
      },
      { features: 0, fixes: 0, docs: 0, other: 0 },
    );

    expect(commits).toHaveLength(16);
    expect(counts).toEqual({ features: 5, fixes: 5, docs: 2, other: 4 });
  });

  it('applies bot and merge filters together', () => {
    const commits = collectCommits(
      fixtureCommits(),
      withOptions({ excludeBots: true, includeMergeCommits: false }),
    );

    expect(commits).toHaveLength(14);
    expect(commits.some((commit) => commit.authorName.includes('[bot]'))).toBe(false);
    expect(commits.some((commit) => commit.desc.startsWith('Merge pull request'))).toBe(false);
  });

  it('marks both breaking fixtures without moving them out of their sections', () => {
    const commits = collectCommits(fixtureCommits(), withOptions({ breakingChanges: true }));
    const breaking = commits.filter((commit) => commit.breaking);

    expect(breaking.map((commit) => commit.sha)).toEqual(['a1b2c3e', 'a1b2c3f']);
    expect(breaking.map((commit) => commit.section)).toEqual(['features', 'fixes']);
  });
});
