import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { discoverRepos } from '@repo-sentry/core';

/** Presence of this line means the hook belongs to repo-sentry and is safe to replace. */
export const HOOK_MARKER = '# repo-sentry-managed-hook';

export interface HookReport {
  readonly installed: string[];
  readonly replaced: string[];
  readonly skipped: { readonly path: string; readonly reason: string }[];
}

const HOOK_NAMES = ['pre-commit', 'pre-push'] as const;
type HookName = (typeof HOOK_NAMES)[number];

/** Commit-time fetch budget. Long enough for a normal network, short enough not to stall a commit. */
const COMMIT_FETCH_TIMEOUT_MS = 3_000;

/**
 * Both hooks fetch. Reading cached refs at commit time was tried and rejected:
 * a clone that has not fetched since a teammate's push reads as synced, which
 * is exactly the case the tool exists to catch. A fetch that times out yields
 * `unreachable`, which never blocks, so a slow network costs 3 seconds and
 * nothing else.
 */
function hookScript(name: HookName): string {
  const stage = name === 'pre-commit' ? 'commit' : 'push';
  const budget = name === 'pre-commit' ? ` --fetch-timeout ${COMMIT_FETCH_TIMEOUT_MS}` : '';
  return [
    '#!/bin/sh',
    HOOK_MARKER,
    '# Managed by repo-sentry. Re-run `repo-sentry install-hooks` to update.',
    '',
    '# Exit quietly when the CLI is not installed, so a teammate who has not',
    '# set it up is never blocked by a hook they did not ask for.',
    'command -v repo-sentry >/dev/null 2>&1 || exit 0',
    '',
    'repo_root=$(git rev-parse --show-toplevel) || exit 0',
    `repo-sentry check --stage ${stage}${budget} --path "$repo_root"`,
    '',
  ].join('\n');
}

export async function installHooks(root: string): Promise<HookReport> {
  return applyToRepos(root, installOne);
}

export async function uninstallHooks(root: string): Promise<HookReport> {
  return applyToRepos(root, uninstallOne);
}

type HookAction = (repo: string, name: HookName, report: MutableReport) => Promise<void>;

interface MutableReport {
  installed: string[];
  replaced: string[];
  skipped: { path: string; reason: string }[];
}

async function applyToRepos(root: string, action: HookAction): Promise<HookReport> {
  const repos = await discoverRepos([resolve(root)]);
  const report: MutableReport = { installed: [], replaced: [], skipped: [] };

  for (const repo of repos) {
    for (const name of HOOK_NAMES) {
      await action(repo, name, report);
    }
  }

  return {
    installed: [...report.installed],
    replaced: [...report.replaced],
    skipped: [...report.skipped],
  };
}

async function installOne(repo: string, name: HookName, report: MutableReport): Promise<void> {
  const dir = join(repo, '.git', 'hooks');
  const path = join(dir, name);
  const existing = await readIfExists(path);

  if (existing !== null && !existing.includes(HOOK_MARKER)) {
    const stage = name === 'pre-commit' ? 'commit' : 'push';
    report.skipped.push({
      path,
      reason:
        'a hook already exists here and repo-sentry did not write it — append this line manually:\n' +
        `    repo-sentry check --stage ${stage} --path "$(git rev-parse --show-toplevel)"`,
    });
    return;
  }

  await mkdir(dir, { recursive: true });
  await writeFile(path, hookScript(name), 'utf8');
  await chmod(path, 0o755);

  if (existing === null) report.installed.push(path);
  else report.replaced.push(path);
}

async function uninstallOne(repo: string, name: HookName, report: MutableReport): Promise<void> {
  const path = join(repo, '.git', 'hooks', name);
  const existing = await readIfExists(path);

  if (existing === null) return;
  if (!existing.includes(HOOK_MARKER)) {
    report.skipped.push({ path, reason: 'not written by repo-sentry' });
    return;
  }

  await rm(path, { force: true });
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
