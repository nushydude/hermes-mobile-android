import { describe, expect, it, vi } from 'vitest';
import { VoiceController, DefiniteVoiceSendError, type VoiceAdapters } from './voiceController';
import { VoiceCorrelation } from './voiceCorrelation';
function deferred<T>() { let resolve!:(v:T)=>void; const promise=new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }
function fixture() {
 let valid=true;
 const adapter:VoiceAdapters={valid:()=>valid,cancelPendingReply:vi.fn(),permission:vi.fn(async()=>true),prepare:vi.fn(async()=>{}),start:vi.fn(),stop:vi.fn(async()=> 'file'),discard:vi.fn(async()=>{}),transcribe:vi.fn(async()=> 'hello'),send:vi.fn(async()=>{}),play:vi.fn(async()=>{}),stopPlayback:vi.fn()};
 return {adapter, controller:new VoiceController(adapter),invalidate:()=>{valid=false;}};
}
describe('voice ownership and lifecycle',()=>{
 it('cancels before permission and cleans up a late prepare',async()=>{
  const f=fixture(), permission=deferred<boolean>(); f.adapter.permission=()=>permission.promise;
  const start=f.controller.start(); f.controller.end(); permission.resolve(true); await start; expect(f.adapter.prepare).not.toHaveBeenCalled();expect(f.adapter.start).not.toHaveBeenCalled();
  const prepare=deferred<void>();f.adapter.permission=async()=>true;f.adapter.prepare=()=>prepare.promise;
  const second=f.controller.start(); await Promise.resolve(); await Promise.resolve(); f.controller.end();prepare.resolve();await second;expect(f.adapter.start).not.toHaveBeenCalled();expect(f.adapter.discard).toHaveBeenCalled();
 });
 it('ignores late STT after endpoint/chat change and always discards audio',async()=>{
  const f=fixture(), stt=deferred<string>(); f.adapter.transcribe=()=>stt.promise;await f.controller.start();const stop=f.controller.stop();await Promise.resolve();f.invalidate();stt.resolve('private');await stop;expect(f.controller.getState().text).toBe('');expect(f.adapter.discard).toHaveBeenCalled();
 });
 it('guards duplicate sends and returns to review on persistence failure',async()=>{
  const f=fixture();await f.controller.start();await f.controller.stop();const send=deferred<void>();f.adapter.send=vi.fn(()=>send.promise);
  const first=f.controller.send();await f.controller.send();expect(f.adapter.send).toHaveBeenCalledTimes(1);send.resolve();await first;expect(f.controller.getState().phase).toBe('sent');
  const x=fixture();await x.controller.start();await x.controller.stop();x.adapter.send=vi.fn(async()=>{throw new Error();});await x.controller.send();expect(x.controller.getState()).toMatchObject({phase:'review',text:'hello'});
 });
 it('end aborts playback and stops foreground resources immediately',async()=>{
  const f=fixture(), play=deferred<void>();let signal!:AbortSignal;f.adapter.play=(_text,s)=>{signal=s;return play.promise;};const p=f.controller.play('hello');f.controller.end();expect(signal.aborted).toBe(true);expect(f.adapter.stopPlayback).toHaveBeenCalled();expect(f.adapter.discard).toHaveBeenCalled();play.resolve();await p;expect(f.controller.getState().phase).toBe('idle');
 });
 it('matches only the voice submission or its admission, buffers fast completions, and fires once',()=>{
  const found=vi.fn();let admission:string|undefined;const c=new VoiceCorrelation('mine',()=>admission,found);
  c.event({type:'message.complete',session_id:'other',admission_id:'a',payload:{text:'bad'}});
  c.event({type:'message.complete',session_id:'mine',admission_id:'other',payload:{text:'bad'}});
  c.event({type:'message.complete',session_id:'mine',admission_id:'a',payload:{text:'good'}});
  c.bind('submission');expect(found).not.toHaveBeenCalled();admission='a';c.refresh();expect(found).toHaveBeenCalledTimes(1);expect(found.mock.calls[0][0].payload.text).toBe('good');c.event({type:'message.complete',session_id:'mine',admission_id:'a'});expect(found).toHaveBeenCalledTimes(1);
  const early=vi.fn(),d=new VoiceCorrelation('mine',()=>undefined,early);d.event({type:'message.complete',session_id:'mine',payload:{persisted_turn:{submission_id:'exact'}}});d.bind('exact');expect(early).toHaveBeenCalledTimes(1);
 });
});

