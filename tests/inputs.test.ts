import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';
import {
  INPUT_NAMES,
  InputError,
  loadSettings,
  readRawInputs,
  resolveSettings,
  type RawInputs,
} from '../src/inputs';

const tagRef = { GITHUB_REF: 'refs/tags/v1.0.0' };

function raw(overrides: Partial<RawInputs> = {}): RawInputs {
  const base = Object.fromEntries(INPUT_NAMES.map((name) => [name, ''])) as RawInputs;
  return {
    ...base,
    token: 'test-token',
    'dev-branch': 'dev',
    ...overrides,
  };
}

describe('readRawInputs', () => {
  it('maps hyphenated input names to underscore environment variables', () => {
    const inputs = readRawInputs({
      INPUT_TOKEN: '  secret  ',
      INPUT_DEV_BRANCH: 'dev',
      INPUT_INCLUDE_PR_NUMBERS: 'false',
      INPUT_AI_API_KEY: 'key',
    });

    expect(inputs.token).toBe('secret');
    expect(inputs['dev-branch']).toBe('dev');
    expect(inputs['include-pr-numbers']).toBe('false');
    expect(inputs['ai-api-key']).toBe('key');
    expect(inputs['main-branch']).toBe('');
  });
});

describe('resolveSettings', () => {
  it('applies documented defaults when nothing is configured', () => {
    const settings = resolveSettings(raw(), null, tagRef);

    expect(settings).toMatchObject({
      mainBranch: 'main',
      currentTag: 'v1.0.0',
      previousTagInput: '',
      dryRun: false,
      publish: true,
      releaseName: 'v1.0.0',
      releaseDraft: false,
      releasePrerelease: 'auto',
      outputFile: '',
      changelogFile: '',
      templatePath: '',
      configPath: '.releaselog.yml',
      tagOrder: 'semver',
      baseVersionGranularity: 'patch',
      excludeBots: false,
      includeMergeCommits: true,
      includePrNumbers: true,
      breakingChanges: false,
      allowPostTagCommits: false,
      requireContributorPings: false,
      fuzzyNameSearch: false,
      humanize: false,
      aiMode: 'vercel',
      aiProvider: 'openai',
      aiModel: 'gpt-4o-mini',
      aiEndpoint: '',
      aiApiKey: '',
      aiTemperature: 0.3,
      aiSystemPrompt: '',
      aiOnError: 'fallback',
      sectionHeaders: {
        breaking: 'Breaking Changes',
        features: 'New Features',
        fixes: 'Bug Fixes',
        docs: 'Docs Changes',
        other: 'Other Changes',
      },
    });
  });

  it('uses the tag ref before the current-tag input', () => {
    const settings = resolveSettings(raw({ 'current-tag': 'v9.9.9' }), null, {
      GITHUB_REF: 'refs/tags/v1.2.3-beta.1',
    });

    expect(settings.currentTag).toBe('v1.2.3-beta.1');
  });

  it('uses the current-tag input outside a tag trigger', () => {
    const settings = resolveSettings(raw({ 'current-tag': 'v1.2.3' }), null, {
      GITHUB_REF: 'refs/heads/main',
    });

    expect(settings.currentTag).toBe('v1.2.3');
  });

  it('fails when no current tag can be resolved', () => {
    expect(() => resolveSettings(raw(), null, { GITHUB_REF: 'refs/heads/main' })).toThrow(
      InputError,
    );
    expect(() => resolveSettings(raw(), null, {})).toThrow(/current-tag/);
  });

  it('requires a token and a dev branch', () => {
    expect(() => resolveSettings(raw({ token: '' }), null, tagRef)).toThrow(/"token"/);
    expect(() => resolveSettings(raw({ 'dev-branch': '' }), null, tagRef)).toThrow(/"dev-branch"/);
  });

  it('lets inputs override config values', () => {
    const config = loadConfig('tests/fixtures/releaselog.full.yml');
    const settings = resolveSettings(
      raw({
        'tag-order': 'semver',
        'base-version-granularity': 'patch',
        'breaking-changes': 'false',
        'exclude-bots': 'false',
        'ai-mode': 'vercel',
      }),
      config,
      tagRef,
    );

    expect(settings.tagOrder).toBe('semver');
    expect(settings.baseVersionGranularity).toBe('patch');
    expect(settings.breakingChanges).toBe(false);
    expect(settings.excludeBots).toBe(false);
    expect(settings.aiMode).toBe('vercel');
  });

  it('fills unset inputs from config', () => {
    const config = loadConfig('tests/fixtures/releaselog.full.yml');
    const settings = resolveSettings(raw(), config, tagRef);

    expect(settings).toMatchObject({
      tagOrder: 'date',
      baseVersionGranularity: 'minor',
      templatePath: './templates/release.hbs',
      excludeBots: true,
      includeMergeCommits: false,
      includePrNumbers: false,
      allowPostTagCommits: true,
      breakingChanges: true,
      requireContributorPings: true,
      fuzzyNameSearch: true,
      humanize: true,
      aiMode: 'raw',
      aiProvider: 'anthropic',
      aiModel: 'claude-test',
      aiEndpoint: 'https://example.com',
      aiTemperature: 0.7,
      aiOnError: 'fail',
      publish: false,
      releaseDraft: true,
      releasePrerelease: true,
      outputFile: 'release.md',
      changelogFile: 'CHANGELOG.md',
      sectionHeaders: {
        breaking: 'Breaking',
        features: 'Features',
        fixes: 'Fixes',
        docs: 'Docs',
        other: 'Everything Else',
      },
    });
  });

  it('parses booleans and rejects anything else', () => {
    expect(resolveSettings(raw({ 'dry-run': 'true' }), null, tagRef).dryRun).toBe(true);
    expect(resolveSettings(raw({ publish: 'false' }), null, tagRef).publish).toBe(false);
    expect(
      resolveSettings(raw({ 'release-prerelease': 'true' }), null, tagRef).releasePrerelease,
    ).toBe(true);
    expect(
      resolveSettings(raw({ 'release-prerelease': 'false' }), null, tagRef).releasePrerelease,
    ).toBe(false);
    expect(
      resolveSettings(raw({ 'release-prerelease': 'auto' }), null, tagRef).releasePrerelease,
    ).toBe('auto');
    expect(() => resolveSettings(raw({ 'dry-run': 'yes' }), null, tagRef)).toThrow(InputError);
    expect(() => resolveSettings(raw({ 'release-prerelease': 'sometimes' }), null, tagRef)).toThrow(
      InputError,
    );
  });

  it('validates tag settings and temperature', () => {
    expect(() => resolveSettings(raw({ 'tag-order': 'weekly' }), null, tagRef)).toThrow(
      /tag-order/,
    );
    expect(() =>
      resolveSettings(raw({ 'base-version-granularity': 'major' }), null, tagRef),
    ).toThrow(/base-version-granularity/);
    expect(() => resolveSettings(raw({ 'ai-provider': 'mistral' }), null, tagRef)).toThrow(
      /ai-provider/,
    );
    expect(() => resolveSettings(raw({ 'ai-mode': 'grpc' }), null, tagRef)).toThrow(/ai-mode/);
    expect(() => resolveSettings(raw({ 'ai-on-error': 'ignore' }), null, tagRef)).toThrow(
      /ai-on-error/,
    );

    expect(resolveSettings(raw({ 'ai-temperature': '0' }), null, tagRef).aiTemperature).toBe(0);
    expect(resolveSettings(raw({ 'ai-temperature': '1' }), null, tagRef).aiTemperature).toBe(1);
    expect(() => resolveSettings(raw({ 'ai-temperature': '-0.1' }), null, tagRef)).toThrow(
      /ai-temperature/,
    );
    expect(() => resolveSettings(raw({ 'ai-temperature': '1.1' }), null, tagRef)).toThrow(
      /ai-temperature/,
    );
    expect(() => resolveSettings(raw({ 'ai-temperature': 'hot' }), null, tagRef)).toThrow(
      /ai-temperature/,
    );
  });

  it('computes the default release name from the current tag', () => {
    const settings = resolveSettings(raw(), null, { GITHUB_REF: 'refs/tags/v2.3.4' });
    expect(settings.releaseName).toBe('v2.3.4');
  });
});

describe('loadSettings', () => {
  it('reads the config path input and merges the file', () => {
    const settings = loadSettings(
      {
        INPUT_TOKEN: 'test-token',
        INPUT_DEV_BRANCH: 'dev',
        INPUT_CONFIG_PATH: 'tests/fixtures/releaselog.full.yml',
        GITHUB_REF: 'refs/tags/v1.0.0',
      },
      process.cwd(),
    );

    expect(settings.tagOrder).toBe('date');
    expect(settings.templatePath).toBe('./templates/release.hbs');
  });
});
