import { describe, expect, it } from 'vitest';
import type { RepoStatus } from '@repo-sentry/core';
import { renderBar } from '../src/status-bar.js';

function status(over: Partial<RepoStatus> & Pick<RepoStatus, 'name' | 'state'>): RepoStatus {
  return {
    path: `/x/${over.name}`,
    branch: 'dev',
    ahead: 0,
    behind: 0,
    checkedAt: '2026-07-28T00:00:00.000Z',
    ...over,
  };
}

describe('renderBar', () => {
  it('shows a spinner before the first result arrives', () => {
    expect(renderBar(null).text).toContain('$(sync~spin)');
  });

  it('shows a check when everything is synced', () => {
    const view = renderBar([status({ name: 'a', state: 'synced' })]);

    expect(view.text).toBe('$(check) repos synced');
    expect(view.warning).toBe(false);
  });

  it('counts stale repos and sets the warning flag', () => {
    const view = renderBar([
      status({ name: 'a', state: 'behind', behind: 3 }),
      status({ name: 'b', state: 'diverged', behind: 1, ahead: 2 }),
      status({ name: 'c', state: 'synced' }),
    ]);

    expect(view.text).toBe('$(warning) 2 repos behind');
    expect(view.warning).toBe(true);
  });

  it('uses the singular form for one stale repo', () => {
    const view = renderBar([status({ name: 'a', state: 'behind', behind: 1 })]);

    expect(view.text).toBe('$(warning) 1 repo behind');
  });

  it('names the stale repos in the tooltip', () => {
    const view = renderBar([status({ name: 'service-a', state: 'behind', behind: 3 })]);

    expect(view.tooltip).toContain('service-a');
    expect(view.tooltip).toContain('↓3');
  });

  it('reports unreachable repos only when nothing is stale', () => {
    const view = renderBar([status({ name: 'a', state: 'unreachable', error: 'auth failed' })]);

    expect(view.text).toBe('$(question) repos: 1 unreachable');
    expect(view.warning).toBe(false);
  });

  it('prefers the stale warning over the unreachable notice', () => {
    const view = renderBar([
      status({ name: 'a', state: 'unreachable' }),
      status({ name: 'b', state: 'behind', behind: 1 }),
    ]);

    expect(view.text).toBe('$(warning) 1 repo behind');
  });

  it('treats an empty repo list as synced', () => {
    expect(renderBar([]).warning).toBe(false);
  });
});