describe('interleaved capture and playback',()=>{
 it('serializes restart behind a cancelled late prepare and cleanup',async()=>{
  const f=fixture(),prepared=deferred<void>(), cleaned=deferred<void>(); let calls=0;
  f.adapter.prepare=vi.fn(()=>{calls++;return calls===1?prepared.promise:Promise.resolve();});
  let discards=0;f.adapter.discard=vi.fn(()=>{discards++;return discards===1?Promise.resolve():cleaned.promise;});
  const first=f.controller.start(); await vi.waitFor(()=>expect(f.adapter.prepare).toHaveBeenCalledTimes(1)); f.controller.end();
  const second=f.controller.start();prepared.resolve();await vi.waitFor(()=>expect(discards).toBeGreaterThanOrEqual(2));
  expect(f.adapter.prepare).toHaveBeenCalledTimes(1);expect(f.adapter.start).not.toHaveBeenCalled();cleaned.resolve();await first;await second;
  expect(f.adapter.prepare).toHaveBeenCalledTimes(2);expect(f.adapter.start).toHaveBeenCalledTimes(1);f.controller.end();
 });
 it('cancels pending reply before permission and cannot play during permission',async()=>{
  const f=fixture(),permission=deferred<boolean>();f.adapter.permission=()=>permission.promise;
  const start=f.controller.start();expect(f.adapter.cancelPendingReply).toHaveBeenCalledTimes(1);
  await f.controller.play('late reply');expect(f.adapter.play).not.toHaveBeenCalled();permission.resolve(true);await start;expect(f.controller.getState().phase).toBe('recording');f.controller.end();
 });
 it('stops speech without ending the conversation',async()=>{
  const f=fixture(),play=deferred<void>();let signal!:AbortSignal;f.adapter.play=(_text,s)=>{signal=s;return play.promise;};
  const pending=f.controller.play('reply');f.controller.stopSpeaking();expect(signal.aborted).toBe(true);expect(f.controller.getState().phase).toBe('idle');play.resolve();await pending;expect(f.controller.getState().phase).toBe('idle');
 });
});

it('does not start a new capture while end is still stopping the prior recorder',async()=>{
 const f=fixture(),cleanup=deferred<void>();let count=0;
 f.adapter.discard=vi.fn(()=>++count===1?cleanup.promise:Promise.resolve());
 await f.controller.start();expect(f.adapter.start).toHaveBeenCalledTimes(1);f.controller.end();
 const restart=f.controller.start();await Promise.resolve();await Promise.resolve();expect(f.adapter.start).toHaveBeenCalledTimes(1);
 cleanup.resolve();await restart;expect(f.adapter.start).toHaveBeenCalledTimes(2);f.controller.end();
});

it('is ready to record after a completed reply instead of still waiting for that reply',async()=>{
 const f=fixture();await f.controller.start();await f.controller.stop();await f.controller.send();
 expect(f.controller.getState().phase).toBe('sent');
 await f.controller.play('the completed reply');expect(f.controller.getState().phase).toBe('idle');
 await f.controller.start();await f.controller.stop();await f.controller.send();
 const spoken=deferred<void>();f.adapter.play=()=>spoken.promise;
 const playback=f.controller.play('another completed reply');f.controller.stopSpeaking();
 expect(f.controller.getState().phase).toBe('idle');spoken.resolve();await playback;
 expect(f.controller.getState().phase).toBe('idle');
});

it('late completion of stopped playback cannot end newer playback',async()=>{
 const f=fixture(),first=deferred<void>(),second=deferred<void>();let calls=0;
 f.adapter.play=vi.fn(()=>++calls===1?first.promise:second.promise);
 const one=f.controller.play('old');f.controller.stopSpeaking();const two=f.controller.play('new');
 first.resolve();await one;expect(f.controller.getState().phase).toBe('playing');
 second.resolve();await two;expect(f.controller.getState().phase).toBe('idle');
});

