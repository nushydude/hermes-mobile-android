import { describe, expect, it } from 'vitest';
import { MAX_TASKS_PER_SESSION, projectTaskEvent, projectTaskInterrupt, projectTaskRoster } from './taskProjection';

describe('observed child task projection', () => {
  const running = () => projectTaskRoster([], [{ subagent_id: 'child', goal: 'Investigate', status: 'running' }]);
  it('does not infer completion from an absent roster entry or an invalid response', () => {
    expect(projectTaskRoster(running(), [])[0].status).toBe('unknown');
    expect(projectTaskRoster(running(), null)[0].status).toBe('running');
  });
  it('keeps explicit completion across a delayed roster and does not invent success', () => {
    const done = projectTaskEvent(running(), 'subagent.complete', { subagent_id: 'child', status: 'completed', summary: 'Done' });
    expect(projectTaskRoster(done, [{ subagent_id: 'child', status: 'running' }])[0]).toMatchObject({ status: 'complete', summary: 'Done' });
    expect(projectTaskEvent(running(), 'subagent.complete', { subagent_id: 'child' })[0].status).toBe('unknown');
    expect(projectTaskEvent(running(), 'subagent.complete', { subagent_id: 'child', status: 'failed' })[0].status).toBe('failed');
    expect(projectTaskEvent(running(), 'subagent.complete', { subagent_id: 'child', status: 'interrupted' })[0].status).toBe('interrupted');
    expect(projectTaskEvent(done, 'subagent.complete', { subagent_id: 'child', status: 'failed' })[0].status).toBe('complete');
  });
  it('records an acknowledged stop as a request and preserves it while live', () => {
    const requested = projectTaskInterrupt(running(), 'child', true);
    expect(requested[0].status).toBe('cancel_requested');
    expect(projectTaskRoster(requested, [{ subagent_id: 'child', status: 'running' }])[0].status).toBe('cancel_requested');
    expect(projectTaskRoster(requested, [])[0].status).toBe('unknown');
    expect(projectTaskInterrupt(running(), 'child', false)[0].status).toBe('running');
    expect(projectTaskEvent(requested, 'subagent.complete', { subagent_id: 'child', status: 'completed' })[0].status).toBe('complete');
  });
  it('ignores handles that cannot be addressed safely and bounds records', () => {
    expect(projectTaskEvent([], 'subagent.start', { goal: 'no identity' })).toEqual([]);
    expect(projectTaskEvent([], 'subagent.start', { subagent_id: 'x'.repeat(513) })).toEqual([]);
    const rows = Array.from({ length: MAX_TASKS_PER_SESSION + 5 }, (_, i) => ({ subagent_id: String(i), status: 'running' }));
    const projected = projectTaskRoster([], rows);
    expect(projected).toHaveLength(MAX_TASKS_PER_SESSION);
    expect(projected[0].id).toBe('5');
  });
});
