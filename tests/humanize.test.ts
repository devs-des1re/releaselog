import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SYSTEM_PROMPT,
  HumanizeError,
  USER_PROMPT_PREFIX,
  generateWithProvider,
  humanizeChangelog,
  postProcess,
  type HumanizeClient,
  type HumanizeOptions,
  type HumanizeRequest,
} from '../src/humanize';

const rawChangelog = '## Changes\n\n### New Features\n- feat: add release notes';

function options(overrides: Partial<HumanizeOptions> = {}): HumanizeOptions {
  return {
    mode: 'vercel',
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'test-key',
    endpoint: '',
    temperature: 0.3,
    onError: 'fallback',
    ...overrides,
  };
}

describe('postProcess', () => {
  it('strips a wrapping markdown code fence', () => {
    expect(postProcess('```markdown\n## Changes\n\n- improved\n```')).toBe(
      '## Changes\n\n- improved\n',
    );
  });

  it('strips a leading fence without a closing fence', () => {
    expect(postProcess('```\n## Changes\n- improved')).toBe('## Changes\n- improved\n');
  });

  it('strips preamble before the first level-two heading', () => {
    expect(postProcess('Here is the rewritten changelog:\n\n## Changes\n\n- improved')).toBe(
      '## Changes\n\n- improved\n',
    );
  });

  it('strips preamble before a placeholder document', () => {
    const placeholder = '_No changes since v1.0.0._\n\n## Full Change Log\nhttps://example.com';
    expect(postProcess(`Sure!\n\n${placeholder}`)).toBe(`${placeholder}\n`);
  });

  it('normalizes CRLF, trailing spaces, and the final newline', () => {
    expect(postProcess('## Changes  \r\n- improved   \r\n\r\n')).toBe('## Changes\n- improved\n');
  });
});

describe('humanizeChangelog', () => {
  it('returns processed markdown and sets humanized when the call succeeds', async () => {
    const client: HumanizeClient = () =>
      Promise.resolve('```markdown\nHere you go:\n\n## Changes\n\n- improved\n```');

    const result = await humanizeChangelog(rawChangelog, options({ client }));

    expect(result).toEqual({ markdown: '## Changes\n\n- improved\n', humanized: true });
  });

  it('sends the default system prompt and the exact user prompt', async () => {
    let captured: HumanizeRequest | undefined;
    const client: HumanizeClient = (request) => {
      captured = request;
      return Promise.resolve('## Changes\n- improved');
    };

    await humanizeChangelog(rawChangelog, options({ client }));

    expect(captured).toMatchObject({
      mode: 'vercel',
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
      temperature: 0.3,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: `${USER_PROMPT_PREFIX}${rawChangelog}`,
    });
  });

  it('uses a custom system prompt when provided', async () => {
    let captured: HumanizeRequest | undefined;
    const client: HumanizeClient = (request) => {
      captured = request;
      return Promise.resolve('## Changes\n- improved');
    };

    await humanizeChangelog(rawChangelog, options({ client, systemPrompt: 'Be brief.' }));

    expect(captured?.system).toBe('Be brief.');
  });

  it('falls back to the raw changelog and warns when the provider fails', async () => {
    const onWarning = vi.fn();
    const client: HumanizeClient = () => Promise.reject(new Error('invalid api key'));

    const result = await humanizeChangelog(
      rawChangelog,
      options({ client, onWarning, onError: 'fallback' }),
    );

    expect(result).toEqual({ markdown: rawChangelog, humanized: false });
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('invalid api key'));
  });

  it('falls back when the provider returns an empty response', async () => {
    const onWarning = vi.fn();
    const client: HumanizeClient = () => Promise.resolve('   \n');

    const result = await humanizeChangelog(rawChangelog, options({ client, onWarning }));

    expect(result).toEqual({ markdown: rawChangelog, humanized: false });
    expect(onWarning).toHaveBeenCalled();
  });

  it('throws when on-error is fail', async () => {
    const client: HumanizeClient = () => Promise.reject(new Error('rate limited'));

    await expect(
      humanizeChangelog(rawChangelog, options({ client, onError: 'fail' })),
    ).rejects.toBeInstanceOf(HumanizeError);
  });

  it('fails before calling the provider when the API key is missing', async () => {
    const client = vi.fn((_request: HumanizeRequest) => Promise.resolve('## Changes'));
    await expect(
      humanizeChangelog(rawChangelog, options({ client, apiKey: '', onError: 'fallback' })),
    ).rejects.toThrow(/ai-api-key/);
    expect(client).not.toHaveBeenCalled();
  });

  it('fails before calling the provider when the model is empty', async () => {
    const client = vi.fn((_request: HumanizeRequest) => Promise.resolve('## Changes'));
    await expect(
      humanizeChangelog(rawChangelog, options({ client, model: ' ', onError: 'fallback' })),
    ).rejects.toThrow(/ai-model/);
    expect(client).not.toHaveBeenCalled();
  });

  it('requires an endpoint for openai-compatible providers', async () => {
    const client = vi.fn((_request: HumanizeRequest) => Promise.resolve('## Changes'));
    await expect(
      humanizeChangelog(
        rawChangelog,
        options({ client, provider: 'openai-compatible', endpoint: '', onError: 'fallback' }),
      ),
    ).rejects.toThrow(/ai-endpoint/);
    expect(client).not.toHaveBeenCalled();
  });
});

describe('generateWithProvider in raw mode', () => {
  const server = setupServer(
    http.post('https://example.test/v1/chat/completions', () =>
      HttpResponse.json({
        choices: [{ message: { content: '## Changes\n\n- rewritten' } }],
      }),
    ),
  );

  beforeAll(() => {
    server.listen({ onUnhandledFrame: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  it('calls an OpenAI-compatible endpoint with a plain fetch', async () => {
    const text = await generateWithProvider({
      mode: 'raw',
      provider: 'openai-compatible',
      model: 'test-model',
      apiKey: 'test-key',
      endpoint: 'https://example.test/v1',
      temperature: 0.2,
      system: 'Follow the rules.',
      prompt: USER_PROMPT_PREFIX + rawChangelog,
    });

    expect(text).toBe('## Changes\n\n- rewritten');
  });
});
