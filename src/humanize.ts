import Anthropic from '@anthropic-ai/sdk';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import OpenAI from 'openai';

import type { AiMode, AiOnError, AiProvider } from './types';

export const DEFAULT_SYSTEM_PROMPT = `You are a release notes editor. Rewrite technical commit descriptions into clear, friendly language that non-developers can understand.

Rules:
- Preserve the markdown structure exactly: heading levels, section names, bullet count, ordering.
- Rewrite only the human-readable description of each bullet.
- Strip any conventional-commit prefix (feat:, fix:, chore:, docs:, etc., including scope like feat(api):) - the section heading already tells the reader the type.
- Preserve verbatim: the commit SHA link \`([abc1234](url))\`, the PR link \`([#123](url))\` when present, @mentions, and the compare URL. Do not move, merge, or reformat these two parenthesised groups.
- Keep each bullet to one short sentence (approximately 15 words).
- Do not invent features or fixes that are not present.
- Do not add a preamble, summary, or commentary.
- Keep technical identifiers (function names, endpoints, package names) intact.
- Do not change the number of bullets or merge or split them.
- No emojis. No em-dashes. No en-dashes. No curly quotes. No decorative characters. Use plain ASCII punctuation only: -, ", '.
- Fix grammar and clarity only. No personality, no filler.`;

export const USER_PROMPT_PREFIX =
  'Rewrite this changelog per the rules. Return ONLY the rewritten markdown.\n\n';

export interface HumanizeRequest {
  mode: AiMode;
  provider: AiProvider;
  model: string;
  apiKey: string;
  endpoint: string;
  temperature: number;
  system: string;
  prompt: string;
}

export type HumanizeClient = (request: HumanizeRequest) => Promise<string>;

export interface HumanizeOptions {
  mode: AiMode;
  provider: AiProvider;
  model: string;
  apiKey: string;
  endpoint?: string;
  temperature: number;
  systemPrompt?: string;
  onError: AiOnError;
  onWarning?: (message: string) => void;
  client?: HumanizeClient;
}

export interface HumanizeOutcome {
  markdown: string;
  humanized: boolean;
}

export class HumanizeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HumanizeError';
  }
}

function stripCodeFences(value: string): string {
  const text = value.trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) {
    return fenced[1].trim();
  }

  let result = text;
  if (result.startsWith('```')) {
    result = result.replace(/^```[^\n]*\n?/, '');
  }
  if (result.endsWith('```')) {
    result = result.replace(/\n?```$/, '');
  }
  return result.trim();
}

function sanitizeText(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu, '');
}

/**
 * Cleans model output: removes a wrapping code fence and any preamble before
 * the first level-two heading, normalizes punctuation, trims trailing
 * whitespace, and ends with exactly one newline.
 */
export function postProcess(value: string): string {
  let text = stripCodeFences(value.replace(/\r\n/g, '\n'));

  const heading = text.search(/^(?:## |_No changes)/m);
  if (heading > 0) {
    text = text.slice(heading);
  }

  text = sanitizeText(text)
    .replace(/[ \t]+$/gm, '')
    .trim();

  return `${text}\n`;
}

function googleEndpoint(endpoint: string): string {
  return (endpoint || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
}

async function generateRaw(request: HumanizeRequest): Promise<string> {
  switch (request.provider) {
    case 'openai': {
      const client = new OpenAI({
        apiKey: request.apiKey,
        ...(request.endpoint ? { baseURL: request.endpoint } : {}),
      });
      const completion = await client.chat.completions.create({
        model: request.model,
        temperature: request.temperature,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
      });
      return completion.choices[0]?.message.content ?? '';
    }

    case 'anthropic': {
      const client = new Anthropic({
        apiKey: request.apiKey,
        ...(request.endpoint ? { baseURL: request.endpoint } : {}),
      });
      const response = await client.messages.create({
        model: request.model,
        max_tokens: 4096,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
      });
      return response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n')
        .trim();
    }

    case 'google': {
      const url = `${googleEndpoint(request.endpoint)}/models/${encodeURIComponent(
        request.model,
      )}:generateContent?key=${encodeURIComponent(request.apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: { temperature: request.temperature },
        }),
      });
      if (!response.ok) {
        throw new Error(`Google AI request failed: ${response.status} ${await response.text()}`);
      }

      const data: unknown = await response.json();
      const candidates = (
        data as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        }
      ).candidates;
      return candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    }

    case 'openai-compatible': {
      const base = request.endpoint.replace(/\/+$/, '');
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${request.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          temperature: request.temperature,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(
          `OpenAI-compatible request failed: ${response.status} ${await response.text()}`,
        );
      }

      const data: unknown = await response.json();
      const choices = (data as { choices?: Array<{ message?: { content?: string | null } }> })
        .choices;
      return choices?.[0]?.message?.content ?? '';
    }
  }
}

