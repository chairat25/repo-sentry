# repo-sentry

**[English](README.md)** | [ภาษาไทย](README.th.md)

Warns you when a git repository is behind its remote — before you commit,
before you push, before you boot a service, and while you work.

Built for teams where several developers share one long-lived branch across
many service repositories. It exists to stop two specific incidents:

- **Push collisions.** Developer A pushes. Developer B, unaware, commits on a
  stale base and the push is rejected — recovered with ad-hoc
  `git reset`/`stash` that leaves the working tree in a mess.
- **Silent data loss.** Someone adds a database column. A teammate who hasn't
  pulled boots a service with an ORM configured to sync its schema (TypeORM
  `synchronize: true`, Sequelize `sync({ alter: true })`, ...). The ORM drops
  the column to match the stale entity on disk. The data in it is gone.

| Moment | What happens |
|---|---|
| Workspace opens | Every repository is checked. Anything behind raises a modal. |
| While you work | Polls every 60s. A teammate's push raises a modal. |
| Before commit | `pre-commit` hook refuses the commit and tells you to pull. |
| Before push | `pre-push` hook stops the push before the remote rejects it. |
| Before boot | `guard` refuses to start a service on a stale checkout. |

Zero configuration to start: open a workspace and every git repository in it
(to a depth of two directories) is watched automatically.

---

## Contents

