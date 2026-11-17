import { describe, expect, it } from 'vitest';
import { VoiceActivity } from './voiceActivity';

function calibrate(v:VoiceActivity,level:number) {
  for(let t=0;t<500;t+=100) expect(v.sample(t,level)).toBe('calibrating');
  expect(v.sample(500,level)).toBe('listening');
}
function speak(v:VoiceActivity,level:number) {
  for(let t=600;t<=900;t+=100) v.sample(t,level);
  expect(v.hasSpeech()).toBe(true);
  expect(v.feedback().phase).toBe('speaking');
}
describe('voice endpoint detection',()=>{
  it('calibrates for a quiet room and requires sustained speech and elapsed silence',()=>{
    const v=new VoiceActivity();calibrate(v,-65);speak(v,-45);
    for(let t=1000;t<2300;t+=100) expect(v.sample(t,-65)).toBe('speech');
    expect(v.feedback()).toMatchObject({phase:'pause',level:-65});
    expect(v.sample(2300,-65)).toBe('endpoint');
    expect(v.feedback().pauseProgress).toBe(1);
  });
  it('detects a pause against louder steady room noise instead of treating it as speech forever',()=>{
    const v=new VoiceActivity();calibrate(v,-35);speak(v,-18);
    for(let t=1000;t<2300;t+=100) expect(v.sample(t,-35)).toBe('speech');
    expect(v.feedback().threshold).toBeGreaterThan(-35);
    expect(v.sample(2300,-35)).toBe('endpoint');
  });
  it('resets the pause countdown when the user resumes speech',()=>{
    const v=new VoiceActivity();calibrate(v,-55);speak(v,-25);
    for(let t=1000;t<=1800;t+=100)v.sample(t,-55);
    expect(v.feedback().pauseProgress).toBeGreaterThan(0);
    expect(v.sample(1900,-25)).toBe('speech');
    expect(v.feedback()).toMatchObject({phase:'speaking',pauseProgress:0});
    for(let t=2000;t<3300;t+=100)expect(v.sample(t,-55)).toBe('speech');
    expect(v.sample(3300,-55)).toBe('endpoint');
  });
  it('treats continuous calibrated background and short spikes as no speech',()=>{
    const v=new VoiceActivity();calibrate(v,-35);let result;
    for(let t=600;t<=8000;t+=100)result=v.sample(t,t===1000?-10:-35);
    expect(result).toBe('no-speech');expect(v.hasSpeech()).toBe(false);
  });
  it.each([-5,0])('does not treat constant loud %s dB room noise as speech',level=>{
    const v=new VoiceActivity();calibrate(v,level);let result;
    for(let t=600;t<=8000;t+=100)result=v.sample(t,level);
    expect(v.feedback().threshold).toBeGreaterThan(level);
    expect(result).toBe('no-speech');expect(v.hasSpeech()).toBe(false);
  });
  it('ignores an isolated calibration spike when estimating the room floor',()=>{
    const v=new VoiceActivity();
    for(let t=0;t<500;t+=100)v.sample(t,t===200?0:-35);
    expect(v.sample(500,-35)).toBe('listening');
    for(let t=600;t<=1000;t+=100)expect(v.sample(t,-35)).toBe('listening');
    expect(v.hasSpeech()).toBe(false);
    expect(v.feedback().threshold).toBeCloseTo(-25);
  });
  it('handles native zero amplitude and can detect quiet speech relative to that floor',()=>{
    const v=new VoiceActivity();calibrate(v,-160);speak(v,-55);
    expect(v.feedback().level).toBe(-55);
    for(let t=1000;t<2300;t+=100)v.sample(t,-160);
    expect(v.feedback().level).toBe(-80);
    expect(v.sample(2300,-160)).toBe('endpoint');
  });
  it('fails closed on gaps, repeated time and missing or nonfinite metering',()=>{
    const v=new VoiceActivity();v.sample(0,-60);
    expect(v.sample(600,-60)).toBe('unavailable');
    expect(v.sample(0,-60)).toBe('unavailable');
    expect(new VoiceActivity().sample(0,undefined)).toBe('unavailable');
    expect(new VoiceActivity().sample(0,NaN)).toBe('unavailable');
    expect(new VoiceActivity().sample(Infinity,-60)).toBe('unavailable');
  });
});
