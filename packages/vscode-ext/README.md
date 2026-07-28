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
of two directories — is watched. The status bar shows the count; clicking it
lists every repository and lets you pull the stale ones.

The git hooks need the companion CLI:

```bash
npm install -g @repo-sentry/cli
repo-sentry install-hooks
```

Or run **repo-sentry: Install Git Hooks** from the command palette.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `repoSentry.pollIntervalSeconds` | `60` | How often to check |
| `repoSentry.maxDepth` | `2` | Directory levels to search for repositories |
| `repoSentry.exclude` | `[]` | Glob patterns of repository paths to ignore |
| `repoSentry.notifyOnOpen` | `true` | Notify as soon as the workspace opens |
| `repoSentry.snoozeMinutes` | `30` | Snooze duration |
| `repoSentry.fetchTimeoutMs` | `15000` | Timeout for each fetch |

## Notes

- A repository whose remote is unreachable is reported in the status bar only.
  It never blocks a commit and never pops up — working offline stays possible.
- Pull is fast-forward only. A diverged branch is reported, not auto-merged.
- Notifications fire on transition, not on every poll.
