import { describe, expect, it } from 'vitest';
import { waitingPrompts, unknownPrompts } from './pendingQueue';
describe('canonical queue presentation', () => {
  it('does not give running or steering admissions queued controls or counts', () => {
    const queued = {admission_id:'later',status:'queued'};
    const unknown = {admission_id:'uncertain',status:'unknown'};
    const pending = [{admission_id:'now',status:'started'}, {admission_id:'steer',status:'started',steering:true}, queued, unknown];
    expect(waitingPrompts(pending)).toEqual([queued]);
    expect(unknownPrompts(pending)).toEqual([unknown]);
  });
  it('retires queue presentation when the same admission starts or settles', () => {
    expect(waitingPrompts([{admission_id:'a',status:'queued'}])).toHaveLength(1);
    expect(waitingPrompts([{admission_id:'a',status:'started'}])).toHaveLength(0);
    expect(waitingPrompts([{admission_id:'a',status:'completed'}])).toHaveLength(0);
    expect(waitingPrompts([null, {}, {status:'future'}])).toHaveLength(0);
  });
});