describe('terminal outcomes for a voice submission',()=>{
 for(const [outcome,notice] of [
  ['interrupted','The turn stopped. See chat for details.'],
  ['error','The turn ended. See chat for details.'],
  ['empty','The reply finished without spoken text. See chat.'],
  ['timeout','The reply is taking longer. Continue in chat.'],
 ] as const) it(`settles ${outcome} without waiting forever`,async()=>{
  const f=fixture();await f.controller.start();await f.controller.stop();let valid!:()=>boolean;const pending=deferred<void>();
  f.adapter.send=(_text,check)=>{valid=check;return pending.promise;};const send=f.controller.send();
  f.controller.settle(valid,outcome);expect(f.controller.getState().phase).toBe('sending');pending.resolve();await send;
  expect(f.controller.getState()).toMatchObject({phase:'idle',notice});
 });
 it('ignores a stale terminal callback after the next recording starts',async()=>{
  const f=fixture();await f.controller.start();await f.controller.stop();let valid!:()=>boolean;f.adapter.send=async(_text,check)=>{valid=check;};await f.controller.send();
  const permission=deferred<boolean>();f.adapter.permission=()=>permission.promise;const next=f.controller.start();f.controller.settle(valid,'timeout');
  expect(f.controller.getState()).toMatchObject({phase:'permission',notice:null});permission.resolve(true);await next;f.controller.end();
 });
 it('settles timeout after a durable send without affecting accepted work',async()=>{
  const f=fixture();await f.controller.start();await f.controller.stop();let valid!:()=>boolean;f.adapter.send=async(_text,check)=>{valid=check;};await f.controller.send();
  f.controller.settle(valid,'timeout');expect(f.controller.getState()).toMatchObject({phase:'idle',notice:'The reply is taking longer. Continue in chat.'});
 });
});

describe('hands-free loop',()=>{
 it('discards the recording before sending and keeps pending work paused until its reply',async()=>{
  const f=fixture();f.controller.startConversation();await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('recording'));
  await f.controller.stop();expect(f.adapter.discard).toHaveBeenCalled();expect(vi.mocked(f.adapter.discard).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.adapter.send).mock.invocationCallOrder[0]);
  expect(f.controller.hasPending()).toBe(true);f.controller.pause();f.controller.resume();expect(f.controller.getState().phase).toBe('paused');
  await f.controller.reply('done');expect(f.controller.hasPending()).toBe(false);expect(f.adapter.play).not.toHaveBeenCalled();f.controller.end();
 });
 it('pauses on missing metering and never resumes on its own',async()=>{
  const f=fixture();f.controller.startConversation();await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('recording'));f.controller.meter(100,undefined);expect(f.controller.getState().phase).toBe('paused');expect(f.adapter.send).not.toHaveBeenCalled();f.controller.end();
 });
 it('does not rearm after speech is stopped',async()=>{
  const f=fixture(),speech=deferred<void>();f.adapter.play=()=>speech.promise;f.controller.startConversation();await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('recording'));await f.controller.stop();const playing=f.controller.reply('answer');expect(f.controller.getState().phase).toBe('playing');f.controller.stopSpeaking();speech.resolve();await playing;expect(f.controller.getState().phase).toBe('paused');f.controller.end();
 });
});

it('only rearms after natural speech and cooldown, and cancels a late cooldown',async()=>{
 vi.useFakeTimers();try{const f=fixture();f.adapter.play=async()=> 'finished';f.controller.startConversation();for(let i=0;i<12;i++)await Promise.resolve();expect(f.controller.getState().phase).toBe('recording');await f.controller.stop();await f.controller.reply('done');expect(f.controller.getState().phase).toBe('cooldown');f.controller.pause();vi.advanceTimersByTime(500);for(let i=0;i<4;i++)await Promise.resolve();expect(f.controller.getState().phase).toBe('paused');expect(f.adapter.start).toHaveBeenCalledTimes(1);f.controller.end();}finally{vi.useRealTimers();}
});

it('replays an automatic reply without resuming capture',async()=>{
 const f=fixture();f.adapter.play=vi.fn(async()=> 'finished' as const);f.controller.startConversation();await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('recording'));await f.controller.stop();await f.controller.reply('reply');expect(f.controller.getState().phase).toBe('cooldown');f.controller.pause();await f.controller.replay('reply');expect(f.adapter.play).toHaveBeenCalledTimes(2);expect(f.controller.getState().phase).toBe('paused');expect(f.adapter.start).toHaveBeenCalledTimes(1);f.controller.end();
});
it('clears only definite submission failures while preserving ambiguous pending work',async()=>{
 for(const definite of [true,false]){const f=fixture();f.adapter.send=async()=>{throw definite?new DefiniteVoiceSendError():new Error('unknown');};f.controller.startConversation();await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('recording'));await f.controller.stop();expect(f.controller.getState().phase).toBe('paused');expect(f.controller.hasPending()).toBe(!definite);f.controller.end();}
});

