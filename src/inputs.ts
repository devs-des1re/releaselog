import { z } from 'zod';

import { loadConfig, type ReleaselogConfig } from './config';
import { DEFAULT_HEADERS, type SectionHeaders } from './render';
import type { AiMode, AiOnError, AiProvider, BaseVersionGranularity, TagOrder } from './types';

export const INPUT_NAMES = [
  'token',
  'dev-branch',
  'main-branch',
  'current-tag',
  'previous-tag',
  'dry-run',
  'publish',
  'release-name',
  'release-draft',
  'release-prerelease',
  'output-file',
  'changelog-file',
  'template-path',
  'config-path',
  'tag-order',
  'base-version-granularity',
  'exclude-bots',
  'include-merge-commits',
  'include-pr-numbers',
  'breaking-changes',
  'allow-post-tag-commits',
  'require-contributor-pings',
  'contributor-ping-fuzzy-name-search',
  'humanize',
  'ai-mode',
  'ai-provider',
  'ai-model',
  'ai-endpoint',
  'ai-api-key',
  'ai-temperature',
  'ai-system-prompt',
  'ai-on-error',
] as const;

export type InputName = (typeof INPUT_NAMES)[number];
export type RawInputs = Record<InputName, string>;

export interface Settings {
  token: string;
  devBranch: string;
  mainBranch: string;
  currentTag: string;
  previousTagInput: string;
  dryRun: boolean;
  publish: boolean;
  releaseName: string;
  releaseDraft: boolean;
  releasePrerelease: 'auto' | boolean;
  outputFile: string;
  changelogFile: string;
  templatePath: string;
  configPath: string;
  tagOrder: TagOrder;
  baseVersionGranularity: BaseVersionGranularity;
  excludeBots: boolean;
  includeMergeCommits: boolean;
  includePrNumbers: boolean;
  breakingChanges: boolean;
  allowPostTagCommits: boolean;
  requireContributorPings: boolean;
  fuzzyNameSearch: boolean;
  humanize: boolean;
  aiMode: AiMode;
  aiProvider: AiProvider;
  aiModel: string;
  aiEndpoint: string;
  aiApiKey: string;
  aiTemperature: number;
  aiSystemPrompt: string;
  aiOnError: AiOnError;
  sectionHeaders: SectionHeaders;
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

const tagOrderSchema = z.enum(['semver', 'date']);
const baseVersionSchema = z.enum(['patch', 'minor']);
const aiModeSchema = z.enum(['vercel', 'raw']);
const aiProviderSchema = z.enum(['openai', 'anthropic', 'google', 'openai-compatible']);
const aiOnErrorSchema = z.enum(['fallback', 'fail']);

/** Reads `INPUT_*` variables, mapping hyphens to underscores. */
export function readRawInputs(env: NodeJS.ProcessEnv = process.env): RawInputs {
  const raw = {} as RawInputs;
  for (const name of INPUT_NAMES) {
    const key = `INPUT_${name.replace(/-/g, '_').toUpperCase()}`;
    raw[name] = (env[key] ?? '').trim();
  }
  return raw;
}

function provided(raw: RawInputs, name: InputName): string | undefined {
  const value = raw[name];
  return value.length > 0 ? value : undefined;
}

function parseBoolean(value: string | undefined, name: InputName): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (/^true$/i.test(value)) {
    return true;
  }
  if (/^false$/i.test(value)) {
    return false;
  }
  throw new InputError(`Input "${name}" must be "true" or "false", received "${value}".`);
}

function stringSetting(
  raw: RawInputs,
  name: InputName,
  configValue: string | undefined,
  fallback: string,
): string {
  return provided(raw, name) ?? configValue ?? fallback;
}

function booleanSetting(
  raw: RawInputs,
  name: InputName,
  configValue: boolean | undefined,
  fallback: boolean,
): boolean {
  return parseBoolean(provided(raw, name), name) ?? configValue ?? fallback;
}

function enumSetting<T extends string>(
  raw: RawInputs,
  name: InputName,
  configValue: T | undefined,
  fallback: T,
  schema: z.ZodType<T>,
): T {
  const value = provided(raw, name) ?? configValue ?? fallback;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new InputError(`Input "${name}" has an unsupported value "${value}".`);
  }
  return parsed.data;
}

function resolveCurrentTag(raw: RawInputs, env: NodeJS.ProcessEnv): string {
  const ref = env.GITHUB_REF ?? '';
  if (ref.startsWith('refs/tags/')) {
    return ref.slice('refs/tags/'.length);
  }
  if (provided(raw, 'current-tag')) {
    return raw['current-tag'];
  }
  throw new InputError(
    `Could not determine the current tag. GITHUB_REF was "${ref}" and no current-tag input was provided. ` +
      'Run on a tag push or set current-tag.',
  );
}

function resolvePrerelease(raw: RawInputs, config: ReleaselogConfig | null): 'auto' | boolean {
  const value = provided(raw, 'release-prerelease') ?? config?.publish?.prerelease ?? 'auto';
  if (typeof value === 'boolean' || value === 'auto') {
    return value;
  }
  const parsed = parseBoolean(value, 'release-prerelease');
  return parsed ?? 'auto';
}

