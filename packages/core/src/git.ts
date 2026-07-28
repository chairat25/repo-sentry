import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_CMD_TIMEOUT_MS = 5_000;

export interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
}

export type GitErrorCode = 'timeout' | 'failed' | 'not-found';

export class GitError extends Error {
  readonly code: GitErrorCode;
  readonly stderr: string;

  constructor(message: string, code: GitErrorCode, stderr: string) {
    super(message);
    this.name = 'GitError';
    this.code = code;
    this.stderr = stderr;
  }
}

/**
 * Runs a git command and returns its trimmed output.
 *
 * Never prompts: `GIT_TERMINAL_PROMPT=0` disables git's own credential prompt
 * and `ssh -oBatchMode=yes` disables ssh's. Without these, a repo with broken
 * credentials would hang until the timeout instead of failing immediately.
 */
export async function runGit(
  cwd: string,
  args: readonly string[],
  timeoutMs: number = DEFAULT_CMD_TIMEOUT_MS,
): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', [...args], {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: 'ssh -oBatchMode=yes',
        LC_ALL: 'C',
      },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    throw toGitError(err, args, timeoutMs);
  }
}

function toGitError(err: unknown, args: readonly string[], timeoutMs: number): GitError {
  const e = err as NodeJS.ErrnoException & {
    stderr?: string;
    killed?: boolean;
    signal?: string;
  };
  const stderr = (e.stderr ?? '').trim();

  if (e.code === 'ENOENT') {
    return new GitError('git binary or working directory not found', 'not-found', stderr);
  }
  if (e.killed === true || e.signal === 'SIGTERM') {
    return new GitError(`git ${args[0] ?? ''} timed out after ${timeoutMs}ms`, 'timeout', stderr);
  }
  return new GitError(`git ${args.join(' ')} failed`, 'failed', stderr);
}
