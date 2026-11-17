import {describe,it,expect} from 'vitest';
import {VoiceMeterBridge} from './voiceMeterBridge';
describe('native meter freshness',()=>{
 it('waits for advancing samples rather than the cached pre-capture value',()=>{const b=new VoiceMeterBridge(),old={isRecording:false,durationMillis:0,metering:undefined};b.begin(old,0);expect(b.sample(old,1)).toBeNull();expect(b.sample({isRecording:true,durationMillis:100,metering:-60},100)).toBeNull();expect(b.sample({isRecording:true,durationMillis:200,metering:-60},200)).toEqual({now:200,level:-60});expect(b.expired(901)).toBe(true);});
 it('rejects prior-capture samples after a new start and expires stalled startup',()=>{const b=new VoiceMeterBridge(),old={isRecording:true,durationMillis:600,metering:-5};b.begin(old,0);expect(b.sample(old,5)).toBeNull();expect(b.sample({isRecording:true,durationMillis:700,metering:-5},50)).toBeNull();expect(b.sample({isRecording:true,durationMillis:100,metering:-60},100)).toBeNull();expect(b.sample({isRecording:true,durationMillis:200,metering:-60},200)?.level).toBe(-60);b.begin(old,1000);expect(b.expired(2501)).toBe(true);});
});
