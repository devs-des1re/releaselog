import { spawnSync } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = resolvePath('.github/scripts/floating-tag.mjs');

function resolveFloatingTag(tag: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [script, tag], { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

describe('floating-tag script', () => {
  it.each([
    ['v1.0.0', 'name=v1'],
    ['v1.5.3', 'name=v1'],
    ['v2.0.0', 'name=v2'],
    ['v2.4.1', 'name=v2'],
    ['v1.5.0-beta.1', 'name=v1-beta'],
    ['v2.0.0-beta.1', 'name=v2-beta'],
    ['v2.0.0-rc.1', 'name=v2-beta'],
    ['v2.0.0+build.1', 'name=v2'],
    ['v2.0.0-beta.1+build.1', 'name=v2-beta'],
  ])('maps %s to %s', (tag, expected) => {
    const result = resolveFloatingTag(tag);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expected);
  });

  it.each(['1.0.0', 'v2.0', 'v2', 'release-1.0.0', 'v02.0.0', 'v1.0.0-', ''])(
    'rejects invalid tag %s',
    (tag) => {
      const result = resolveFloatingTag(tag);

      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('is not vMAJOR.MINOR.PATCH');
    },
  );
});
