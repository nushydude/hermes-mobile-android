import { expect,it } from 'vitest';
import { voiceVisualLevel } from './voiceVisual';
it('keeps calibrated ambient noise quiet and smooths speech changes',()=>{const sample={phase:'listening' as const,level:-40,threshold:-35,pauseProgress:0};expect(voiceVisualLevel(0,sample)).toBe(0);const speech={...sample,phase:'speaking' as const,level:-11};const rising=voiceVisualLevel(0,speech);expect(rising).toBe(0.25);expect(voiceVisualLevel(rising,null)).toBeCloseTo(0.1875);});
