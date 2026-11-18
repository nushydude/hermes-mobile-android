import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import type { PlaybackAdapter } from './voicePlayback';
import { queueVoiceAudioMode, waitVoiceCleanup } from './voiceAudioMode';

type Synthesize=(text:string,signal:AbortSignal)=>Promise<{mime:string;base64:string}>;
export function nativeVoicePlayback(synthesize:Synthesize, valid:()=>boolean, onStarted?:()=>void):PlaybackAdapter {
  return {acquire:async(text,signal)=>{
    let file:File|null=null, player:AudioPlayer|null=null, active=true;
    const cleanup=()=>{active=false;if(player){try{player.pause();}catch{}try{player.remove();}catch{}player=null;}if(file){try{if(file.exists)file.delete();}catch{}file=null;}};
    const check=()=>{if(signal.aborted||!valid())throw new Error('Cancelled');};
    try{
      check();
      const request=new AbortController();
      const cancel=()=>request.abort();signal.addEventListener('abort',cancel,{once:true});
      let timer:ReturnType<typeof setTimeout>|undefined;
      const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{request.abort();reject(new Error('Synthesis timed out'));},60000);});
      let audio:{mime:string;base64:string};
      try{audio=await Promise.race([synthesize(text,request.signal),timeout]);}finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',cancel);}
      check();
      const ext=audio.mime.includes('wav')?'wav':audio.mime.includes('ogg')?'ogg':audio.mime.includes('webm')?'webm':audio.mime.includes('mp4')?'m4a':'mp3';
      file=new File(Paths.cache,`hermes-voice-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);file.create();
      await file.write(audio.base64,{encoding:'base64'});check();
      await waitVoiceCleanup();check();
      await queueVoiceAudioMode(setAudioModeAsync,false,()=>!signal.aborted && valid());check();
      player=createAudioPlayer(file.uri);const current=player;
      await new Promise<void>((resolve,reject)=>{
        let settled=false, sub:{remove:()=>void}|null=null;
        const removeSubscription=()=>{const owned=sub;sub=null;try{owned?.remove();}catch{}};
        const done=(error=false)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);removeSubscription();error?reject(new Error('Audio load failed')):resolve();};
        const abort=()=>done(true);
        const timer=setTimeout(()=>done(true),30000);
        signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted){done(true);return;}
        try{
          sub=current.addListener('playbackStatusUpdate',status=>{if(status.error)done(true);else if(status.isLoaded)done();});
          if(settled)removeSubscription();else if(current.isLoaded)done();
        }catch{done(true);}
      });
      check();
      let reported=false;return {play:()=>current.play(),pause:()=>current.pause(),seek:(seconds)=>current.seekTo(seconds),rate:(speed)=>current.setPlaybackRate(speed),release:cleanup,subscribe:(fn)=>{let subscribed=true;const sub=current.addListener('playbackStatusUpdate',s=>{if(s.playing&&!reported){try{if(subscribed&&active&&!signal.aborted&&valid()){reported=true;onStarted?.();}}catch{}}fn({position:s.currentTime,duration:s.duration,playing:s.playing,buffering:s.isBuffering,finished:s.didJustFinish,error:!!s.error});});return()=>{subscribed=false;sub.remove();};}};
    }catch(error){cleanup();throw error;}
  }};
}
