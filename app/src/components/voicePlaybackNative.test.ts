import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const native=vi.hoisted(()=>({files:[] as any[],players:[] as any[],write:async()=>{},loaded:false,synchronous:false,throwPause:false,throwAdd:false,throwRemove:false}));
vi.mock('expo-file-system',()=>({Paths:{cache:'cache'},File:class {
  uri:string;exists=false;deleted=0;
  constructor(...args:string[]){this.uri=args.join('/');native.files.push(this);}
  create(){this.exists=true;}
  async write(){await native.write();}
  delete(){this.deleted++;this.exists=false;}
}}));
vi.mock('expo-audio',()=>({
 setAudioModeAsync:vi.fn(async()=>{}),
 createAudioPlayer:vi.fn(()=>{
   const p={isLoaded:native.loaded,removed:0,paused:0,listener:null as null|((s:any)=>void),subscriptions:0,
     pause(){this.paused++;if(native.throwPause)throw new Error('pause failed');},remove(){this.removed++;},play(){},seekTo:async()=>{},setPlaybackRate(){},
     addListener(_name:string,listener:(s:any)=>void){if(native.throwAdd)throw new Error('add failed');this.listener=listener;this.subscriptions++;if(native.synchronous)listener({isLoaded:true,error:null});return {remove:()=>{p.subscriptions--;p.listener=null;if(native.throwRemove)throw new Error('remove failed');}};}};
   native.players.push(p);return p;
 }),
}));
import { nativeVoicePlayback } from './voicePlaybackNative';
import { setAudioModeAsync } from 'expo-audio';
import { voiceAudioMode, registerVoiceCleanup } from './voiceAudioMode';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const audio={mime:'audio/mpeg',base64:'YWJj'};
beforeEach(()=>{vi.mocked(setAudioModeAsync).mockReset().mockResolvedValue(undefined);native.files=[];native.players=[];native.write=async()=>{};native.loaded=false;native.synchronous=false;native.throwPause=false;native.throwAdd=false;native.throwRemove=false;vi.useFakeTimers();});
afterEach(()=>vi.useRealTimers());
describe('foreground voice audio mode',()=>{
 it('requests transient non-mixing playback focus on the real acquire path',async()=>{
  native.loaded=true;const handle=await nativeVoicePlayback(async()=>audio,()=>true).acquire('text',new AbortController().signal);
  expect(setAudioModeAsync).toHaveBeenCalledWith({allowsRecording:false,shouldPlayInBackground:false,interruptionMode:'doNotMix'});handle.release();
  expect(voiceAudioMode(true)).toEqual({allowsRecording:true,shouldPlayInBackground:false,interruptionMode:'doNotMix'});
 });
 it('does not create a player when cancelled while setting the audio mode',async()=>{
  const pending=deferred<void>();vi.mocked(setAudioModeAsync).mockImplementation(()=>pending.promise);
  const abort=new AbortController(),work=nativeVoicePlayback(async()=>audio,()=>true).acquire('text',abort.signal);await flush();
  expect(setAudioModeAsync).toHaveBeenCalled();abort.abort();pending.resolve();await expect(work).rejects.toThrow();
  expect(native.players).toHaveLength(0);expect(native.files[0].deleted).toBe(1);
 });
 it('cleans the file and does not create a player if setting the audio mode fails',async()=>{
  vi.mocked(setAudioModeAsync).mockRejectedValueOnce(new Error('mode failed'));
  await expect(nativeVoicePlayback(async()=>audio,()=>true).acquire('text',new AbortController().signal)).rejects.toThrow('mode failed');
  expect(native.players).toHaveLength(0);expect(native.files[0].deleted).toBe(1);
 });
});
describe('native voice playback resource ownership',()=>{
 it('reports the first playing status once without disrupting playback when diagnostics fail',async()=>{native.loaded=true;const started=vi.fn(()=>{throw new Error('diagnostic failure');});const handle=await nativeVoicePlayback(async()=>audio,()=>true,started).acquire('text',new AbortController().signal);const statuses:any[]=[];const unsubscribe=handle.subscribe(s=>statuses.push(s));const playing={playing:true,currentTime:0,duration:1,isBuffering:false,didJustFinish:false};native.players[0].listener(playing);native.players[0].listener(playing);expect(started).toHaveBeenCalledTimes(1);expect(statuses).toHaveLength(2);unsubscribe();handle.release();});
 it('does not report a retained stale listener after release when another playback has started',async()=>{native.loaded=true;let owner='old';const started:string[]=[];const adapter=nativeVoicePlayback(async()=>audio,()=>true,()=>started.push(owner));const old=await adapter.acquire('old',new AbortController().signal);const unsubscribe=old.subscribe(()=>{});const late=native.players[0].listener;unsubscribe();owner='new';const next=await adapter.acquire('new',new AbortController().signal);next.subscribe(()=>{});const status={playing:true,currentTime:0,duration:1,isBuffering:false,didJustFinish:false};late(status);expect(started).toEqual([]);old.release();late(status);expect(started).toEqual([]);native.players[1].listener(status);expect(started).toEqual(['new']);next.release();});
 it('does not create resources when ignored synthesis finishes after cancellation',async()=>{const pending=deferred<typeof audio>();const abort=new AbortController();const work=nativeVoicePlayback(()=>pending.promise,()=>true).acquire('text',abort.signal);abort.abort();pending.resolve(audio);await expect(work).rejects.toThrow();expect(native.files).toHaveLength(0);expect(native.players).toHaveLength(0);});
 it('deletes its file and creates no player when cancelled during write',async()=>{const pending=deferred<void>();native.write=()=>pending.promise;const abort=new AbortController();const work=nativeVoicePlayback(async()=>audio,()=>true).acquire('text',abort.signal);await flush();expect(native.files).toHaveLength(1);abort.abort();pending.resolve();await expect(work).rejects.toThrow();expect(native.files[0].deleted).toBe(1);expect(native.players).toHaveLength(0);});
 it.each(['abort','timeout'] as const)('releases the player, file and listener on native load %s',async(mode)=>{const abort=new AbortController();const work=nativeVoicePlayback(async()=>audio,()=>true).acquire('text',abort.signal);await flush();expect(native.players[0].subscriptions).toBe(1);const rejected=expect(work).rejects.toThrow();if(mode==='abort')abort.abort();else await vi.advanceTimersByTimeAsync(30000);await rejected;expect(native.players[0].removed).toBe(1);expect(native.players[0].subscriptions).toBe(0);expect(native.files[0].deleted).toBe(1);});
 it('bounds stalled synthesis and aborts its request',async()=>{let request!:AbortSignal;const work=nativeVoicePlayback((_text,signal)=>{request=signal;return new Promise(()=>{});},()=>true).acquire('text',new AbortController().signal);const rejected=expect(work).rejects.toThrow();await vi.advanceTimersByTimeAsync(60000);await rejected;expect(request.aborted).toBe(true);expect(native.files).toHaveLength(0);});
 it('accepts a synchronous loaded callback during listener registration',async()=>{native.synchronous=true;const handle=await nativeVoicePlayback(async()=>audio,()=>true).acquire('text',new AbortController().signal);handle.release();expect(native.players[0].subscriptions).toBe(0);expect(native.files[0].deleted).toBe(1);});
 it('settles and cleans owned resources when listener registration throws',async()=>{native.throwAdd=true;await expect(nativeVoicePlayback(async()=>audio,()=>true).acquire('text',new AbortController().signal)).rejects.toThrow();expect(native.players[0].removed).toBe(1);expect(native.files[0].deleted).toBe(1);expect(vi.getTimerCount()).toBe(0);});
 it('settles a load error even if removing its listener throws',async()=>{native.throwRemove=true;const work=nativeVoicePlayback(async()=>audio,()=>true).acquire('text',new AbortController().signal);await flush();native.players[0].listener({isLoaded:false,error:'failed'});await expect(work).rejects.toThrow();expect(native.players[0].removed).toBe(1);expect(native.files[0].deleted).toBe(1);expect(vi.getTimerCount()).toBe(0);});
 it('removes the player and file when pause throws',async()=>{native.loaded=true;const handle=await nativeVoicePlayback(async()=>audio,()=>true).acquire('text',new AbortController().signal);native.throwPause=true;handle.release();expect(native.players[0].removed).toBe(1);expect(native.files[0].deleted).toBe(1);});
 it('releasing an old handle repeatedly cannot affect newer resources',async()=>{native.loaded=true;const adapter=nativeVoicePlayback(async()=>audio,()=>true);const old=await adapter.acquire('old',new AbortController().signal);old.release();const newer=await adapter.acquire('new',new AbortController().signal);old.release();expect(native.players[1].removed).toBe(0);expect(native.players[1].paused).toBe(0);expect(native.files[1].exists).toBe(true);newer.release();expect(native.players[1].removed).toBe(1);expect(native.files[1].deleted).toBe(1);});
});

it('waits for prior capture cleanup before setting playback mode or creating a player',async()=>{
 native.loaded=true;const cleanup=deferred<void>();registerVoiceCleanup(cleanup.promise);const work=nativeVoicePlayback(async()=>audio,()=>true).acquire('text',new AbortController().signal);await flush();
 expect(setAudioModeAsync).not.toHaveBeenCalled();expect(native.players).toHaveLength(0);cleanup.resolve();const handle=await work;expect(setAudioModeAsync).toHaveBeenCalledTimes(1);handle.release();
});