it('automatically submits a voiced endpoint exactly once despite duplicate stop requests',async()=>{
 const f=fixture();f.controller.startConversation();await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('recording'));
 for(let time=0;time<=500;time+=100)f.controller.meter(time,-65);
 for(let time=600;time<=1000;time+=100)f.controller.meter(time,-20);
 for(let time=1100;time<=2400;time+=100)f.controller.meter(time,-65);
 await f.controller.stop();await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('sent'));
 expect(f.adapter.stop).toHaveBeenCalledTimes(1);expect(f.adapter.transcribe).toHaveBeenCalledTimes(1);expect(f.adapter.send).toHaveBeenCalledTimes(1);f.controller.end();
});
it('bounds silent re-arms without sending silence to transcription',async()=>{
 const f=fixture();f.controller.startConversation();
 for(let capture=0;capture<3;capture++){
  await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('recording'));
  for(let time=0;time<=8000;time+=100)f.controller.meter(time,-65);
 }
 await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('paused'));
 expect(f.adapter.start).toHaveBeenCalledTimes(3);expect(f.adapter.transcribe).not.toHaveBeenCalled();expect(f.adapter.send).not.toHaveBeenCalled();f.controller.end();
});
it('pauses if chat readiness changes during transcription and does not auto-send',async()=>{
 const f=fixture(),stt=deferred<string>();let ready=true;f.adapter.automaticReady=()=>ready;f.adapter.transcribe=vi.fn(()=>stt.promise);
 f.controller.startConversation();await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('recording'));
 const stop=f.controller.stop();await vi.waitFor(()=>expect(f.adapter.transcribe).toHaveBeenCalled());ready=false;stt.resolve('hello');await stop;
 expect(f.controller.getState().phase).toBe('paused');expect(f.adapter.send).not.toHaveBeenCalled();f.controller.end();
});
it('starts the next capture after its automatic reply naturally finishes and cools down',async()=>{
 vi.useFakeTimers();try{
  const f=fixture();f.adapter.play=async()=> 'finished';f.controller.startConversation();for(let i=0;i<12;i++)await Promise.resolve();
  await f.controller.stop();await f.controller.reply('done');expect(f.controller.getState().phase).toBe('cooldown');
  await vi.advanceTimersByTimeAsync(400);expect(f.controller.getState().phase).toBe('recording');expect(f.adapter.start).toHaveBeenCalledTimes(2);f.controller.end();
 }finally{vi.useRealTimers();}
});
it('replays while automatic speech is playing, then stays paused',async()=>{
 const f=fixture(),first=deferred<'finished'>(),second=deferred<'finished'>();let calls=0;
 f.adapter.play=vi.fn(()=>++calls===1?first.promise:second.promise);f.controller.startConversation();await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('recording'));
 await f.controller.stop();const original=f.controller.reply('reply');expect(f.controller.getState().phase).toBe('playing');
 const replay=f.controller.replay('reply');expect(f.adapter.play).toHaveBeenCalledTimes(2);second.resolve('finished');await replay;
 expect(f.controller.getState().phase).toBe('paused');first.resolve('finished');await original;expect(f.controller.getState().phase).toBe('paused');expect(f.adapter.start).toHaveBeenCalledTimes(1);f.controller.end();
});



