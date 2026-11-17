import {describe,it,expect} from 'vitest';
import {isReasoningLevel,reasoningProjection,reasoningLabel} from './reasoningLevels';
describe('reasoning projection',()=>{
  it('keeps requested and effective levels distinct',()=>{expect(reasoningProjection({reasoning_effort:'ultra',reasoning_effort_wire:'max'})).toEqual({requested:'ultra',wire:'max'});});
  it('does not invent wire support for an empty or unknown result',()=>{expect(reasoningProjection({reasoning_effort:'none',reasoning_effort_wire:''})).toEqual({requested:'none',wire:null});expect(reasoningProjection(null)).toEqual({requested:null,wire:null});expect(isReasoningLevel('not-a-real-effort')).toBe(false);expect(reasoningLabel(null)).toBe('Gateway default');});
});
