import { describe, expect, it } from 'vitest';
import type { RepoStatus } from '@repo-sentry/core';
import { renderDirtyWarning, renderModalAlert, renderNotification } from '../src/messages.js';

function behind(name: string, count: number): RepoStatus {
  return {
    path: `/x/${name}`,
    name,
    branch: 'dev',
    ahead: 0,
    behind: count,
    state: 'behind',
    checkedAt: '2026-07-28T00:00:00.000Z',
  };
}

describe('renderNotification', () => {
  it('names the branch and count for a single repo', () => {
    expect(renderNotification([behind('service-a', 3)])).toBe(
      'service-a is 3 commits behind origin/dev',
    );
  });

  it('uses the singular form for one commit', () => {
    expect(renderNotification([behind('service-b', 1)])).toBe(
      'service-b is 1 commit behind origin/dev',
    );
  });

  it('aggregates when several repos are behind', () => {
    const message = renderNotification([
      behind('service-a', 3),
      behind('service-b', 1),
      behind('service-c', 2),
    ]);

    expect(message).toBe('3 repos behind origin · service-a, service-b, service-c');
  });

  it('returns an empty string for an empty list', () => {
    expect(renderNotification([])).toBe('');
  });
});

describe('renderModalAlert', () => {
  it('leads with an unmissable instruction, not a status line', () => {
    const alert = renderModalAlert([behind('service-a', 3)]);

    expect(alert.message).toContain('PULL FIRST');
  });

  it('names the repo and count in the headline for a single repo', () => {
    const alert = renderModalAlert([behind('service-a', 3)]);

    expect(alert.message).toContain('service-a');
    expect(alert.message).toContain('3 commits behind');
  });

  it('counts repos in the headline when several are behind', () => {
    const alert = renderModalAlert([behind('a', 1), behind('b', 2)]);

    expect(alert.message).toContain('2 repos');
  });

  it('lists every stale repo with its count in the detail', () => {
    const alert = renderModalAlert([behind('service-a', 3), behind('service-c', 8)]);

    expect(alert.detail).toContain('service-a');
    expect(alert.detail).toContain('↓3');
    expect(alert.detail).toContain('service-c');
    expect(alert.detail).toContain('↓8');
  });

  it('spells out both consequences of working on a stale checkout', () => {
    const alert = renderModalAlert([behind('a', 1)]);

    expect(alert.detail.toLowerCase()).toContain('rejected');
    expect(alert.detail.toLowerCase()).toContain('column');
  });

  it('uses the singular form for one commit', () => {
    expect(renderModalAlert([behind('service-b', 1)]).message).toContain('1 commit behind');
  });

  it('caps the detail list so a dozen stale repos cannot overflow the dialog', () => {
    const many = Array.from({ length: 12 }, (_, i) => behind(`svc-${i}`, i + 1));

    const alert = renderModalAlert(many);

    expect(alert.detail).toContain('and 4 more');
    expect(alert.detail).not.toContain('svc-11');
  });

  it('returns empty strings for an empty list', () => {
    expect(renderModalAlert([])).toEqual({ message: '', detail: '' });
  });
});

describe('renderDirtyWarning', () => {
  it('names the single repo with uncommitted changes', () => {
    const warning = renderDirtyWarning(['service-a']);

    expect(warning.message).toContain('service-a');
    expect(warning.message.toLowerCase()).toContain('uncommitted');
  });

  it('counts repos in the headline when several have uncommitted changes', () => {
    const warning = renderDirtyWarning(['service-a', 'service-b']);

    expect(warning.message).toContain('2 repos');
  });

  it('lists every named repo in the detail when there is more than one', () => {
    const warning = renderDirtyWarning(['service-a', 'service-b']);

    expect(warning.detail).toContain('service-a');
    expect(warning.detail).toContain('service-b');
  });

  it('explains what stashing does and that git still refuses real conflicts', () => {
    const warning = renderDirtyWarning(['service-a']);

    expect(warning.detail.toLowerCase()).toContain('stash');
    expect(warning.detail.toLowerCase()).toContain('conflict');
  });

  it('returns empty strings for an empty list', () => {
    expect(renderDirtyWarning([])).toEqual({ message: '', detail: '' });
  });
});
