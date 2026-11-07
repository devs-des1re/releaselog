import * as exec from '@actions/exec';
import type { ExecOptions as ActionsExecOptions } from '@actions/exec';

import type { GitTag, RawCommit } from './types';

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ExecFn = (
  command: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

/** Runs a command through `@actions/exec`, capturing stdout and stderr. */
export const defaultExec: ExecFn = async (command, args, options = {}) => {
  let stdout = '';
  let stderr = '';

  const execOptions: ActionsExecOptions = {
    cwd: options.cwd,
    silent: true,
    ignoreReturnCode: true,
    env: options.env
      ? ({ ...process.env, ...options.env } as { [key: string]: string })
      : undefined,
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString();
      },
      stderr: (data: Buffer) => {
        stderr += data.toString();
      },
    },
  };

  const exitCode = await exec.exec(command, args, execOptions);
  return { stdout, stderr, exitCode };
};

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(
      `git ${args.join(' ')} failed with exit code ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
    );
    this.name = 'GitError';
  }
}

const FIELD_SEPARATOR = '\x1f';
const RECORD_SEPARATOR = '\x00';
const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%s', '%b'].join('%x1f');
const TAG_FORMAT = ['%(refname:short)', '%(objectname)', '%(creatordate:iso-strict)'].join('%09');

function parseLogRecord(record: string): RawCommit | null {
  const normalized = record.replace(/^\n/, '');
  if (normalized.length === 0) {
    return null;
  }

  const fields = normalized.split(FIELD_SEPARATOR);
  if (fields.length < 6) {
    return null;
  }

  const [sha, parents, authorName, authorEmail, title] = fields;
  const body = fields.slice(5).join(FIELD_SEPARATOR);

  if (!sha) {
    return null;
  }

  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    title,
    body: body.replace(/\s+$/, ''),
    authorName,
    authorEmail,
  };
}

/** Thin, injectable wrapper around the git CLI. */
export class Git {
  constructor(
    private readonly execFn: ExecFn = defaultExec,
    private readonly cwd?: string,
  ) {}

  async run(args: string[]): Promise<string> {
    const result = await this.execFn('git', args, { cwd: this.cwd });
    if (result.exitCode !== 0) {
      throw new GitError(args, result.exitCode, result.stderr);
    }
    return result.stdout;
  }

  async tryRun(args: string[]): Promise<string | null> {
    const result = await this.execFn('git', args, { cwd: this.cwd });
    return result.exitCode === 0 ? result.stdout : null;
  }

  async isShallow(): Promise<boolean> {
    const stdout = await this.run(['rev-parse', '--is-shallow-repository']);
    return stdout.trim() === 'true';
  }

  async resolveCommit(ref: string): Promise<string> {
    const stdout = await this.run(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
    return stdout.trim();
  }

  async tagExists(tag: string): Promise<boolean> {
    const stdout = await this.tryRun([
      'rev-parse',
      '--verify',
      '--end-of-options',
      `refs/tags/${tag}^{commit}`,
    ]);
    return stdout !== null;
  }

  async listTags(): Promise<GitTag[]> {
    const stdout = await this.run(['for-each-ref', `--format=${TAG_FORMAT}`, 'refs/tags']);
    return stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        const [name, sha, createdAt] = line.split('\t');
        if (!name || !sha || createdAt === undefined) {
          return [];
        }
        return [{ name, sha, createdAt }];
      });
  }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const args = ['merge-base', '--is-ancestor', '--', ancestor, descendant];
    const result = await this.execFn('git', args, { cwd: this.cwd });
    if (result.exitCode === 0) {
      return true;
    }
    if (result.exitCode === 1) {
      return false;
    }
    throw new GitError(args, result.exitCode, result.stderr);
  }

  /** Resolves a branch to a commit, preferring the remote tracking ref. */
  async resolveBranchHead(branch: string): Promise<string | null> {
    for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
      const stdout = await this.tryRun([
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${ref}^{commit}`,
      ]);
      if (stdout !== null && stdout.trim().length > 0) {
        return stdout.trim();
      }
    }
    return null;
  }

  async log(revisions: string[]): Promise<RawCommit[]> {
    const stdout = await this.run([
      'log',
      '-z',
      `--format=${LOG_FORMAT}`,
      '--end-of-options',
      ...revisions,
    ]);
    return stdout
      .split(RECORD_SEPARATOR)
      .map(parseLogRecord)
      .filter((commit): commit is RawCommit => commit !== null);
  }
}