async function generateVercel(request: HumanizeRequest): Promise<string> {
  let model: Parameters<typeof generateText>[0]['model'];

  switch (request.provider) {
    case 'openai': {
      const provider = createOpenAI({
        apiKey: request.apiKey,
        ...(request.endpoint ? { baseURL: request.endpoint } : {}),
      });
      model = provider(request.model);
      break;
    }
    case 'anthropic': {
      const provider = createAnthropic({
        apiKey: request.apiKey,
        ...(request.endpoint ? { baseURL: request.endpoint } : {}),
      });
      model = provider(request.model);
      break;
    }
    case 'google': {
      const provider = createGoogleGenerativeAI({
        apiKey: request.apiKey,
        ...(request.endpoint ? { baseURL: request.endpoint } : {}),
      });
      model = provider(request.model);
      break;
    }
    case 'openai-compatible': {
      const provider = createOpenAICompatible({
        name: 'releaselog',
        apiKey: request.apiKey,
        baseURL: request.endpoint,
      });
      model = provider(request.model);
      break;
    }
  }

  const { text } = await generateText({
    model,
    system: request.system,
    prompt: request.prompt,
    temperature: request.temperature,
  });
  return text;
}

/** Default client: Vercel AI SDK or the provider SDKs directly. */
export function generateWithProvider(request: HumanizeRequest): Promise<string> {
  return request.mode === 'raw' ? generateRaw(request) : generateVercel(request);
}

/**
 * Rewrites a changelog with an AI provider. Configuration errors always throw;
 * provider failures either fall back to the raw changelog or throw, according
 * to `on-error`.
 */
export async function humanizeChangelog(
  rawChangelog: string,
  options: HumanizeOptions,
): Promise<HumanizeOutcome> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new HumanizeError('Input "ai-api-key" is required when humanize is true.');
  }
  if (!options.model.trim()) {
    throw new HumanizeError('Input "ai-model" must not be empty.');
  }
  if (options.provider === 'openai-compatible' && !(options.endpoint ?? '').trim()) {
    throw new HumanizeError(
      'Input "ai-endpoint" is required when ai-provider is openai-compatible.',
    );
  }

  const system = options.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const prompt = `${USER_PROMPT_PREFIX}${rawChangelog}`;
  const client = options.client ?? generateWithProvider;

  try {
    const response = await client({
      mode: options.mode,
      provider: options.provider,
      model: options.model,
      apiKey,
      endpoint: options.endpoint ?? '',
      temperature: options.temperature,
      system,
      prompt,
    });

    const markdown = postProcess(response);
    if (markdown.trim().length === 0) {
      throw new HumanizeError('The AI provider returned an empty response.');
    }

    return { markdown, humanized: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (options.onError === 'fail') {
      throw new HumanizeError(`AI humanisation failed: ${message}`, { cause: error });
    }

    options.onWarning?.(`AI humanisation failed; keeping the raw changelog. ${message}`);
    return { markdown: rawChangelog, humanized: false };
  }
}
