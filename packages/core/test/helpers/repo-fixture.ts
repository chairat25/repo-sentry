import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from '../../src/git.js';

export interface Fixture {
  /** Temp directory containing the bare remote and every clone. */
  readonly root: string;
  /** Absolute path to the bare remote. */
  readonly remote: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Creates a bare remote on branch `dev` with one seed commit, so that clones
 * get a real tracking branch. Cloning an empty bare repo would not.
 */
export async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'repo-sentry-'));
  const remote = join(root, 'remote.git');
  await runGit(root, ['init', '--bare', '--initial-branch=dev', 'remote.git']);

  const seed = join(root, '__seed');
  await runGit(root, ['clone', remote, '__seed']);
  await configureIdentity(seed);
  await writeFile(join(seed, 'README.md'), '# seed\n');
  await runGit(seed, ['add', 'README.md']);
  await runGit(seed, ['commit', '-m', 'seed']);
  await runGit(seed, ['push', 'origin', 'dev']);

  return { root, remote, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Clones the fixture remote into `root/name` and returns the clone path. */
export async function makeClone(fx: Fixture, name: string): Promise<string> {
  const path = join(fx.root, name);
  await runGit(fx.root, ['clone', fx.remote, name]);
  await configureIdentity(path);
  return path;
}

/** Adds a file, commits, and pushes to the tracked remote branch. */
export async function commitAndPush(repo: string, filename: string): Promise<void> {
  await commitLocal(repo, filename);
  await runGit(repo, ['push', 'origin', 'HEAD']);
}

/** Adds a file and commits locally, without pushing. */
export async function commitLocal(repo: string, filename: string): Promise<void> {
  await writeFile(join(repo, filename), `${filename}\n`);
  await runGit(repo, ['add', filename]);
  await runGit(repo, ['commit', '-m', `add ${filename}`]);
}

async function configureIdentity(repo: string): Promise<void> {
  await runGit(repo, ['config', 'user.email', 'test@example.com']);
  await runGit(repo, ['config', 'user.name', 'repo-sentry test']);
  await runGit(repo, ['config', 'commit.gpgsign', 'false']);
}