it('shows calibrated speech and pause feedback, then sends exactly once against steady room noise',async()=>{
 const f=fixture();f.controller.startConversation();await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('recording'));
 for(let time=0;time<500;time+=100)f.controller.meter(time,-35);
 expect(f.controller.getState().activity?.phase).toBe('calibrating');
 f.controller.meter(500,-35);expect(f.controller.getState().activity?.phase).toBe('listening');
 for(let time=600;time<=1000;time+=100)f.controller.meter(time,-18);
 expect(f.controller.getState().activity?.phase).toBe('speaking');
 for(let time=1100;time<=1800;time+=100)f.controller.meter(time,-35);
 expect(f.controller.getState().activity?.phase).toBe('pause');
 expect(f.controller.getState().activity?.pauseProgress).toBeGreaterThan(0);
 for(let time=1900;time<=2400;time+=100)f.controller.meter(time,-35);
 await vi.waitFor(()=>expect(f.controller.getState().phase).toBe('sent'));
 expect(f.controller.getState()).toMatchObject({sentText:'hello',activity:null});
 expect(f.adapter.send).toHaveBeenCalledTimes(1);expect(f.adapter.stop).toHaveBeenCalledTimes(1);f.controller.end();
});
it('retains recognized sent words and the reply watcher during a long manual wait',async()=>{
 const f=fixture();await f.controller.start();await f.controller.stop();f.controller.edit('the corrected words');
 let valid!:()=>boolean;f.adapter.send=async(_text,check)=>{valid=check;};await f.controller.send();
 const cancelled=vi.mocked(f.adapter.cancelPendingReply).mock.calls.length;
 f.controller.waitingLonger(valid);
 expect(f.controller.getState()).toMatchObject({phase:'sent',sentText:'the corrected words'});
 expect(f.adapter.cancelPendingReply).toHaveBeenCalledTimes(cancelled);
 await f.controller.reply('the eventual reply');expect(f.adapter.play).toHaveBeenCalledWith('the eventual reply',expect.any(AbortSignal));
 expect(f.controller.getState().phase).toBe('idle');f.controller.end();
});
it('ignores long-wait feedback from an older voice turn',async()=>{
 const f=fixture();await f.controller.start();await f.controller.stop();let valid!:()=>boolean;f.adapter.send=async(_text,check)=>{valid=check;};await f.controller.send();
 f.controller.end();f.controller.waitingLonger(valid);expect(f.controller.getState()).toMatchObject({phase:'idle',notice:null,sentText:'',activity:null});
});

it('skips synthesis when muted while explicit replay remains available',async()=>{
 const f=fixture();f.adapter.shouldSpeak=()=>false;
 await f.controller.start();await f.controller.stop();await f.controller.send();await f.controller.reply('reply');
 expect(f.adapter.play).not.toHaveBeenCalled();expect(f.controller.getState().phase).toBe('idle');
 await f.controller.replay('reply');expect(f.adapter.play).toHaveBeenCalledTimes(1);f.controller.end();
});
it('mute aborts pending synthesis and ignores its late completion',async()=>{
 const f=fixture(),pending=deferred<void>();let signal!:AbortSignal;f.adapter.play=(_text,s)=>{signal=s;return pending.promise;};
 const playing=f.controller.play('reply');f.controller.mute();expect(signal.aborted).toBe(true);expect(f.controller.getState().phase).toBe('idle');pending.resolve();await playing;expect(f.controller.getState().phase).toBe('idle');
});
it('muted automatic completion rearms only once after cooldown',async()=>{
 vi.useFakeTimers();try{
  const f=fixture();f.adapter.shouldSpeak=()=>false;f.controller.startConversation();await vi.advanceTimersByTimeAsync(0);await f.controller.stop();
  expect(f.controller.getState().phase).toBe('sent');await f.controller.reply('reply');expect(f.controller.getState().phase).toBe('cooldown');expect(f.adapter.play).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(400);expect(f.adapter.start).toHaveBeenCalledTimes(2);f.controller.end();await vi.advanceTimersByTimeAsync(1000);expect(f.adapter.start).toHaveBeenCalledTimes(2);
 }finally{vi.useRealTimers();}
});

it('muting an active automatic reply pauses until explicit resume',async()=>{
 vi.useFakeTimers();try{
  const f=fixture(),pending=deferred<'finished'>();let signal!:AbortSignal;
  f.adapter.play=(_text,s)=>{signal=s;return pending.promise;};f.controller.startConversation();await vi.advanceTimersByTimeAsync(0);await f.controller.stop();
  const reply=f.controller.reply('reply');expect(f.controller.getState().phase).toBe('playing');f.controller.mute();expect(signal.aborted).toBe(true);expect(f.controller.getState().phase).toBe('paused');
  pending.resolve('finished');await reply;await vi.advanceTimersByTimeAsync(1000);expect(f.adapter.start).toHaveBeenCalledTimes(1);
  f.controller.resume();await vi.advanceTimersByTimeAsync(0);expect(f.adapter.start).toHaveBeenCalledTimes(2);f.controller.end();
 }finally{vi.useRealTimers();}
});
