#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { analyzeAll, discoverRepos } from '@repo-sentry/core';
import { runCheck } from './check.js';
import { formatStatusTable } from './format.js';
import { installHooks, uninstallHooks } from './hooks.js';
import { runGuard } from './guard.js';
import { installGuards, uninstallGuards, type GuardsReport } from './guards.js';

const USAGE = `repo-sentry — warn when a git repo is behind its remote

Usage:
  repo-sentry check [--path <dir>] [--json] [--no-fetch] [--quiet]
                    [--stage commit|push] [--fetch-timeout <ms>]
  repo-sentry status [--path <dir>]
  repo-sentry guard [--path <dir>]

  repo-sentry install-hooks [--path <dir>]
  repo-sentry uninstall-hooks [--path <dir>]

  repo-sentry install-guards [--path <dir>] [--yes]
                    [--scripts <a,b,c>] [--match <glob>] [--exclude <glob>]
  repo-sentry uninstall-guards [--path <dir>] [--yes]

\`guard\` refuses to let one repository boot while it is behind its remote.
Wire it into your run scripts with \`install-guards\`, which shows what it
would change and only writes when given --yes.

Set REPO_SENTRY_SKIP=1 to bypass the guard for one command.

Exit codes for \`check\` and \`guard\`:
  0  synced (or ahead, unreachable, or untracked)
  1  behind or diverged
  2  internal error
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      path: { type: 'string' },
      json: { type: 'boolean', default: false },
      'no-fetch': { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      stage: { type: 'string' },
      'fetch-timeout': { type: 'string' },
      yes: { type: 'boolean', default: false, short: 'y' },
      scripts: { type: 'string' },
      match: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      help: { type: 'boolean', default: false, short: 'h' },
    },
  });

  const command = positionals[0];

  if (values.help === true || command === undefined) {
    process.stdout.write(USAGE);
    return command === undefined ? 2 : 0;
  }

  switch (command) {
    case 'check': {
      if (values.stage !== undefined && values.stage !== 'commit' && values.stage !== 'push') {
        process.stderr.write(`repo-sentry: --stage must be "commit" or "push"\n`);
        return 2;
      }
      const timeoutRaw = values['fetch-timeout'];
      const fetchTimeoutMs = timeoutRaw === undefined ? undefined : Number(timeoutRaw);
      if (fetchTimeoutMs !== undefined && !Number.isFinite(fetchTimeoutMs)) {
        process.stderr.write(`repo-sentry: --fetch-timeout must be a number of milliseconds\n`);
        return 2;
      }

      const result = await runCheck({
        path: values.path,
        json: values.json,
        noFetch: values['no-fetch'],
        quiet: values.quiet,
        stage: values.stage,
        fetchTimeoutMs,
      });
      if (result.output !== '') {
        const stream = result.exitCode === 1 ? process.stderr : process.stdout;
        stream.write(`${result.output}\n`);
      }
      return result.exitCode;
    }
    case 'status': {
      const root = resolve(values.path ?? process.cwd());
      const repos = await discoverRepos([root]);
      const statuses = await analyzeAll(repos);
      process.stdout.write(`${formatStatusTable(statuses)}\n`);
      return 0;
    }
    case 'guard': {
      const result = await runGuard({
        path: values.path,
        // Any non-empty value counts. Documented as REPO_SENTRY_SKIP=1.
        skip: (process.env['REPO_SENTRY_SKIP'] ?? '') !== '',
      });
      if (result.output !== '') process.stderr.write(`${result.output}\n`);
      return result.exitCode;
    }
    case 'install-guards':
    case 'uninstall-guards': {
      const run = command === 'install-guards' ? installGuards : uninstallGuards;
      const report = await run(values.path ?? process.cwd(), {
        apply: values.yes,
        scripts: values.scripts?.split(',').map((s) => s.trim()).filter((s) => s !== ''),
        match: values.match,
        exclude: values.exclude,
      });
      process.stdout.write(formatGuardsReport(report, values.yes === true, command));
      return 0;
    }
    case 'install-hooks': {
      const report = await installHooks(values.path ?? process.cwd());
      for (const p of report.installed) process.stdout.write(`installed  ${p}\n`);
      for (const p of report.replaced) process.stdout.write(`updated    ${p}\n`);
      for (const s of report.skipped) process.stderr.write(`skipped    ${s.path}\n  ${s.reason}\n`);
      return 0;
    }
    case 'uninstall-hooks': {
      const report = await uninstallHooks(values.path ?? process.cwd());
      for (const s of report.skipped) process.stderr.write(`skipped    ${s.path} — ${s.reason}\n`);
      process.stdout.write('repo-sentry: hooks removed\n');
      return 0;
    }
    default:
      process.stderr.write(`repo-sentry: unknown command "${command}"\n\n${USAGE}`);
      return 2;
  }
}

/**
 * Shows every script considered and why, not just the ones that changed —
 * a developer needs to be able to tell that a script they expected to be
 * guarded was skipped, and for what reason.
 */
function formatGuardsReport(report: GuardsReport, applied: boolean, command: string): string {
  const lines: string[] = [];

  for (const { repo, decisions } of report.decisions) {
    if (decisions.length === 0) continue;
    lines.push(`${repo}/package.json`);
    for (const d of decisions) {
      const verb = d.guard ? (d.alreadyGuarded ? 'ok     ' : 'guard  ') : 'skip   ';
      const note = d.guard ? (d.alreadyGuarded ? '(already guarded)' : d.command) : `(${d.reason})`;
      lines.push(`  ${verb}${d.name.padEnd(20)}${note}`);
    }
    lines.push('');
  }

  for (const repo of report.skippedRepos) {
    lines.push(`${repo} — no package.json, nothing to guard`);
  }
  if (report.skippedRepos.length > 0) lines.push('');

  const n = report.changed.length;
  const noun = n === 1 ? 'script' : 'scripts';
  if (n === 0) {
    lines.push('Nothing to change.');
  } else if (applied) {
    lines.push(`Updated ${n} ${noun}.`);
  } else {
    lines.push(`Would change ${n} ${noun}. Nothing was written.`);
    lines.push(`Re-run with --yes to apply:  repo-sentry ${command} --yes`);
  }

  return `${lines.join('\n')}\n`;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`repo-sentry: ${String(err)}\n`);
    process.exitCode = 2;
  });
