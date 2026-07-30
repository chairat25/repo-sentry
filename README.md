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

---

## Get it

**Just want the reminders?** This is the whole setup:

1. Grab `repo-sentry.vsix` from the [Releases page](https://github.com/chairat25/repo-sentry/releases).
2. Install it in your editor (VS Code, Antigravity, Cursor, Windsurf all work):
   ```bash
   code --install-extension repo-sentry.vsix
   ```
   No terminal handy? Drag the file onto the Extensions panel instead.
3. Open your workspace. Done — no configuration needed.

**Want it to also stop a bad commit, push, or service boot?** Also grab
`repo-sentry.cjs` from the same Releases page, then:

```bash
chmod +x repo-sentry.cjs
sudo mv repo-sentry.cjs /usr/local/bin/repo-sentry

repo-sentry install-hooks --path /path/to/your/workspace     # blocks commit/push
repo-sentry install-guards --path /path/to/your/workspace    # blocks service boot (preview only)
repo-sentry install-guards --path /path/to/your/workspace --yes   # apply it
```

That's the whole command set most people need. Everything past this point is
optional depth — flags, settings, uninstalling, and how it's built.

---

## Already installed? Check how much coverage you have

There are three independent layers, and it's normal to have only some of
them. Run these against **your own workspace folder** — the one that holds
all your service repositories side by side (e.g. `~/projects/my-workspace`,
whatever you called it):

```bash
# Is the CLI available at all?
repo-sentry --help

# What does every repo in the workspace look like right now?
repo-sentry status --path ~/projects/my-workspace
```

`status` walks every git repository it finds under that path and prints one
line each — this is the same table the extension's status bar summarizes:

```text
✓  auth-service      dev                         
⚠  billing-service   dev                         ↓3
✓  web-frontend      dev                         
⚠  data-pipeline     feature/some-branch         ↓4 ↑5  (diverged)
```

`✓` is synced, `⚠` is behind (or diverged, which additionally needs a manual
`rebase`/`merge` before it can push at all — `repo-sentry` won't choose that
for you).

**Are hooks and the boot guard actually wired in, or just the extension?**
Both `install-hooks` and `install-guards` are safe to re-run any time —
without `--yes` they only report, never write:

```bash
repo-sentry install-guards --path ~/projects/my-workspace
```

```text
auth-service/package.json
  ok     start:dev           (already guarded)
  skip   start:prod          (excluded by *prod*)

billing-service/package.json
  guard  start:dev           node server.js
  skip   build               (excluded by *build*)

Would change 1 script. Nothing was written.
Re-run with --yes to apply:  repo-sentry install-guards --yes
```

`ok (already guarded)` means that script is covered. `guard` means it isn't
yet — re-run with `--yes` to close the gap. If nothing shows `guard`, and
`repo-sentry status` reports every repo `✓`, you have full coverage.

---

## What it looks like day to day

- The **status bar** (bottom-left) shows `✓ repos synced` or `⚠ N repos behind`.
  Click it to see every repository and its state.
- A **modal** pops up automatically whenever a repository newly falls behind
  — when you open the workspace, and any time a teammate pushes while you work.
  **Pull now** fixes it. **Snooze 30m** quiets it. **Details** shows the list.
- Dismiss it without pulling and it comes back every 15 minutes — dismissing
  doesn't make the repo any less behind.
- If hooks and the boot guard are installed too, the same staleness also
  stops a `git commit`, a `git push`, or a `yarn start:dev` before it can do
  damage.

### If you have uncommitted changes, it asks first

`git pull --ff-only` (what every "Pull now" runs) already refuses on its own
— no force, ever — if an incoming change would overwrite one of yours. The
one thing it *doesn't* warn about: an uncommitted change that pull can carry
forward silently because it doesn't conflict with anything. Before pulling,
repo-sentry checks for that and asks:

```
⚠  billing-service has uncommitted changes

     Stash & Pull  —  set your changes aside, then pull. Recover them
                       afterward with "git stash pop".
     Pull Anyway   —  pull now. git still refuses if anything actually
                       conflicts — nothing is ever overwritten silently.
```

A clean repo never shows this — it just pulls.

---

## More detail, if you need it

<details>
<summary><strong>Full command reference</strong></summary>

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

Escape hatches for one-off cases: `git commit --no-verify`,
`git push --no-verify`, `REPO_SENTRY_SKIP=1 yarn start:dev`.

</details>

<details>
<summary><strong>How the git hooks work</strong></summary>

`repo-sentry install-hooks` writes a `pre-commit` and `pre-push` hook into
every repository found under a path.

- `pre-commit` fetches on a 3-second budget and refuses the commit if the
  branch is behind.
- `pre-push` fetches with no time limit and refuses the push — this is what
  stops the "push rejected, now I have to reset/stash" mess at its source.
- A hook it did not write is never touched. It's reported instead, with the
  one line to add manually.
- A teammate without the CLI installed hits the hook, sees the CLI is
  missing, and exits 0 silently — never blocked by a hook they didn't ask for.

</details>

<details>
<summary><strong>How the boot guard works, and which scripts it touches</strong></summary>

This is the one that stops the column-loss incident. It rewrites your run
scripts to refuse booting on a stale checkout:

```json
"start:dev": "sh -c 'if command -v repo-sentry >/dev/null 2>&1; then repo-sentry guard; fi' && nest start --watch"
```

That prefix is plain POSIX `sh` — it behaves identically under npm, yarn 1,
yarn Berry, pnpm, and bun. (`pre`/`post` lifecycle scripts were tried and
rejected: yarn Berry doesn't run them, so the guard would work for some
teammates and silently not for others.)

**Which scripts get guarded** — pattern-based, not a fixed list, so Nest,
Vite, Next, Angular, and anything else are covered with no configuration:

| | Default |
|---|---|
| Guarded | `start`, `start:*`, `dev`, `dev:*`, `serve`, `serve:*`, `watch`, `watch:*` |
| Never guarded | anything matching `*prod*`, `*build*`, `*test*`, `*e2e*`, `*lint*`, `*migration*`, `*seed*` |

Override at any level:

```bash
repo-sentry install-guards --path . --scripts "start:dev,worker" --yes
repo-sentry install-guards --path . --match "task:*" --exclude "*:ci" --yes
```

Or per-repository, in `.repo-sentry.json` next to that repo's `package.json`:

```json
{ "guardScripts": ["start:dev", "worker:consume"] }
```

**This rewrites `package.json` files that ship to your whole team.** Always
run the preview (no `--yes`) first, review it, then commit and push.
Teammates without the CLI installed are unaffected — they boot exactly as
before.

When the guard blocks a boot, it also writes a marker file the editor
extension watches — if the extension is installed, you get a modal with a
**Pull now** button instead of just text in the terminal.

</details>

<details>
<summary><strong>Editor settings</strong></summary>

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

</details>

<details>
<summary><strong>Uninstall</strong></summary>

```bash
# extension
code --uninstall-extension internal.repo-sentry

# hooks and boot guard, per workspace
repo-sentry uninstall-hooks --path /path/to/your/workspace
repo-sentry uninstall-guards --path /path/to/your/workspace --yes

# CLI
sudo rm /usr/local/bin/repo-sentry
```

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

**Nothing happens when I open the workspace.**
Check the `repo-sentry` output channel (View → Output → repo-sentry). If it
says `git binary not found on PATH`, install git and reload the window.

**`repo-sentry: command not found` in a hook or guard script.**
The CLI isn't installed on that machine. This is expected for teammates who
haven't set it up — it never blocks their boot or commit, it's just silent
for them.

**Settings changes don't seem to apply.**
`Developer: Reload Window` from the command palette forces a full restart of
the extension.

**A repo shows `unreachable` in `repo-sentry status`.**
Its remote couldn't be fetched — offline, VPN down, or broken credentials.
This state never blocks anything by design.

</details>

<details>
<summary><strong>Design notes</strong></summary>

**Both hooks fetch.** Reading cached refs at commit time was tried and
rejected: a clone that hasn't fetched since a teammate's push reads as synced,
which is exactly the case this tool exists to catch.

**`unreachable` never blocks.** Network down, credentials broken, remote gone
— all of these let the operation through.

**Pull is fast-forward only.** If the branch has diverged, repo-sentry
reports and stops rather than choosing merge or rebase on your behalf.

**Foreign hooks are never overwritten.** A `pre-commit` repo-sentry didn't
write is left alone and reported, with the line to add manually.

**Alerts are modal by default.** A corner toast fades unnoticed, which is how
the stale-checkout problem survives in the first place.

**What it deliberately does not do:** resolve merge conflicts; classify which
files changed (`behind > 0` is the whole signal); run any server (detection
is entirely local — no webhooks, no hosted service); read or store
credentials (it shells out to `git`, using whatever you already have
configured).

</details>

<details>
<summary><strong>Develop / build from source</strong></summary>

```bash
git clone https://github.com/chairat25/repo-sentry.git
cd repo-sentry
pnpm install
pnpm test
pnpm -r typecheck
pnpm -r build
pnpm --filter @repo-sentry/cli bundle    # standalone CLI at packages/cli/dist-standalone/repo-sentry.cjs
pnpm --filter repo-sentry package        # extension at packages/vscode-ext/repo-sentry.vsix
```

Tests build real temporary git repositories rather than mocking the `git`
binary, so they exercise the actual plumbing. Coverage threshold is 80% lines
on `packages/core`.

</details>
