import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('returns null when the file is absent', () => {
    expect(loadConfig('tests/fixtures/does-not-exist.yml')).toBeNull();
  });

  it('treats an empty file as an empty configuration', () => {
    expect(loadConfig('tests/fixtures/releaselog.empty.yml')).toEqual({});
  });

  it('parses every supported key', () => {
    const config = loadConfig('tests/fixtures/releaselog.full.yml');

    expect(config).toEqual({
      tag: { order: 'date', base_version_granularity: 'minor' },
      sections: {
        breaking: { enabled: true, header: 'Breaking' },
        features: { header: 'Features' },
        fixes: { header: 'Fixes' },
        docs: { header: 'Docs' },
        other: { header: 'Everything Else' },
      },
      template: './templates/release.hbs',
      commits: {
        exclude_bots: true,
        include_merge_commits: false,
        include_pr_numbers: false,
        allow_post_tag_commits: true,
      },
      contributors: { require_pings: true, fuzzy_name_search: true },
      humanize: {
        enabled: true,
        mode: 'raw',
        provider: 'anthropic',
        model: 'claude-test',
        endpoint: 'https://example.com',
        temperature: 0.7,
        on_error: 'fail',
      },
      publish: {
        release: false,
        draft: true,
        prerelease: true,
        output_file: 'release.md',
        changelog_file: 'CHANGELOG.md',
      },
    });
  });

  it('reports the offending key for invalid values', () => {
    expect(() => loadConfig('tests/fixtures/releaselog.invalid.yml')).toThrow(ConfigError);
    expect(() => loadConfig('tests/fixtures/releaselog.invalid.yml')).toThrow(/tag\.order/);
  });
});
