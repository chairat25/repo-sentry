import * as vscode from 'vscode';
import { Scheduler, discoverRepos, isStale, runGit, type RepoStatus } from '@repo-sentry/core';
import { renderBar } from './status-bar.js';
import { TransitionTracker } from './notifier.js';
import { renderNotification } from './messages.js';
import { pullAll } from './pull.js';

const PULL_NOW = 'Pull now';
const SNOOZE = 'Snooze 30m';
const DETAILS = 'Details';

let scheduler: Scheduler | null = null;
let bar: vscode.StatusBarItem | null = null;
let output: vscode.OutputChannel | null = null;
const tracker = new TransitionTracker();
let latest: RepoStatus[] | null = null;
/** Set when `notifyOnOpen` is false, so the opening batch seeds silently. */
let suppressFirstBatch = false;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('repo-sentry');
  bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  bar.command = 'repoSentry.showStatus';
  paint(null);
  bar.show();
  context.subscriptions.push(bar, output);

  scheduler = new Scheduler({
    intervalMs: config<number>('pollIntervalSeconds', 60) * 1000,
    fetchTimeoutMs: config<number>('fetchTimeoutMs', 15_000),
    onResults,
    onError: (err) => output?.appendLine(`poll failed: ${String(err)}`),
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('repoSentry.checkNow', () => scheduler?.tick()),
    vscode.commands.registerCommand('repoSentry.showStatus', showStatus),
    vscode.commands.registerCommand('repoSentry.pullAll', pullStale),
    vscode.commands.registerCommand('repoSentry.snooze', snoozeAll),
    vscode.commands.registerCommand('repoSentry.installHooks', installHooksCommand),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshRepos()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('repoSentry')) void reload();
    }),
    // Polling a backgrounded editor is wasted network. Resuming triggers an
    // immediate check, so returning to the IDE shows current information.
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) scheduler?.resume();
      else scheduler?.pause();
    }),
    { dispose: () => scheduler?.stop() },
  );

  void startup();
}

/**
 * Without git there is nothing this extension can do. Say so once, then go
 * quiet — a status bar that permanently reads "checking" would be worse.
 */
async function startup(): Promise<void> {
  if (!(await gitAvailable())) {
    bar?.hide();
    output?.appendLine('git binary not found on PATH — repo-sentry is inactive');
    void vscode.window.showErrorMessage(
      'repo-sentry: git was not found on your PATH. The extension is inactive.',
    );
    return;
  }

  await refreshRepos();
  suppressFirstBatch = !config<boolean>('notifyOnOpen', true);
  scheduler?.start();
}

async function gitAvailable(): Promise<boolean> {
  try {
    await runGit(process.cwd(), ['--version']);
    return true;
  } catch {
    return false;
  }
}

export function deactivate(): void {
  scheduler?.stop();
  scheduler = null;
}

function config<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('repoSentry').get<T>(key) ?? fallback;
}

async function refreshRepos(): Promise<void> {
  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const repos = await discoverRepos(
    roots,
    config<number>('maxDepth', 2),
    config<string[]>('exclude', []),
  );
  output?.appendLine(`watching ${repos.length} repositories`);
  scheduler?.setRepos(repos);
}

async function reload(): Promise<void> {
  scheduler?.stop();
  await refreshRepos();
  scheduler?.start();
}

function onResults(statuses: readonly RepoStatus[]): void {
  latest = [...statuses];
  paint(latest);

  const notifiable = tracker.pickNotifiable(latest, Date.now());

  if (suppressFirstBatch) {
    // pickNotifiable already recorded these counts, so they will not be
    // announced again until a repo falls further behind.
    suppressFirstBatch = false;
    return;
  }
  if (notifiable.length === 0) return;

  void vscode.window
    .showWarningMessage(`⚠ ${renderNotification(notifiable)}`, PULL_NOW, SNOOZE, DETAILS)
    .then((choice) => {
      if (choice === PULL_NOW) return pullStale();
      if (choice === SNOOZE) return snoozeAll();
      if (choice === DETAILS) return showStatus();
      return undefined;
    });
}

function paint(statuses: readonly RepoStatus[] | null): void {
  if (bar === null) return;
  const view = renderBar(statuses);
  bar.text = view.text;
  bar.tooltip = view.tooltip;
  bar.backgroundColor = view.warning
    ? new vscode.ThemeColor('statusBarItem.warningBackground')
    : undefined;
}

async function showStatus(): Promise<void> {
  if (latest === null || latest.length === 0) {
    void vscode.window.showInformationMessage('repo-sentry: no repositories found');
    return;
  }

  const items = latest.map((s) => ({
    label: `${isStale(s) ? '$(warning)' : '$(check)'} ${s.name}`,
    description: s.branch ?? 'detached',
    detail: describeDetail(s),
    status: s,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'repo-sentry',
    placeHolder: 'Select a repository to pull',
  });

  if (picked !== undefined && isStale(picked.status)) {
    await runPull([picked.status]);
  }
}

function describeDetail(s: RepoStatus): string {
  switch (s.state) {
    case 'behind':
      return `↓${s.behind} behind`;
    case 'diverged':
      return `↓${s.behind} ↑${s.ahead} — diverged`;
    case 'ahead':
      return `↑${s.ahead} ahead`;
    case 'unreachable':
      return `unreachable — ${s.error ?? 'unknown error'}`;
    case 'no-upstream':
      return 'no upstream branch';
    case 'detached':
      return 'detached HEAD';
    case 'synced':
      return 'up to date';
  }
}

async function pullStale(): Promise<void> {
  await runPull((latest ?? []).filter(isStale));
}

async function runPull(targets: readonly RepoStatus[]): Promise<void> {
  if (targets.length === 0) return;

  const outcomes = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'repo-sentry: pulling…' },
    () => pullAll(targets),
  );

  const failed = outcomes.filter((o) => !o.ok);
  for (const failure of failed) {
    output?.appendLine(`pull failed for ${failure.repo}: ${failure.error ?? ''}`);
  }

  if (failed.length > 0) {
    void vscode.window.showErrorMessage(
      `repo-sentry: could not fast-forward ${failed.map((f) => f.repo).join(', ')}. ` +
        'Resolve manually — see the repo-sentry output channel.',
      { modal: false },
    );
  }

  await scheduler?.tick();
}

function snoozeAll(): void {
  const minutes = config<number>('snoozeMinutes', 30);
  const paths = (latest ?? []).filter(isStale).map((s) => s.path);
  tracker.snooze(paths, Date.now() + minutes * 60_000);
  void vscode.window.showInformationMessage(`repo-sentry: snoozed for ${minutes} minutes`);
}

function installHooksCommand(): void {
  const terminal = vscode.window.createTerminal('repo-sentry');
  terminal.show();
  terminal.sendText('repo-sentry install-hooks');
}
