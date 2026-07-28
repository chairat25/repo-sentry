#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { analyzeAll, discoverRepos } from '@repo-sentry/core';
import { runCheck } from './check.js';
import { formatStatusTable } from './format.js';
import { installHooks, uninstallHooks } from './hooks.js';

const USAGE = `repo-sentry — warn when a git repo is behind its remote

Usage:
  repo-sentry check [--path <dir>] [--json] [--no-fetch] [--quiet]
                    [--stage commit|push] [--fetch-timeout <ms>]
  repo-sentry status [--path <dir>]
  repo-sentry install-hooks [--path <dir>]
  repo-sentry uninstall-hooks [--path <dir>]

Exit codes for \`check\`:
  0  all repositories synced (or ahead, unreachable, or untracked)
  1  at least one repository is behind or diverged
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

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`repo-sentry: ${String(err)}\n`);
    process.exitCode = 2;
  });
