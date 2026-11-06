import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const tagOrderSchema = z.enum(['semver', 'date']);
const baseVersionSchema = z.enum(['patch', 'minor']);
const aiModeSchema = z.enum(['vercel', 'raw']);
const aiProviderSchema = z.enum(['openai', 'anthropic', 'google', 'openai-compatible']);
const aiOnErrorSchema = z.enum(['fallback', 'fail']);

const configSchema = z.object({
  tag: z
    .object({
      order: tagOrderSchema.optional(),
      base_version_granularity: baseVersionSchema.optional(),
    })
    .optional(),
  sections: z
    .object({
      breaking: z
        .object({
          enabled: z.boolean().optional(),
          header: z.string().optional(),
        })
        .optional(),
      features: z.object({ header: z.string().optional() }).optional(),
      fixes: z.object({ header: z.string().optional() }).optional(),
      docs: z.object({ header: z.string().optional() }).optional(),
      other: z.object({ header: z.string().optional() }).optional(),
    })
    .optional(),
  template: z.string().optional(),
  commits: z
    .object({
      exclude_bots: z.boolean().optional(),
      include_merge_commits: z.boolean().optional(),
      include_pr_numbers: z.boolean().optional(),
      allow_post_tag_commits: z.boolean().optional(),
    })
    .optional(),
  contributors: z
    .object({
      require_pings: z.boolean().optional(),
      fuzzy_name_search: z.boolean().optional(),
    })
    .optional(),
  humanize: z
    .object({
      enabled: z.boolean().optional(),
      mode: aiModeSchema.optional(),
      provider: aiProviderSchema.optional(),
      model: z.string().optional(),
      endpoint: z.string().optional(),
      temperature: z.number().min(0).max(1).optional(),
      on_error: aiOnErrorSchema.optional(),
    })
    .optional(),
  publish: z
    .object({
      release: z.boolean().optional(),
      draft: z.boolean().optional(),
      prerelease: z.union([z.literal('auto'), z.boolean()]).optional(),
      output_file: z.string().optional(),
      changelog_file: z.string().optional(),
    })
    .optional(),
});

export type ReleaselogConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Loads `.releaselog.yml`. A missing file is not an error; it simply means
 * every setting comes from action inputs and built-in defaults.
 */
export function loadConfig(path: string, cwd = process.cwd()): ReleaselogConfig | null {
  const absolutePath = isAbsolute(path) ? path : resolve(cwd, path);
  if (!existsSync(absolutePath)) {
    return null;
  }

  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new ConfigError(
      `Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = configSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid ${path}: ${details}`);
  }

  return parsed.data;
}
