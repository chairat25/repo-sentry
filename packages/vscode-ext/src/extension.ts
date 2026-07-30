import { watch, type FSWatcher } from 'node:fs';
import { mkdirSync } from 'node:fs';
import * as vscode from 'vscode';
import {
  Scheduler,
  analyzeRepo,
  discoverRepos,
  isDirty,
  isStale,
  markerDir,
  readBlocked,
  runGit,
  unblockRepo,
  type BlockedRepo,
  type RepoStatus,
} from '@repo-sentry/core';
import { renderBar } from './status-bar.js';
import { TransitionTracker } from './notifier.js';
import { renderDirtyWarning, renderModalAlert, renderNotification } from './messages.js';
import { pullAll, pullFastForward, stashAndPull, type PullOutcome } from './pull.js';
import { BootBlockTracker, renderBootBlockMessage } from './boot-block.js';

const PULL_NOW = 'Pull now';
const SNOOZE = 'Snooze 30m';
const DETAILS = 'Details';
const STASH_AND_PULL = 'Stash & Pull';
const PULL_ANYWAY = 'Pull Anyway';

let scheduler: Scheduler | null = null;
let bar: vscode.StatusBarItem | null = null;
let output: vscode.OutputChannel | null = null;
let tracker = new TransitionTracker();
let latest: RepoStatus[] | null = null;
/** Set when `notifyOnOpen` is false, so the opening batch seeds silently. */
let suppressFirstBatch = false;

const bootBlocks = new BootBlockTracker();
let markerWatcher: FSWatcher | null = null;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('repo-sentry');
  bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  bar.command = 'repoSentry.showStatus';
  paint(null);
  bar.show();
  context.subscriptions.push(bar, output);

  buildFromConfig();

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
    { dispose: () => stopMarkerWatch() },
  );

  void startup();
}

/**
 * Watches the marker that `repo-sentry guard` writes when it refuses a boot.
 *
 * A VS Code FileSystemWatcher only covers workspace files, and the marker
 * lives in the home directory so a guard run from any terminal reaches it.
 * That leaves node's fs.watch, on the directory rather than the file, because
 * the marker is written by rename and a file watch would follow the old inode.
 */
function startMarkerWatch(): void {
  const dir = markerDir();
  try {
    mkdirSync(dir, { recursive: true });
    markerWatcher = watch(dir, () => void onMarkerChanged());
    markerWatcher.on('error', (err) => output?.appendLine(`marker watch failed: ${String(err)}`));
  } catch (err) {
    // No watcher means no modal, but polling and the status bar keep working.
    output?.appendLine(`could not watch ${dir}: ${String(err)}`);
  }
  void onMarkerChanged();
}

function stopMarkerWatch(): void {
  markerWatcher?.close();
  markerWatcher = null;
}

async function onMarkerChanged(): Promise<void> {
  const unseen = bootBlocks.pickUnseen(await readBlocked());
  for (const entry of unseen) {
    await showBootBlockModal(entry);
  }
}

const PULL_AND_RETRY = 'Pull now';
const OPEN_REPO = 'Show repository';

/**
 * Modal, not a toast. A boot just failed and the developer is looking at a
 * terminal; a notification that fades in the corner would be missed, and the
 * failure it is explaining costs unrecoverable data.
 */
