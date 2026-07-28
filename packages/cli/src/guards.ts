import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { minimatch } from 'minimatch';
import { discoverRepos } from '@repo-sentry/core';

/**
 * Prepended to a run script. POSIX `sh` and `command -v` only — no dependency
 * on npm, yarn, pnpm, or bun, and no reliance on `pre`/`post` lifecycle hooks,
 * which yarn Berry does not run.
 *
 * The `if` matters: a plain `cmd && guard` would break boot for a teammate who
 * has not installed the CLI, and `guard || true` would swallow a real block.
 */
export const GUARD_PREFIX =
  "sh -c 'if command -v repo-sentry >/dev/null 2>&1; then repo-sentry guard; fi'";

/**
 * Script names that start a long-running process, across ecosystems. These are
 * patterns, not a fixed list — a project using `serve` or `watch:api` is
 * covered without configuration, and anything else can be named explicitly.
 */
export const DEFAULT_MATCH = [
  'start',
  'start:*',
  'dev',
  'dev:*',
  'serve',
  'serve:*',
  'watch',
  'watch:*',
] as const;

/**
 * Beats DEFAULT_MATCH. Guarding a production start would refuse to boot a
 * deployed service over a git state that does not apply there.
 */
export const DEFAULT_EXCLUDE = [
  '*prod*',
  '*build*',
  '*test*',
  '*e2e*',
  '*lint*',
  '*migration*',
  '*seed*',
] as const;

export interface ClassifyOptions {
  /** Explicit script names. When given, the match patterns are ignored entirely. */
  readonly scripts?: readonly string[] | undefined;
  /** Extra patterns added to the defaults. */
  readonly match?: readonly string[] | undefined;
  /** Extra patterns added to the defaults. Always beats a match. */
  readonly exclude?: readonly string[] | undefined;
}

export interface ScriptDecision {
  readonly name: string;
  readonly command: string;
  readonly guard: boolean;
  readonly alreadyGuarded: boolean;
  /** Why this script was skipped. Empty when guard is true. */
  readonly reason: string;
}

export function classifyScripts(
  scripts: Readonly<Record<string, string>>,
  opts: ClassifyOptions = {},
): ScriptDecision[] {
  const exclude = [...DEFAULT_EXCLUDE, ...(opts.exclude ?? [])];
  const explicit = opts.scripts;

  return Object.entries(scripts).map(([name, command]) => {
    const alreadyGuarded = command.includes(GUARD_PREFIX);

    if (explicit !== undefined) {
      const guard = explicit.includes(name);
      return {
        name,
        command,
        guard,
        alreadyGuarded,
        reason: guard ? '' : 'not in --scripts',
      };
    }

    const excludedBy = exclude.find((pattern) => minimatch(name, pattern));
    if (excludedBy !== undefined) {
      return { name, command, guard: false, alreadyGuarded, reason: `excluded by ${excludedBy}` };
    }

    const matched = [...DEFAULT_MATCH, ...(opts.match ?? [])].some((pattern) =>
      minimatch(name, pattern),
    );
    return {
      name,
      command,
      guard: matched,
      alreadyGuarded,
      reason: matched ? '' : 'not a run script',
    };
  });
}

export interface GuardsOptions extends ClassifyOptions {
  /** Write the changes. Without it, the report describes what would happen. */
  readonly apply?: boolean | undefined;
}

export interface GuardsReport {
  /** Scripts that were (or would be) modified. */
  readonly changed: { readonly repo: string; readonly script: string }[];
  /** Every script considered, per repo, for display. */
  readonly decisions: { readonly repo: string; readonly decisions: ScriptDecision[] }[];
  /** Repositories with no package.json — nothing to guard. */
  readonly skippedRepos: string[];
}

export async function installGuards(root: string, opts: GuardsOptions = {}): Promise<GuardsReport> {
  return apply(root, opts, addPrefix);
}

export async function uninstallGuards(
  root: string,
  opts: GuardsOptions = {},
): Promise<GuardsReport> {
  return apply(root, opts, removePrefix);
}

type Rewrite = (command: string) => string | null;

/** Returns the guarded command, or null when it is already guarded. */
function addPrefix(command: string): string | null {
  if (command.includes(GUARD_PREFIX)) return null;
  return `${GUARD_PREFIX} && ${command}`;
}

/** Returns the bare command, or null when there was no guard to remove. */
function removePrefix(command: string): string | null {
  if (!command.includes(GUARD_PREFIX)) return null;
  return command.replace(`${GUARD_PREFIX} && `, '').replace(GUARD_PREFIX, '').trim();
}

async function apply(
  root: string,
  opts: GuardsOptions,
  rewrite: Rewrite,
): Promise<GuardsReport> {
  const repos = await discoverRepos([resolve(root)]);
  const changed: { repo: string; script: string }[] = [];
  const decisions: { repo: string; decisions: ScriptDecision[] }[] = [];
  const skippedRepos: string[] = [];

  for (const repo of repos) {
    const pkg = await readPackageJson(repo);
    if (pkg === null) {
      skippedRepos.push(repo);
      continue;
    }

    const scripts = isScriptMap(pkg['scripts']) ? pkg['scripts'] : {};
    const local = await readLocalConfig(repo);
    const repoDecisions = classifyScripts(scripts, {
      scripts: local?.guardScripts ?? opts.scripts,
      match: opts.match,
      exclude: opts.exclude,
    });
    decisions.push({ repo, decisions: repoDecisions });

    const next: Record<string, string> = { ...scripts };
    let dirty = false;
    for (const decision of repoDecisions) {
      if (!decision.guard) continue;
      const rewritten = rewrite(decision.command);
      if (rewritten === null) continue;
      next[decision.name] = rewritten;
      changed.push({ repo, script: decision.name });
      dirty = true;
    }

    if (dirty && opts.apply === true) {
      await writePackageJson(repo, { ...pkg, scripts: next });
    }
  }

  return { changed, decisions, skippedRepos };
}

async function readPackageJson(repo: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(repo, 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Rewrites only the `scripts` key. Every other field, and the key order, is
 * preserved by spreading the parsed document.
 */
async function writePackageJson(repo: string, pkg: Record<string, unknown>): Promise<void> {
  await writeFile(join(repo, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

interface LocalConfig {
  readonly guardScripts?: readonly string[];
}

/** A repo can name its own scripts, overriding both patterns and CLI flags. */
async function readLocalConfig(repo: string): Promise<LocalConfig | null> {
  try {
    const raw = await readFile(join(repo, '.repo-sentry.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const guardScripts = (parsed as LocalConfig | null)?.guardScripts;
    if (!Array.isArray(guardScripts)) return null;
    return { guardScripts: guardScripts.filter((s): s is string => typeof s === 'string') };
  } catch {
    return null;
  }
}

function isScriptMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