/** Merges raw inputs over config values and built-in defaults. */
export function resolveSettings(
  raw: RawInputs,
  config: ReleaselogConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): Settings {
  const token = provided(raw, 'token');
  if (!token) {
    throw new InputError('Input "token" is required.');
  }

  const devBranch = provided(raw, 'dev-branch');
  if (!devBranch) {
    throw new InputError('Input "dev-branch" is required.');
  }

  const currentTag = resolveCurrentTag(raw, env);

  const temperatureInput = provided(raw, 'ai-temperature');
  const aiTemperature =
    temperatureInput !== undefined
      ? Number(temperatureInput)
      : (config?.humanize?.temperature ?? 0.3);
  if (!Number.isFinite(aiTemperature) || aiTemperature < 0 || aiTemperature > 1) {
    throw new InputError(
      `Input "ai-temperature" must be between 0 and 1, received "${temperatureInput ?? String(aiTemperature)}".`,
    );
  }

  return {
    token,
    devBranch,
    mainBranch: stringSetting(raw, 'main-branch', undefined, 'main'),
    currentTag,
    previousTagInput: provided(raw, 'previous-tag') ?? '',
    dryRun: booleanSetting(raw, 'dry-run', undefined, false),
    publish: booleanSetting(raw, 'publish', config?.publish?.release, true),
    releaseName: stringSetting(raw, 'release-name', undefined, currentTag),
    releaseDraft: booleanSetting(raw, 'release-draft', config?.publish?.draft, false),
    releasePrerelease: resolvePrerelease(raw, config),
    outputFile: stringSetting(raw, 'output-file', config?.publish?.output_file, ''),
    changelogFile: stringSetting(raw, 'changelog-file', config?.publish?.changelog_file, ''),
    templatePath: stringSetting(raw, 'template-path', config?.template, ''),
    configPath: stringSetting(raw, 'config-path', undefined, '.releaselog.yml'),
    tagOrder: enumSetting(raw, 'tag-order', config?.tag?.order, 'semver', tagOrderSchema),
    baseVersionGranularity: enumSetting(
      raw,
      'base-version-granularity',
      config?.tag?.base_version_granularity,
      'patch',
      baseVersionSchema,
    ),
    excludeBots: booleanSetting(raw, 'exclude-bots', config?.commits?.exclude_bots, false),
    includeMergeCommits: booleanSetting(
      raw,
      'include-merge-commits',
      config?.commits?.include_merge_commits,
      true,
    ),
    includePrNumbers: booleanSetting(
      raw,
      'include-pr-numbers',
      config?.commits?.include_pr_numbers,
      true,
    ),
    breakingChanges: booleanSetting(
      raw,
      'breaking-changes',
      config?.sections?.breaking?.enabled,
      false,
    ),
    allowPostTagCommits: booleanSetting(
      raw,
      'allow-post-tag-commits',
      config?.commits?.allow_post_tag_commits,
      false,
    ),
    requireContributorPings: booleanSetting(
      raw,
      'require-contributor-pings',
      config?.contributors?.require_pings,
      false,
    ),
    fuzzyNameSearch: booleanSetting(
      raw,
      'contributor-ping-fuzzy-name-search',
      config?.contributors?.fuzzy_name_search,
      false,
    ),
    humanize: booleanSetting(raw, 'humanize', config?.humanize?.enabled, false),
    aiMode: enumSetting(raw, 'ai-mode', config?.humanize?.mode, 'vercel', aiModeSchema),
    aiProvider: enumSetting(
      raw,
      'ai-provider',
      config?.humanize?.provider,
      'openai',
      aiProviderSchema,
    ),
    aiModel: stringSetting(raw, 'ai-model', config?.humanize?.model, 'gpt-4o-mini'),
    aiEndpoint: stringSetting(raw, 'ai-endpoint', config?.humanize?.endpoint, ''),
    aiApiKey: provided(raw, 'ai-api-key') ?? '',
    aiTemperature,
    aiSystemPrompt: provided(raw, 'ai-system-prompt') ?? '',
    aiOnError: enumSetting(
      raw,
      'ai-on-error',
      config?.humanize?.on_error,
      'fallback',
      aiOnErrorSchema,
    ),
    sectionHeaders: {
      breaking: config?.sections?.breaking?.header || DEFAULT_HEADERS.breaking,
      features: config?.sections?.features?.header || DEFAULT_HEADERS.features,
      fixes: config?.sections?.fixes?.header || DEFAULT_HEADERS.fixes,
      docs: config?.sections?.docs?.header || DEFAULT_HEADERS.docs,
      other: config?.sections?.other?.header || DEFAULT_HEADERS.other,
    },
  };
}

/** Reads inputs, then loads and merges the config file. */
export function loadSettings(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Settings {
  const raw = readRawInputs(env);
  const config = loadConfig(raw['config-path'] || '.releaselog.yml', cwd);
  return resolveSettings(raw, config, env);
}
