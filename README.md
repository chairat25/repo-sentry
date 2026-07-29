# repo-sentry

Warns you when a git repository is behind its remote — before you commit, before
you push, and while you work.

Built for teams where several developers share one long-lived branch across many
service repositories.

## What it does

| Moment | What happens |
|---|---|
| Workspace opens | Every repository is checked. Anything behind produces a notification. |
| While you work | Polls every 60s. A teammate's push produces a notification. |
| Before commit | `pre-commit` hook refuses the commit and tells you to pull. |
| Before push | `pre-push` hook stops the push before the remote rejects it. |
| Before boot | `guard` refuses to start a service on a stale checkout, and the editor raises a modal. |

Zero configuration. Open a workspace and every git repository in it — to a depth
of two directories — is watched.

## The boot guard

Warning about a stale checkout is not enough when the app itself destroys data
on startup. An ORM configured to sync its schema — TypeORM `synchronize: true`,
Sequelize `sync({ alter: true })`, and friends — reshapes the database to match
whatever entities are on disk. Boot on a stale checkout and it drops the column
a teammate added an hour ago, along with everything written to it.

`repo-sentry guard` refuses that boot.

```bash
repo-sentry install-guards            # shows what it would change, writes nothing
repo-sentry install-guards --yes      # applies
```

It rewrites run scripts to call the guard first:

```json
"start:dev": "sh -c 'if command -v repo-sentry >/dev/null 2>&1; then repo-sentry guard; fi' && nest start --watch"
```

That prefix is deliberately plain POSIX `sh`. It behaves identically under npm,
yarn 1, yarn Berry, pnpm, and bun — `pre`/`post` lifecycle scripts would not,
since yarn Berry does not run them. And the `if` means a teammate who has not
installed the CLI boots normally instead of hitting `command not found`.

### Which scripts get guarded

Patterns, not a fixed list, so `nest`, `vite`, `next`, `ng`, and anything else
are covered without configuration.

| | Default |
|---|---|
| Guarded | `start`, `start:*`, `dev`, `dev:*`, `serve`, `serve:*`, `watch`, `watch:*` |
| Never guarded | anything matching `*prod*`, `*build*`, `*test*`, `*e2e*`, `*lint*`, `*migration*`, `*seed*` |

Override at any level:

```bash
repo-sentry install-guards --scripts "start:dev,worker"   # exact names
repo-sentry install-guards --match "task:*" --exclude "*:ci"
```

Or per repository, in `.repo-sentry.json`:

```json
{ "guardScripts": ["start:dev", "worker:consume"] }
```

Undo with `repo-sentry uninstall-guards --yes`. Bypass one run with
`REPO_SENTRY_SKIP=1 yarn start:dev`.

## Install

**Extension** (VS Code, Antigravity, Cursor, Windsurf):

```bash
code --install-extension repo-sentry.vsix
```

**CLI and git hooks:**

```bash
npm install -g @repo-sentry/cli
repo-sentry install-hooks --path /path/to/your/workspace
```

The hooks exit 0 when the CLI is absent, so a teammate who has not installed it
is never blocked.

## Commands

```bash
repo-sentry status                 # table of every repository and its state
repo-sentry check                  # exit 1 if anything is behind
repo-sentry check --json           # machine-readable output
repo-sentry check --stage push     # phrase the message for a push
repo-sentry guard                  # exit 1 if THIS repo is behind (boot guard)
repo-sentry install-hooks          # write pre-commit and pre-push
repo-sentry uninstall-hooks        # remove them
repo-sentry install-guards         # wire the guard into run scripts
repo-sentry uninstall-guards       # unwire it
```

Escape hatches: `git commit --no-verify`, `git push --no-verify`.

## Settings

| Setting | Default |
|---|---|
| `repoSentry.alertStyle` | `modal` |
| `repoSentry.remindEveryMinutes` | `15` |
| `repoSentry.pollIntervalSeconds` | `60` |
| `repoSentry.maxDepth` | `2` |
| `repoSentry.exclude` | `[]` |
| `repoSentry.notifyOnOpen` | `true` |
| `repoSentry.snoozeMinutes` | `30` |
| `repoSentry.fetchTimeoutMs` | `15000` |

## Design notes

**Both hooks fetch.** Reading cached refs at commit time was tried and rejected:
a clone that has not fetched since a teammate's push reads as synced, which is
exactly the case this tool exists to catch. `pre-commit` fetches on a 3-second
budget; a timeout yields `unreachable`, which never blocks.

**`unreachable` never blocks.** Network down, credentials broken, remote gone —
all of these let the commit through. A tool that stops you working offline gets
uninstalled.

**Pull is fast-forward only.** If the branch has diverged, repo-sentry reports
and stops. Choosing merge or rebase on your behalf is how working trees get
wrecked.

**Foreign hooks are never overwritten.** If a `pre-commit` exists that
repo-sentry did not write, it is left alone and reported, with the line to add
manually.

## What it deliberately does not do

- Resolve merge conflicts.
- Classify which files changed. `behind > 0` is the whole signal.
- Run any server. Detection is entirely local — no webhooks, no hosted service.
- Read or store credentials. It shells out to `git`, which uses whatever you
  already have configured.

## Develop

```bash
pnpm install
pnpm test
pnpm -r build
pnpm --filter repo-sentry package   # produces repo-sentry.vsix
```

Tests build real temporary git repositories rather than mocking the `git`
binary, so they exercise the actual plumbing.