- [Quick start](#quick-start)
- [1. Install the editor extension](#1-install-the-editor-extension)
- [2. Install the CLI](#2-install-the-cli)
- [3. Optional: git hooks (commit / push protection)](#3-optional-git-hooks-commit--push-protection)
- [4. Optional: boot guard (data-loss protection)](#4-optional-boot-guard-data-loss-protection)
- [Daily usage](#daily-usage)
- [Pulling with uncommitted changes](#pulling-with-uncommitted-changes)
- [Command reference](#command-reference)
- [Editor settings](#editor-settings)
- [Uninstall](#uninstall)
- [Troubleshooting](#troubleshooting)
- [Design notes](#design-notes)
- [Develop](#develop)

---

## Quick start

For someone who wants everything on immediately, in one workspace:

```bash
git clone https://github.com/chairat25/repo-sentry.git
cd repo-sentry
pnpm install
pnpm -r build
pnpm --filter repo-sentry package        # builds packages/vscode-ext/repo-sentry.vsix

# 1. editor extension
code --install-extension packages/vscode-ext/repo-sentry.vsix

# 2. CLI, available on PATH
npm link packages/cli

# 3. protect commit/push in a workspace
repo-sentry install-hooks --path /path/to/your/workspace

# 4. protect service boot in the same workspace (shows a preview first)
repo-sentry install-guards --path /path/to/your/workspace
repo-sentry install-guards --path /path/to/your/workspace --yes
```

Everything below explains each of these steps and what else is available.

---

## 1. Install the editor extension

The extension is the same `.vsix` for VS Code and every VS Code fork —
Antigravity, Cursor, Windsurf, Trae. It gives you the status bar indicator,
the polling, and the modal alerts. It works standalone with no other install.

Build it once:

```bash
pnpm install
pnpm -r build
pnpm --filter repo-sentry package
```

This produces `packages/vscode-ext/repo-sentry.vsix`. Install it per editor:

```bash
# VS Code
code --install-extension packages/vscode-ext/repo-sentry.vsix

# Cursor
cursor --install-extension packages/vscode-ext/repo-sentry.vsix

# Antigravity IDE
"/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide" \
  --install-extension packages/vscode-ext/repo-sentry.vsix
```

No CLI editor available? Drag the `.vsix` file onto the Extensions panel in
the editor, or open the Extensions view → `···` menu → **Install from VSIX...**

To update after a new build, reinstall with `--force`:

```bash
code --install-extension packages/vscode-ext/repo-sentry.vsix --force
```

Sharing with teammates: send them the `.vsix` file (it's ~25KB) — they don't
need this repository at all, just that one file.

---

## 2. Install the CLI

The CLI is required for git hooks and the boot guard — the extension alone
cannot see into a `git commit`, `git push`, or `yarn start:dev` invocation
running in a terminal.

This package is not published to a registry, so install it from the repo:

```bash
cd repo-sentry
npm link packages/cli
```

Verify it's on PATH:

```bash
repo-sentry --help
```

If you'd rather not use `npm link`, add the built CLI's directory to PATH
directly, or symlink the entry point:

```bash
ln -s "$(pwd)/packages/cli/dist/index.js" /usr/local/bin/repo-sentry
chmod +x /usr/local/bin/repo-sentry
```

Each teammate who wants hooks or the boot guard to actually run needs to do
this on their own machine — it is a local install, not something that comes
from cloning `project-genie`.

---

## 3. Optional: git hooks (commit / push protection)

Installs a `pre-commit` and `pre-push` hook into every repository found under
a path.

```bash
repo-sentry install-hooks --path /path/to/your/workspace
```

- `pre-commit` fetches on a 3-second budget and refuses the commit if the
  branch is behind.
- `pre-push` fetches with no time limit and refuses the push — this is what
  stops the "push rejected, now I have to reset/stash" mess at its source.
- A hook it did not write is never touched. It's reported instead, with the
  one line to add manually.
- A teammate without the CLI installed boots the hook, sees the CLI is
  missing, and exits 0 silently — never blocked by a hook they didn't ask for.

Escape hatch for one command: `git commit --no-verify` / `git push --no-verify`.

Remove them:

```bash
repo-sentry uninstall-hooks --path /path/to/your/workspace
```

---

## 4. Optional: boot guard (data-loss protection)

This is the one that stops the column-loss incident. It rewrites your run
scripts (`start`, `start:dev`, `dev`, `serve`, `watch`, and variants — see
below) to refuse booting on a stale checkout.

**Always preview first — the default is dry-run:**

```bash
repo-sentry install-guards --path /path/to/your/workspace
```

This prints exactly which scripts in which `package.json` files would change,
and why any script was skipped. Nothing is written until you pass `--yes`:

```bash
repo-sentry install-guards --path /path/to/your/workspace --yes
```

What it writes into each guarded script:

```json
"start:dev": "sh -c 'if command -v repo-sentry >/dev/null 2>&1; then repo-sentry guard; fi' && nest start --watch"
```

That prefix is plain POSIX `sh` — it behaves identically under npm, yarn 1,
yarn Berry, pnpm, and bun. (`pre`/`post` lifecycle scripts were considered and
rejected: yarn Berry doesn't run them, so they'd work for some teammates and
silently not for others.) The `if command -v` guard means a teammate who
hasn't installed the CLI boots normally instead of hitting
`command not found`.

### Which scripts get guarded

Pattern-based, not a fixed list — covers Nest, Vite, Next, Angular, and
anything else without configuration.

| | Default |
|---|---|
| Guarded | `start`, `start:*`, `dev`, `dev:*`, `serve`, `serve:*`, `watch`, `watch:*` |
| Never guarded | anything matching `*prod*`, `*build*`, `*test*`, `*e2e*`, `*lint*`, `*migration*`, `*seed*` |

Override at any level:

```bash
# exact script names, ignoring the patterns entirely
repo-sentry install-guards --path . --scripts "start:dev,worker" --yes

# extra patterns on top of the defaults
repo-sentry install-guards --path . --match "task:*" --exclude "*:ci" --yes
```

Or per-repository, so the choice travels with the repo instead of living in
someone's shell history — add `.repo-sentry.json` next to that repo's
`package.json`:

```json
{ "guardScripts": ["start:dev", "worker:consume"] }
```

**This rewrites and commits to `package.json` files that ship to your whole
team.** Run the dry-run first, review the diff, then commit and push once
you're happy with it. Teammates without the CLI installed are unaffected —
they boot exactly as before.

Bypass the guard for one run:

```bash
REPO_SENTRY_SKIP=1 yarn start:dev
```

Remove it everywhere:

```bash
repo-sentry uninstall-guards --path /path/to/your/workspace --yes
```

When the guard blocks a boot, it also writes a marker file that the editor
extension watches — if the extension is installed, you get a modal explaining
which repo blocked the boot and a **Pull now** button, instead of just a wall
of text in the terminal.

---

## Daily usage

With just the extension installed, open your workspace and:

- The **status bar** (bottom-left) shows `✓ repos synced` or
  `⚠ N repos behind`. Click it to see every repository and its state.
- A **modal** appears automatically whenever a repository newly falls behind
  — on workspace open, and any time during the day a teammate pushes.
- **Pull now** fast-forwards the stale repo(s). **Snooze 30m** quiets it
  temporarily. **Details** opens the full list.
- Dismissing the modal without pulling brings it back every 15 minutes by
  default (`repoSentry.remindEveryMinutes`) — dismissing doesn't make the repo
  any less stale.
- If a repo you're about to pull has uncommitted changes, a second dialog
  asks first — see [Pulling with uncommitted changes](#pulling-with-uncommitted-changes)
  below. A repo with nothing at risk pulls with no prompt at all.

With hooks and the guard installed on top, the same staleness additionally
stops a `git commit`, a `git push`, or a `yarn start:dev` before it can cause
damage — see sections 3 and 4 above.

---

## Pulling with uncommitted changes

`git pull --ff-only` is what every "Pull now" button runs, and it already
refuses on its own — no force, ever — if an incoming change would overwrite
one of yours. That part needs no extra warning; git protects it for free.

The gap is quieter: if you have an uncommitted change that *doesn't* conflict
with anything incoming, `--ff-only` will happily carry it forward mixed in
with the new commits, without a word. Technically safe, but easy to lose
track of — so before pulling, repo-sentry checks whether the target repo has
any uncommitted change (`git status --porcelain`) and asks first if it does.

```
⚠  transaction has uncommitted changes

   Pulling now could carry those changes forward mixed in with new commits.

     Stash & Pull  —  set your changes aside, then pull. Recover them
                       afterward with "git stash pop".
     Pull Anyway   —  pull now. git still refuses if anything actually
                       conflicts — nothing is ever overwritten silently.
```

- **Stash & Pull** — stashes tracked *and* untracked changes
  (`git stash push --include-untracked`), then pulls. The stash is **never**
  popped automatically; run `git stash pop` in that repo once you've confirmed
  the pull went through.
- **Pull Anyway** — pulls directly. If something actually conflicts, git
  refuses the same way it always does — this button does not bypass that.
- **Dismiss (Esc)** — that repo is left exactly as it was. If you asked to
  pull several repos and only one was dirty, the rest still pull normally.

A repo with no uncommitted changes never shows this dialog at all — it just
pulls. This applies everywhere a pull can happen: the stale-repo modal, the
status quick-pick, **Pull All**, and the boot-guard modal's **Pull now**.

---

## Command reference

```text
repo-sentry status                 Table of every repository and its state
repo-sentry check                  Exit 1 if any repository is behind
repo-sentry check --json           Machine-readable output
repo-sentry check --path <dir>     Check a specific workspace/repo
repo-sentry check --no-fetch       Use cached refs instead of fetching
repo-sentry check --stage push     Phrase the block message for a push
repo-sentry check --fetch-timeout <ms>   Override the fetch budget

repo-sentry guard                  Exit 1 if THIS repo is behind (boot guard)
repo-sentry guard --path <dir>     Guard a specific repo

repo-sentry install-hooks --path <dir>     Write pre-commit and pre-push
repo-sentry uninstall-hooks --path <dir>   Remove them

repo-sentry install-guards --path <dir>            Preview script changes
repo-sentry install-guards --path <dir> --yes      Apply them
repo-sentry install-guards --path <dir> --scripts "a,b"   Exact script names
repo-sentry install-guards --path <dir> --match "glob" --exclude "glob"
repo-sentry uninstall-guards --path <dir> --yes    Remove the guard prefix
```

Exit codes for `check` and `guard`: `0` synced/ahead/unreachable/untracked,
`1` behind or diverged, `2` internal error. `unreachable` (offline, broken
credentials) never blocks — a tool that stops you working offline gets
uninstalled.

---

## Editor settings

| Setting | Default | Purpose |
|---|---|---|
| `repoSentry.alertStyle` | `modal` | `modal` (blocking, centre-screen) or `notification` (corner toast) |
| `repoSentry.remindEveryMinutes` | `15` | Re-alert while still behind. `0` disables repeat alerts |
| `repoSentry.pollIntervalSeconds` | `60` | How often to check each repository |
| `repoSentry.maxDepth` | `2` | Directory depth to search for repositories |
| `repoSentry.exclude` | `[]` | Glob patterns of repository paths to ignore |
| `repoSentry.notifyOnOpen` | `true` | Check and alert as soon as the workspace opens |
| `repoSentry.snoozeMinutes` | `30` | How long **Snooze** suppresses alerts |
| `repoSentry.fetchTimeoutMs` | `15000` | Timeout for each git fetch |

Set these in your editor's Settings UI (search "repo-sentry") or in
`.vscode/settings.json`:

```json
{
  "repoSentry.alertStyle": "notification",
  "repoSentry.remindEveryMinutes": 0
}
```

---

## Uninstall

```bash
# extension
code --uninstall-extension internal.repo-sentry

# hooks and boot guard, per workspace
repo-sentry uninstall-hooks --path /path/to/your/workspace
repo-sentry uninstall-guards --path /path/to/your/workspace --yes

# CLI
npm unlink @repo-sentry/cli   # or remove the symlink you created manually
```

---

## Troubleshooting

**Nothing happens when I open the workspace.**
Check the `repo-sentry` output channel (View → Output → repo-sentry). If it
says `git binary not found on PATH`, install git and reload the window.

**`repo-sentry: command not found` in a hook or guard script.**
The CLI isn't linked on that machine — see [step 2](#2-install-the-cli). This
is expected to happen for teammates who haven't set it up; it never blocks
their boot or commit, it's just silent for them.

**Settings changes don't seem to apply.**
`Developer: Reload Window` from the command palette forces a full restart of
the extension.

**A repo shows `unreachable` in `repo-sentry status`.**
Its remote couldn't be fetched — offline, VPN down, or broken credentials.
This state never blocks anything by design; check the error with
`repo-sentry status` or `repo-sentry check --json`.

---

## Design notes

**Both hooks fetch.** Reading cached refs at commit time was tried and
rejected: a clone that hasn't fetched since a teammate's push reads as synced,
which is exactly the case this tool exists to catch. `pre-commit` fetches on a
3-second budget; a timeout yields `unreachable`, which never blocks.

**`unreachable` never blocks.** Network down, credentials broken, remote gone
— all of these let the operation through.

**Pull is fast-forward only.** If the branch has diverged, repo-sentry
reports and stops. Choosing merge or rebase on your behalf is how working
trees get wrecked.

**Foreign hooks are never overwritten.** A `pre-commit` repo-sentry didn't
write is left alone and reported, with the line to add manually.

**Alerts are modal by default.** A corner toast fades unnoticed, which is how
the stale-checkout problem survives in the first place.

### What it deliberately does not do

- Resolve merge conflicts.
- Classify which files changed — `behind > 0` is the whole signal, and the
  boot guard's danger applies to a stale checkout regardless of which file
  moved.
- Run any server. Detection is entirely local — no webhooks, no hosted
  service.
- Read or store credentials. It shells out to `git`, which uses whatever
  credential setup you already have.

---

## Develop

```bash
pnpm install
pnpm test
pnpm -r typecheck
pnpm -r build
pnpm --filter repo-sentry package   # produces repo-sentry.vsix
```

Tests build real temporary git repositories rather than mocking the `git`
binary, so they exercise the actual plumbing. Coverage threshold is 80% lines
on `packages/core`.
