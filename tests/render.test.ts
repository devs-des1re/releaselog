import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BULLET_TEMPLATE,
  buildRenderContext,
  escapeMarkdown,
  renderChangelog,
  renderCustomTemplate,
  type RenderOptions,
} from '../src/render';
import type { Commit, Contributor } from '../src/types';

const owner = 'devs-des1re';
const repo = 'releaselog';

function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    sha: 'a1b2c3d',
    shortSha: 'a1b2c3d',
    authorLogin: 'devs-des1re',
    authorName: 'Arjun',
    authorEmail: 'arjun@example.com',
    prNumber: null,
    desc: 'feat: add a feature',
    subject: 'add a feature',
    scope: null,
    type: 'feat',
    breaking: false,
    section: 'features',
    ...overrides,
  };
}

function contributor(overrides: Partial<Contributor> = {}): Contributor {
  return {
    login: 'devs-des1re',
    name: 'Arjun',
    email: 'arjun@example.com',
    commitCount: 1,
    resolved: true,
    ...overrides,
  };
}

function render(overrides: Partial<RenderOptions> = {}): string {
  return renderChangelog({
    tag: 'v0.2.0',
    previousTag: 'v0.1.0',
    owner,
    repo,
    commits: [],
    contributors: [],
    ...overrides,
  });
}

describe('escapeMarkdown', () => {
  it('escapes the supported Markdown characters', () => {
    expect(escapeMarkdown('* _ ` < >')).toBe('\\* \\_ \\` \\< \\>');
    expect(escapeMarkdown('plain text')).toBe('plain text');
  });
});

