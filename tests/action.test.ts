import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { INPUT_NAMES } from '../src/inputs';

interface Manifest {
  inputs: Record<string, { description?: string; required?: boolean }>;
  outputs: Record<string, { value?: string }>;
  runs: {
    using?: string;
    steps?: Array<{ uses?: string; env?: Record<string, string>; run?: string }>;
  };
}

function manifest(): Manifest {
  const raw: unknown = parse(readFileSync(resolvePath('action.yml'), 'utf8'));
  return raw as Manifest;
}

function inputEnvName(name: string): string {
  return `INPUT_${name.replace(/-/g, '_').toUpperCase()}`;
}

describe('action.yml', () => {
  it('is a composite action using Node 24', () => {
    const action = manifest();
    expect(action.runs.using).toBe('composite');

    const setup = action.runs.steps?.find((step) => step.uses?.startsWith('actions/setup-node@'));
    expect(setup).toBeDefined();

    const setupWith = setup as { with?: Record<string, string> };
    expect(setupWith.with?.['node-version']).toBe('24');
  });

  it('declares every input and maps it to the run step environment', () => {
    const action = manifest();
    const runStep = action.runs.steps?.find((step) => step.run?.includes('dist/index.js'));
    expect(runStep).toBeDefined();

    for (const name of INPUT_NAMES) {
      expect(action.inputs[name], `missing action input: ${name}`).toBeDefined();
      expect(runStep?.env?.[inputEnvName(name)], `missing env mapping for: ${name}`).toBeDefined();
    }

    expect(Object.keys(action.inputs).sort()).toEqual([...INPUT_NAMES].sort());
  });

  it('declares the documented outputs with step mappings', () => {
    const action = manifest();

    for (const output of ['changelog', 'previous-tag', 'current-tag', 'release-url', 'humanized']) {
      expect(action.outputs[output]?.value).toContain('steps.releaselog.outputs');
    }
  });

  it('contains no emojis in the manifest', () => {
    expect(/[\u{1f300}-\u{1faff}]/u.test(readFileSync(resolvePath('action.yml'), 'utf8'))).toBe(
      false,
    );
  });
});
