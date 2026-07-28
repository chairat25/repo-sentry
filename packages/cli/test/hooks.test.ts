import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOOK_MARKER, installHooks, uninstallHooks } from '../src/hooks.js';
import { makeClone, makeFixture, type Fixture } from '../../core/test/helpers/repo-fixture.js';

let fx: Fixture | null = null;
afterEach(async () => {
  await fx?.cleanup();
  fx = null;
});

const hookPath = (repo: string, name: string): string => join(repo, '.git', 'hooks', name);

describe('installHooks', () => {
  it('writes pre-commit and pre-push into a repo with no hooks', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');

    const report = await installHooks(repo);

    expect(report.installed).toContain(hookPath(repo, 'pre-commit'));
    expect(report.installed).toContain(hookPath(repo, 'pre-push'));
    expect(await readFile(hookPath(repo, 'pre-commit'), 'utf8')).toContain(HOOK_MARKER);
  });

  it('makes the installed hooks executable', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');

    await installHooks(repo);

    const { mode } = await stat(hookPath(repo, 'pre-commit'));
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it('replaces a hook it previously installed', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');
    await installHooks(repo);

    const report = await installHooks(repo);

    expect(report.replaced).toContain(hookPath(repo, 'pre-commit'));
    expect(report.installed).not.toContain(hookPath(repo, 'pre-commit'));
  });

  it('refuses to overwrite a hook it does not own', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');
    const existing = '#!/bin/sh\necho "someone else owns this"\n';
    await writeFile(hookPath(repo, 'pre-commit'), existing);
    await chmod(hookPath(repo, 'pre-commit'), 0o755);

    const report = await installHooks(repo);

    expect(report.skipped.map((s) => s.path)).toContain(hookPath(repo, 'pre-commit'));
    expect(await readFile(hookPath(repo, 'pre-commit'), 'utf8')).toBe(existing);
  });

  it('installs into every repo below a non-repo root', async () => {
    fx = await makeFixture();
    const a = await makeClone(fx, 'a');
    const b = await makeClone(fx, 'b');

    const report = await installHooks(fx.root);

    expect(report.installed).toContain(hookPath(a, 'pre-push'));
    expect(report.installed).toContain(hookPath(b, 'pre-push'));
  });

  it('produces a pre-commit hook that fetches on a short budget', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    await installHooks(mine);

    const script = await readFile(hookPath(mine, 'pre-commit'), 'utf8');

    expect(script).toContain('repo-sentry check');
    expect(script).toContain('--stage commit');
    // A live fetch is the whole point — cached refs go stale silently.
    expect(script).not.toContain('--no-fetch');
    expect(script).toContain('--fetch-timeout 3000');
    // Exits 0 when the CLI is absent, so a teammate without it is never blocked.
    expect(script).toContain('command -v repo-sentry');
  });

  it('produces a pre-push hook that uses push wording and a full fetch budget', async () => {
    fx = await makeFixture();
    const mine = await makeClone(fx, 'mine');
    await installHooks(mine);

    const script = await readFile(hookPath(mine, 'pre-push'), 'utf8');

    expect(script).toContain('repo-sentry check');
    expect(script).toContain('--stage push');
    expect(script).not.toContain('--no-fetch');
    expect(script).not.toContain('--fetch-timeout');
  });
});

describe('uninstallHooks', () => {
  it('removes hooks it owns', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');
    await installHooks(repo);

    const report = await uninstallHooks(repo);

    expect(report.installed).toHaveLength(0);
    await expect(readFile(hookPath(repo, 'pre-commit'), 'utf8')).rejects.toThrow();
  });

  it('leaves foreign hooks alone', async () => {
    fx = await makeFixture();
    const repo = await makeClone(fx, 'mine');
    const existing = '#!/bin/sh\nexit 0\n';
    await writeFile(hookPath(repo, 'pre-commit'), existing);

    const report = await uninstallHooks(repo);

    expect(report.skipped.map((s) => s.path)).toContain(hookPath(repo, 'pre-commit'));
    expect(await readFile(hookPath(repo, 'pre-commit'), 'utf8')).toBe(existing);
  });
});
