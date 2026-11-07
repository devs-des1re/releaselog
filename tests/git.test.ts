import { describe, expect, it } from 'vitest';

import { Git, GitError, type ExecFn, type ExecResult } from '../src/git';

const ok = (stdout: string): ExecResult => ({ stdout, stderr: '', exitCode: 0 });
const fail = (exitCode = 1, stderr = ''): ExecResult => ({ stdout: '', stderr, exitCode });

const execResult =
  (result: ExecResult): ExecFn =>
  () =>
    Promise.resolve(result);

const execFrom =
  (handler: (args: string[]) => ExecResult): ExecFn =>
  (_command, args) =>
    Promise.resolve(handler(args));

describe('Git', () => {
  it('detects a shallow clone', async () => {
    const git = new Git(execResult(ok('true\n')));
    await expect(git.isShallow()).resolves.toBe(true);
  });

  it('detects a full clone', async () => {
    const git = new Git(execResult(ok('false\n')));
    await expect(git.isShallow()).resolves.toBe(false);
  });

  it('passes the working directory to every command', async () => {
    const calls: string[][] = [];
    const git = new Git(
      execFrom((args) => {
        calls.push(args);
        return ok('false\n');
      }),
      'C:/repo',
    );

    await git.isShallow();

    expect(calls).toEqual([['rev-parse', '--is-shallow-repository']]);
  });

  it('throws a GitError with stderr when a command fails', async () => {
    const git = new Git(execResult(fail(128, 'fatal: bad revision\n')));

    await expect(git.run(['rev-parse', 'missing'])).rejects.toMatchObject({
      name: 'GitError',
      exitCode: 128,
      stderr: 'fatal: bad revision\n',
    });
  });

  it('resolves an annotated tag to its commit', async () => {
    const calls: string[][] = [];
    const git = new Git(
      execFrom((args) => {
        calls.push(args);
        return ok('abc123\n');
      }),
    );

    await expect(git.resolveCommit('v1.0.0')).resolves.toBe('abc123');
    expect(calls[0]).toEqual(['rev-parse', '--verify', '--end-of-options', 'v1.0.0^{commit}']);
  });

  it('treats option-like refs as revisions, not git flags', async () => {
    const calls: string[][] = [];
    const git = new Git(
      execFrom((args) => {
        calls.push(args);
        return ok('abc123\n');
      }),
    );

    await git.resolveCommit('-n');
    await git.isAncestor('-n', 'v1.0.0');
    await git.log(['-n..HEAD']);

    expect(calls[0]).toContain('--end-of-options');
    expect(calls[1]).toEqual(['merge-base', '--is-ancestor', '--', '-n', 'v1.0.0']);
    expect(calls[2]).toContain('--end-of-options');
  });

  it('reports whether a tag exists', async () => {
    const git = new Git(
      execFrom((args) => (args[3] === 'refs/tags/v1.0.0^{commit}' ? ok('abc123\n') : fail())),
    );

    await expect(git.tagExists('v1.0.0')).resolves.toBe(true);
    await expect(git.tagExists('v2.0.0')).resolves.toBe(false);
  });

  it('lists tags with their commit sha and creation date', async () => {
    const output = [
      'v0.1.0\tabc123\t2025-01-01T00:00:00+00:00',
      'v0.2.0\tdef456\t2025-02-01T00:00:00+00:00',
      '',
      'not-a-tag',
    ].join('\n');
    const git = new Git(execResult(ok(output)));

    await expect(git.listTags()).resolves.toEqual([
      { name: 'v0.1.0', sha: 'abc123', createdAt: '2025-01-01T00:00:00+00:00' },
      { name: 'v0.2.0', sha: 'def456', createdAt: '2025-02-01T00:00:00+00:00' },
    ]);
  });

  it('uses merge-base to answer ancestry questions', async () => {
    const git = new Git(execResult(ok('')));
    await expect(git.isAncestor('v1.0.0', 'v1.1.0')).resolves.toBe(true);

    const notAncestor = new Git(execResult(fail(1)));
    await expect(notAncestor.isAncestor('v1.0.0', 'v0.9.0')).resolves.toBe(false);

    const broken = new Git(execResult(fail(128, 'fatal: bad object\n')));
    await expect(broken.isAncestor('nope', 'v1.0.0')).rejects.toBeInstanceOf(GitError);
  });

  it('prefers the remote tracking branch and falls back to a local branch', async () => {
    const remote = new Git(
      execFrom((args) =>
        args[3] === 'refs/remotes/origin/dev^{commit}' ? ok('remote123\n') : fail(),
      ),
    );
    await expect(remote.resolveBranchHead('dev')).resolves.toBe('remote123');

    const local = new Git(
      execFrom((args) => (args[3] === 'refs/heads/dev^{commit}' ? ok('local456\n') : fail())),
    );
    await expect(local.resolveBranchHead('dev')).resolves.toBe('local456');

    const missing = new Git(execResult(fail()));
    await expect(missing.resolveBranchHead('dev')).resolves.toBeNull();
  });

  it('parses git log records including bodies and parents', async () => {
    const separator = '\x1f';
    const fields = [
      'aaaa1111',
      'bbbb2222 cccc3333',
      'Arjun',
      'arjun@example.com',
      'feat: add release notes (#42)',
      'Body line one\nBody line two',
    ].join(separator);
    const second = ['dddd4444', '', 'Bot', 'bot@example.com', 'chore: update deps', ''].join(
      separator,
    );

    const git = new Git(execResult(ok(`${fields}\x00${second}\x00`)));

    await expect(git.log(['v0.1.0..v0.2.0'])).resolves.toEqual([
      {
        sha: 'aaaa1111',
        shortSha: 'aaaa111',
        parents: ['bbbb2222', 'cccc3333'],
        title: 'feat: add release notes (#42)',
        body: 'Body line one\nBody line two',
        authorName: 'Arjun',
        authorEmail: 'arjun@example.com',
      },
      {
        sha: 'dddd4444',
        shortSha: 'dddd444',
        parents: [],
        title: 'chore: update deps',
        body: '',
        authorName: 'Bot',
        authorEmail: 'bot@example.com',
      },
    ]);
  });

  it('returns no commits for an empty log', async () => {
    const git = new Git(execResult(ok('\n')));
    await expect(git.log(['v1.0.0..v1.0.0'])).resolves.toEqual([]);
  });
});
