import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GUARD_PREFIX,
  classifyScripts,
  installGuards,
  uninstallGuards,
} from '../src/guards.js';

let root = '';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'guards-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  root = '';
});

async function makeRepo(name: string, scripts: Record<string, string>): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, '.git'), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, scripts }, null, 2), 'utf8');
  return dir;
}

async function readScripts(dir: string): Promise<Record<string, string>> {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  return pkg.scripts;
}

describe('classifyScripts', () => {
  it('guards the common run-script names across ecosystems', () => {
    const decisions = classifyScripts({
      start: 'node main.js',
      'start:dev': 'nest start --watch',
      dev: 'vite',
      'dev:ssr': 'next dev',
      serve: 'ng serve',
      'watch:api': 'tsx watch src',
    });

    expect(decisions.filter((d) => d.guard).map((d) => d.name).sort()).toEqual([
      'dev',
      'dev:ssr',
      'serve',
      'start',
      'start:dev',
      'watch:api',
    ]);
  });

  it('never guards a production script', () => {
    const decisions = classifyScripts({ 'start:prod': 'node dist/main', start: 'nest start' });

    expect(decisions.find((d) => d.name === 'start:prod')?.guard).toBe(false);
    expect(decisions.find((d) => d.name === 'start')?.guard).toBe(true);
  });

  it('never guards build, test, lint, or migration scripts', () => {
    const decisions = classifyScripts({
      build: 'tsc',
      test: 'vitest',
      'test:e2e': 'playwright test',
      lint: 'eslint .',
      'migration:run': 'typeorm migration:run',
    });

    expect(decisions.every((d) => !d.guard)).toBe(true);
  });

  it('honours an explicit script list, ignoring every pattern', () => {
    const decisions = classifyScripts(
      { start: 'x', 'weird-name': 'y', dev: 'z' },
      { scripts: ['weird-name'] },
    );

    expect(decisions.filter((d) => d.guard).map((d) => d.name)).toEqual(['weird-name']);
  });

  it('accepts extra match patterns', () => {
    const decisions = classifyScripts({ 'task:consume': 'node worker.js' }, { match: ['task:*'] });

    expect(decisions.find((d) => d.name === 'task:consume')?.guard).toBe(true);
  });

  it('accepts extra exclude patterns that beat the match patterns', () => {
    const decisions = classifyScripts({ 'start:ci': 'nest start' }, { exclude: ['*:ci'] });

    expect(decisions.find((d) => d.name === 'start:ci')?.guard).toBe(false);
  });

  it('reports a script that is already guarded as such', () => {
    const decisions = classifyScripts({ 'start:dev': `${GUARD_PREFIX} && nest start` });

    const decision = decisions.find((d) => d.name === 'start:dev');
    expect(decision?.guard).toBe(true);
    expect(decision?.alreadyGuarded).toBe(true);
  });

  it('gives a reason for every skipped script', () => {
    const decisions = classifyScripts({ build: 'tsc', 'start:prod': 'node dist/main' });

    expect(decisions.every((d) => d.guard || d.reason.length > 0)).toBe(true);
  });
});

describe('installGuards', () => {
  it('prefixes matching scripts and leaves the original command intact', async () => {
    const repo = await makeRepo('svc', { 'start:dev': 'kill-port 3802 && nest start --watch' });

    await installGuards(root, { apply: true });

    const scripts = await readScripts(repo);
    expect(scripts['start:dev']).toBe(`${GUARD_PREFIX} && kill-port 3802 && nest start --watch`);
  });

  it('does not write anything without apply', async () => {
    const repo = await makeRepo('svc', { 'start:dev': 'nest start' });

    const report = await installGuards(root, {});

    expect(await readScripts(repo)).toEqual({ 'start:dev': 'nest start' });
    expect(report.changed).toHaveLength(1);
  });

  it('is idempotent', async () => {
    const repo = await makeRepo('svc', { 'start:dev': 'nest start' });

    await installGuards(root, { apply: true });
    const afterFirst = await readScripts(repo);
    const report = await installGuards(root, { apply: true });

    expect(await readScripts(repo)).toEqual(afterFirst);
    expect(report.changed).toHaveLength(0);
  });

  it('leaves production scripts untouched', async () => {
    const repo = await makeRepo('svc', {
      'start:dev': 'nest start --watch',
      'start:prod': 'node dist/main',
    });

    await installGuards(root, { apply: true });

    expect((await readScripts(repo))['start:prod']).toBe('node dist/main');
  });

  it('handles a repo with no scripts at all', async () => {
    await makeRepo('svc', {});

    const report = await installGuards(root, { apply: true });

    expect(report.changed).toHaveLength(0);
  });

  it('skips a repo with no package.json', async () => {
    await mkdir(join(root, 'go-svc', '.git'), { recursive: true });

    const report = await installGuards(root, { apply: true });

    expect(report.skippedRepos).toContain(join(root, 'go-svc'));
  });

  it('covers every repo below the root', async () => {
    await makeRepo('a', { dev: 'vite' });
    await makeRepo('b', { start: 'node main.js' });

    const report = await installGuards(root, { apply: true });

    expect(report.changed).toHaveLength(2);
  });

  it('preserves formatting of unrelated package.json fields', async () => {
    const repo = await makeRepo('svc', { 'start:dev': 'nest start' });
    const pkgPath = join(repo, 'package.json');
    await writeFile(
      pkgPath,
      JSON.stringify(
        { name: 'svc', version: '1.2.3', scripts: { 'start:dev': 'nest start' }, custom: { a: 1 } },
        null,
        2,
      ),
      'utf8',
    );

    await installGuards(root, { apply: true });

    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, unknown>;
    expect(pkg['version']).toBe('1.2.3');
    expect(pkg['custom']).toEqual({ a: 1 });
  });

  it('reads guardScripts from a repo-local .repo-sentry.json', async () => {
    const repo = await makeRepo('svc', { start: 'nest start', bespoke: 'node odd.js' });
    await writeFile(
      join(repo, '.repo-sentry.json'),
      JSON.stringify({ guardScripts: ['bespoke'] }),
      'utf8',
    );

    await installGuards(root, { apply: true });

    const scripts = await readScripts(repo);
    expect(scripts['bespoke']).toContain(GUARD_PREFIX);
    expect(scripts['start']).toBe('nest start');
  });
});

describe('uninstallGuards', () => {
  it('restores the original command', async () => {
    const repo = await makeRepo('svc', { 'start:dev': 'kill-port 3802 && nest start' });
    await installGuards(root, { apply: true });

    await uninstallGuards(root, { apply: true });

    expect((await readScripts(repo))['start:dev']).toBe('kill-port 3802 && nest start');
  });

  it('leaves unguarded scripts alone', async () => {
    const repo = await makeRepo('svc', { build: 'tsc' });

    await uninstallGuards(root, { apply: true });

    expect((await readScripts(repo))['build']).toBe('tsc');
  });
});