async function showBootBlockModal(entry: BlockedRepo): Promise<void> {
  const choice = await vscode.window.showErrorMessage(
    renderBootBlockMessage(entry),
    { modal: true },
    PULL_AND_RETRY,
    OPEN_REPO,
  );

  if (choice === OPEN_REPO) {
    await showStatus();
    return;
  }
  if (choice !== PULL_AND_RETRY) return;

  const status = await analyzeRepo(entry.path);
  const [outcome] = await pullWithDirtyPrompt([status]);
  // undefined means a dirty-tree prompt was shown and dismissed — leave the
  // repo blocked rather than guessing what the developer wanted.
  if (outcome === undefined) return;

  if (!outcome.ok) {
    output?.appendLine(`pull failed for ${entry.name}: ${outcome.error ?? ''}`);
    void vscode.window.showErrorMessage(
      `repo-sentry: could not fast-forward ${entry.name}. Resolve manually — see the repo-sentry output channel.`,
    );
    return;
  }

  await unblockRepo(entry.path);
  await scheduler?.tick();
  const stashNote =
    outcome.stashed === true
      ? ' Your uncommitted changes were stashed — run "git stash pop" to restore them.'
      : '';
  void vscode.window.showInformationMessage(
    `repo-sentry: ${entry.name} is up to date. Start it again.${stashNote}`,
  );
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
  startMarkerWatch();
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
  stopMarkerWatch();
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

/**
 * The scheduler and tracker both capture their settings at construction, so
 * changing a setting means rebuilding them rather than mutating them.
 */
function buildFromConfig(): void {
  scheduler?.stop();

  tracker = new TransitionTracker({
    remindAfterMs: config<number>('remindEveryMinutes', 15) * 60_000,
  });

  scheduler = new Scheduler({
    intervalMs: config<number>('pollIntervalSeconds', 60) * 1000,
    fetchTimeoutMs: config<number>('fetchTimeoutMs', 15_000),
    onResults,
    onError: (err) => output?.appendLine(`poll failed: ${String(err)}`),
  });
}

async function reload(): Promise<void> {
  buildFromConfig();
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

  void alert(notifiable);
}

/**
 * Modal by default. A corner toast fades unnoticed, which is how the whole
 * stale-checkout problem survives — so the default is the one that cannot be
 * missed, and `alertStyle` exists for anyone who finds that too aggressive.
 *
 * Only ever reached from a poll result, and polling is paused while the window
 * is unfocused, so a modal never appears over another application.
 */
async function alert(stale: readonly RepoStatus[]): Promise<void> {
  if (config<string>('alertStyle', 'modal') === 'notification') {
    const choice = await vscode.window.showWarningMessage(
      `⚠ ${renderNotification(stale)}`,
      PULL_NOW,
      SNOOZE,
      DETAILS,
    );
    await handleChoice(choice);
    return;
  }

  const { message, detail } = renderModalAlert(stale);
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true, detail },
    PULL_NOW,
    SNOOZE,
    DETAILS,
  );
  await handleChoice(choice);
}

async function handleChoice(choice: string | undefined): Promise<void> {
  if (choice === PULL_NOW) return pullStale();
  if (choice === SNOOZE) return snoozeAll();
  if (choice === DETAILS) return showStatus();
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

  const outcomes = await pullWithDirtyPrompt(targets);
  reportPullOutcomes(outcomes);
  await scheduler?.tick();
}

/**
 * Pulls every target, asking once — up front, before any progress indicator
 * — if any of them has uncommitted changes. Repos with nothing at risk are
 * pulled straight away with no prompt at all.
 *
 * `git pull --ff-only` already refuses when an incoming change would
 * overwrite an uncommitted one; this exists for the quieter case it can't
 * catch, where the two don't conflict and the pull would otherwise proceed
 * without a word about what's sitting in the working tree.
 */
async function pullWithDirtyPrompt(targets: readonly RepoStatus[]): Promise<PullOutcome[]> {
  if (targets.length === 0) return [];

  const dirtyFlags = await Promise.all(targets.map((t) => isDirty(t.path).catch(() => false)));
  const clean = targets.filter((_, i) => !dirtyFlags[i]);
  const dirty = targets.filter((_, i) => dirtyFlags[i]);

  let stashTargets: readonly RepoStatus[] = [];
  let forceTargets: readonly RepoStatus[] = [];

  if (dirty.length > 0) {
    const { message, detail } = renderDirtyWarning(dirty.map((d) => d.name));
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true, detail },
      STASH_AND_PULL,
      PULL_ANYWAY,
    );
    if (choice === STASH_AND_PULL) stashTargets = dirty;
    else if (choice === PULL_ANYWAY) forceTargets = dirty;
    // Dismissed: dirty repos are left untouched, clean ones still proceed.
  }

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'repo-sentry: pulling…' },
    async () => {
      const cleanOutcomes = await pullAll(clean);
      const forcedOutcomes = await pullAll(forceTargets);
      const stashedOutcomes: PullOutcome[] = [];
      for (const target of stashTargets) stashedOutcomes.push(await stashAndPull(target));
      return [...cleanOutcomes, ...forcedOutcomes, ...stashedOutcomes];
    },
  );
}

function reportPullOutcomes(outcomes: readonly PullOutcome[]): void {
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

  const stashed = outcomes.filter((o) => o.stashed === true).map((o) => o.repo);
  if (stashed.length > 0) {
    void vscode.window.showInformationMessage(
      `repo-sentry: stashed uncommitted changes in ${stashed.join(', ')} before pulling. ` +
        'Run "git stash pop" there to restore them.',
    );
  }
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