describe('renderChangelog', () => {
  it('renders the full default document exactly', () => {
    const output = render({
      commits: [
        commit({
          sha: 'a1b2c3d',
          shortSha: 'a1b2c3d',
          desc: 'feat!: drop Node 18 support',
          type: 'feat',
          breaking: true,
          section: 'features',
          prNumber: 7,
        }),
        commit({
          sha: 'b79fd70',
          shortSha: 'b79fd70',
          desc: 'feat: show PR numbers in release changelog',
          section: 'features',
          prNumber: 2,
        }),
        commit({
          sha: 'c1ab51f',
          shortSha: 'c1ab51f',
          desc: 'fix: build pre releases from the dev branch',
          type: 'fix',
          section: 'fixes',
          prNumber: 3,
        }),
        commit({
          sha: 'e9f0a1b',
          shortSha: 'e9f0a1b',
          desc: 'fix: correct typo in error message',
          type: 'fix',
          section: 'fixes',
        }),
        commit({
          sha: 'd85cc0e',
          shortSha: 'd85cc0e',
          desc: 'docs: add security policy',
          type: 'docs',
          section: 'docs',
          prNumber: 2,
        }),
        commit({
          sha: '464d4eb',
          shortSha: '464d4eb',
          desc: 'chore: removed supported versions',
          type: 'chore',
          section: 'other',
          prNumber: 2,
        }),
      ],
      contributors: [
        contributor({ login: 'devs-des1re', commitCount: 12 }),
        contributor({ login: 'other', commitCount: 3 }),
        contributor({
          login: null,
          name: 'Mystery Person',
          email: 'mystery@example.com',
          commitCount: 1,
          resolved: false,
        }),
      ],
    });

    expect(output).toBe(
      `## Changes

### Breaking Changes
- feat!: drop Node 18 support ([a1b2c3d](https://github.com/devs-des1re/releaselog/commit/a1b2c3d)) ([#7](https://github.com/devs-des1re/releaselog/pull/7))

### New Features
- feat: show PR numbers in release changelog ([b79fd70](https://github.com/devs-des1re/releaselog/commit/b79fd70)) ([#2](https://github.com/devs-des1re/releaselog/pull/2))

### Bug Fixes
- fix: build pre releases from the dev branch ([c1ab51f](https://github.com/devs-des1re/releaselog/commit/c1ab51f)) ([#3](https://github.com/devs-des1re/releaselog/pull/3))
- fix: correct typo in error message ([e9f0a1b](https://github.com/devs-des1re/releaselog/commit/e9f0a1b))

### Docs Changes
- docs: add security policy ([d85cc0e](https://github.com/devs-des1re/releaselog/commit/d85cc0e)) ([#2](https://github.com/devs-des1re/releaselog/pull/2))

### Other Changes
- chore: removed supported versions ([464d4eb](https://github.com/devs-des1re/releaselog/commit/464d4eb)) ([#2](https://github.com/devs-des1re/releaselog/pull/2))

## Contributors
- @devs-des1re has made 12 commit(s)
- @other has made 3 commit(s)
- Mystery Person has made 1 commit(s)

## Full Change Log
https://github.com/devs-des1re/releaselog/compare/v0.1.0...v0.2.0
`,
    );
  });

  it('omits empty sections entirely', () => {
    const output = render({
      commits: [commit()],
      contributors: [contributor()],
      headers: { breaking: 'Breaking Changes' },
    });

    expect(output).toContain('### New Features');
    expect(output).not.toContain('### Breaking Changes');
    expect(output).not.toContain('### Bug Fixes');
    expect(output).not.toContain('### Docs Changes');
    expect(output).not.toContain('### Other Changes');
  });

  it('places breaking changes above new features', () => {
    const output = render({
      commits: [
        commit({ desc: 'feat: regular change' }),
        commit({ sha: 'bbb', shortSha: 'bbb', desc: 'feat!: breaking change', breaking: true }),
      ],
      contributors: [contributor()],
    });

    expect(output.indexOf('### Breaking Changes')).toBeLessThan(output.indexOf('### New Features'));
  });

  it('sorts contributors by commit count and then by login', () => {
    const output = render({
      commits: [commit()],
      contributors: [
        contributor({ login: 'zulu', commitCount: 1 }),
        contributor({ login: 'alpha', commitCount: 1 }),
        contributor({ login: 'high', commitCount: 9 }),
      ],
    });

    const lines = output
      .split('## Contributors')[1]
      .split('## Full Change Log')[0]
      .trim()
      .split('\n');

    expect(lines).toEqual([
      '- @high has made 9 commit(s)',
      '- @alpha has made 1 commit(s)',
      '- @zulu has made 1 commit(s)',
    ]);
  });

  it('renders unresolved contributors without an at-prefix', () => {
    const output = render({
      commits: [commit()],
      contributors: [
        contributor({
          login: null,
          name: 'Mystery Person',
          email: 'mystery@example.com',
          resolved: false,
        }),
      ],
    });

    expect(output).toContain('- Mystery Person has made 1 commit(s)');
    expect(output).not.toContain('@Mystery');
  });

  it('escapes Markdown in raw descriptions', () => {
    const output = render({
      commits: [commit({ desc: 'feat: use *stars*, _underscores_, `code` and <tag>' })],
      contributors: [contributor()],
    });

    expect(output).toContain(
      '- feat: use \\*stars\\*, \\_underscores\\_, \\`code\\` and \\<tag\\> ([a1b2c3d]',
    );
  });

  it('uses the configured server URL for links', () => {
    const output = render({
      serverUrl: 'https://github.example.com',
      commits: [commit()],
      contributors: [contributor()],
    });

    expect(output).toContain('https://github.example.com/devs-des1re/releaselog/commit/a1b2c3d');
    expect(output).toContain(
      'https://github.example.com/devs-des1re/releaselog/compare/v0.1.0...v0.2.0',
    );
  });

  it('uses the commits URL when there is no previous tag', () => {
    const output = render({
      tag: 'v1.0.0',
      previousTag: '',
      commits: [commit()],
      contributors: [contributor()],
    });

    expect(output).toContain(
      '## Full Change Log\nhttps://github.com/devs-des1re/releaselog/commits/v1.0.0',
    );
    expect(output).not.toContain('/compare/');
  });

  it('renders the empty-range placeholder and keeps the full change log', () => {
    const output = render({ tag: 'v0.2.0', previousTag: 'v0.1.0' });

    expect(output).toBe(
      `_No changes since v0.1.0._

## Full Change Log
https://github.com/devs-des1re/releaselog/compare/v0.1.0...v0.2.0
`,
    );
  });

  it('renders a first-release empty-range placeholder without a previous tag', () => {
    const output = render({ tag: 'v1.0.0', previousTag: '' });

    expect(output).toBe(
      `_No changes._

## Full Change Log
https://github.com/devs-des1re/releaselog/commits/v1.0.0
`,
    );
  });

  it('uses custom section headers', () => {
    const output = render({
      commits: [commit(), commit({ sha: 'bbb', shortSha: 'bbb', type: 'fix', section: 'fixes' })],
      contributors: [contributor()],
      headers: { features: 'Shiny Things', fixes: 'Repairs' },
    });

    expect(output).toContain('### Shiny Things');
    expect(output).toContain('### Repairs');
    expect(output).not.toContain('### New Features');
  });

  it('does not emit a tag header, separators, or emojis', () => {
    const output = render({
      commits: [commit()],
      contributors: [contributor()],
    });

    expect(output.startsWith('## Changes')).toBe(true);
    expect(output).not.toContain('# v0.2.0');
    expect(output).not.toContain('---');
    expect(/[\u{1f300}-\u{1faff}]/u.test(output)).toBe(false);
  });
});

describe('renderCustomTemplate', () => {
  it('renders a full custom document from the shared context', () => {
    const context = buildRenderContext({
      tag: 'v0.2.0',
      previousTag: 'v0.1.0',
      owner,
      repo,
      commits: [commit()],
      contributors: [contributor()],
    });

    expect(context.server_url).toBe('https://github.com');
    expect(context.section_headers.features).toBe('New Features');

    const output = renderCustomTemplate(
      '## {{tag}}\n{{#each new_features}}- {{desc}}\n{{/each}}{{compare_url}}',
      context,
    );
    expect(output).toBe(
      '## v0.2.0\n- feat: add a feature\nhttps://github.com/devs-des1re/releaselog/compare/v0.1.0...v0.2.0\n',
    );
  });

  it('skips each blocks for empty sections', () => {
    const context = buildRenderContext({
      tag: 'v0.2.0',
      previousTag: 'v0.1.0',
      owner,
      repo,
      commits: [],
      contributors: [],
    });

    const output = renderCustomTemplate('{{#each bug_fixes}}- {{desc}}\n{{/each}}done', context);
    expect(output).toBe('done\n');
  });
});

describe('default template', () => {
  it('matches the shipped template file', () => {
    const source = readFileSync(resolvePath('templates/default.hbs'), 'utf8').trim();
    expect(source).toBe(DEFAULT_BULLET_TEMPLATE);
  });
});
