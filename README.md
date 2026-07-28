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

Zero configuration. Open a workspace and every git repository in it — to a depth
of two directories — is watched.

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
repo-sentry install-hooks          # write pre-commit and pre-push
repo-sentry uninstall-hooks        # remove them
```

Escape hatches: `git commit --no-verify`, `git push --no-verify`.

## Settings

| Setting | Default |
|---|---|
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
