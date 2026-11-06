import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Workflow {
  on?: {
    pull_request?: unknown;
    workflow_call?: { inputs?: Record<string, unknown> };
    push?: { branches?: string[]; tags?: string[] };
  };
  jobs?: Record<
    string,
    {
      needs?: string | string[];
      uses?: string;
      with?: Record<string, string>;
      steps?: Array<{ uses?: string; run?: string; with?: Record<string, string | boolean> }>;
    }
  >;
}

function workflow(path: string): Workflow {
  const raw: unknown = parse(readFileSync(resolvePath(path), 'utf8'));
  return raw as Workflow;
}

describe('release workflow', () => {
  const selfRelease = workflow('.github/workflows/self-release.yml');
  const ci = workflow('.github/workflows/ci.yml');

  it('runs on release tags', () => {
    expect(selfRelease.on?.push?.tags).toContain('v*');
  });

  it('runs CI against the tag before the release job', () => {
    const ciJob = selfRelease.jobs?.ci;
    const releaseJob = selfRelease.jobs?.release;

    expect(ciJob?.uses).toBe('./.github/workflows/ci.yml');
    expect(ciJob?.with?.ref).toContain('needs.resolve.outputs.tag');
    expect(releaseJob?.needs).toEqual(expect.arrayContaining(['resolve', 'ci']));
  });

  it('keeps self-release deterministic regardless of repository config', () => {
    const releaseStep = selfRelease.jobs?.release?.steps?.find((step) => step.uses === './');

    expect(String(releaseStep?.with?.humanize)).toBe('false');
  });

  it('does not run on branch pushes or pull requests', () => {
    expect(ci.on?.pull_request).toBeUndefined();
    expect(ci.on?.push).toBeUndefined();
  });

  it('exposes the CI workflow as reusable and checks out the requested ref', () => {
    expect(ci.on?.workflow_call).toBeDefined();

    const checkout = ci.jobs?.test?.steps?.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    expect(checkout).toBeDefined();
    expect((checkout as { with?: Record<string, string> }).with?.ref).toContain('inputs.ref');
  });
});
