import { VoiceActivity, type VadFeedback } from './voiceActivity';
export type VoicePhase = 'idle' | 'permission' | 'recording' | 'transcribing' | 'review' | 'sending' | 'sent' | 'playing' | 'error' | 'paused' | 'cooldown';
export class DefiniteVoiceSendError extends Error {}
export type VoiceOutcome = 'interrupted' | 'error' | 'empty' | 'timeout';
export type VoiceState = {phase:VoicePhase; text:string; error:string | null; notice:string | null; activity:VadFeedback|null; sentText:string};
export type VoiceAdapters = {
  valid:()=>boolean; shouldSpeak?:()=>boolean; automaticReady?:()=>boolean; captureReady?:()=>boolean; cancelPendingReply:()=>void; permission:()=>Promise<boolean>; prepare:()=>Promise<void>; start:()=>void;
  stop:()=>Promise<string | null>; discard:()=>Promise<void>; transcribe:(uri:string,signal:AbortSignal)=>Promise<string>;
  send:(text:string,valid:()=>boolean,images?:Array<{path:string;mime:string}>)=>Promise<void>; play:(text:string,signal:AbortSignal)=>Promise<void|'finished'|'stopped'>; stopPlayback:()=>void;
};
export class VoiceController {
  private generation=0; private earlyReply:string|null=null; private controller:AbortController|null=null; private timer:ReturnType<typeof setTimeout>|null=null;
  private operation:Promise<void>=Promise.resolve(); private automatic=false; private pending=false; private silenceRetries=0; private vad:VoiceActivity|null=null; private pendingOutcome:VoiceOutcome|null=null;
  private state:VoiceState={phase:'idle',text:'',error:null,notice:null,activity:null,sentText:''}; private listeners=new Set<()=>void>();
  constructor(private adapter:VoiceAdapters) {}
  getState=()=>this.state; isAutomatic=()=>this.automatic; hasPending=()=>this.pending; subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private set(patch:Partial<VoiceState>) {this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  private current(generation:number) {return generation===this.generation && this.adapter.valid();}
  private clearTimer(){if(this.timer)clearTimeout(this.timer);this.timer=null;}
  private async discard(){try{await this.adapter.discard();}catch{}}
  end=()=>{this.generation++;this.controller?.abort();this.controller=null;this.clearTimer();this.adapter.cancelPendingReply();this.adapter.stopPlayback();const prior=this.operation,cleanup=this.discard();this.operation=Promise.all([prior.catch(()=>{}),cleanup]).then(()=>{});this.pendingOutcome=null;this.earlyReply=null;this.automatic=false;this.pending=false;this.vad=null;this.set({phase:'idle',text:'',error:null,notice:null,activity:null,sentText:''});return this.operation;};
  start=async()=>{
    if (!['idle','review','error','sent'].includes(this.state.phase) || !this.adapter.valid()) return;
    const gen=++this.generation;this.controller?.abort();this.controller=new AbortController();if(!this.automatic)this.adapter.cancelPendingReply();this.adapter.stopPlayback();this.pendingOutcome=null;this.set({phase:'permission',error:null,text:'',notice:null,activity:null,sentText:''});
    const work=this.operation.catch(()=>{}).then(async()=>{
      if(!this.current(gen))return;
      try {const allowed=await this.adapter.permission();if(!this.current(gen))return;if(!allowed){if(this.automatic)this.pause('Microphone permission is needed.');else this.set({phase:'error',error:'Microphone permission is needed to record.'});return;}
        await this.adapter.prepare();if(!this.current(gen)){await this.discard();return;}
        this.adapter.start();if(!this.current(gen)){await this.discard();return;}
        this.vad=this.automatic?new VoiceActivity():null;this.set({phase:'recording'});this.timer=setTimeout(()=>{if(this.automatic && !this.vad?.hasSpeech())void this.noSpeech();else void this.stop();},60000);
      }catch{await this.discard();if(this.current(gen)){if(this.automatic)this.pause('Could not start recording. Tap Resume to try again.');else this.set({phase:'error',error:'Could not start recording. Please try again.'});}}
    });
    this.operation=work;await work;
  };
  private ready(){return this.adapter.valid() && (this.adapter.automaticReady?.() ?? true);}
  private canCapture(){return this.ready() && (this.adapter.captureReady?.() ?? true);}
  startConversation=()=>{this.automatic=true;if(this.pending || !this.canCapture()) {this.set({phase:'paused',notice:'Resolve the pending turn or return to a ready chat before resuming.'});return;}this.silenceRetries=0;void this.start();};
  resume=()=>{if(!this.automatic || this.pending || !this.canCapture())return;this.silenceRetries=0;this.set({phase:'idle',notice:null,error:null});void this.start();};
  pause=(reason='Conversation paused. Tap Resume to continue.')=>{if(!this.automatic)return;this.generation++;this.controller?.abort();this.controller=null;this.clearTimer();this.vad=null;this.adapter.stopPlayback();const prior=this.operation;const cleanup=this.discard();this.operation=Promise.all([prior.catch(()=>{}),cleanup]).then(()=>{});this.set({phase:'paused',notice:reason,error:null,activity:null});return this.operation;};
  interruptAndSpeak=()=>{if(!this.automatic || this.state.phase!=='playing')return;this.pause();this.resume();};
  waitForCleanup=()=>this.operation;
  meter=(now:number,level:number|undefined)=>{if(!this.automatic || this.state.phase!=='recording' || !this.vad)return;if(!this.ready()){this.pause('Conversation paused because the chat needs attention.');return;}const result=this.vad.sample(now,level);if(result!=='unavailable')this.set({activity:this.vad.feedback()});if(result==='unavailable')this.pause('Microphone metering is unavailable. Tap Resume to try again.');else if(result==='endpoint')void this.stop();else if(result==='no-speech')void this.noSpeech();};
  private noSpeech=()=>{if(this.state.phase!=='recording')return;this.clearTimer();this.set({phase:'transcribing'});const gen=this.generation;const work=(async()=>{await this.discard();if(!this.current(gen))return;if(++this.silenceRetries>2){this.pause('No speech detected. Tap Resume to try again.');return;}this.set({phase:'idle'});void this.start();})();this.operation=work;return work;};
  stop=async()=>{
    if(this.state.phase!=='recording')return;const gen=this.generation,signal=this.controller!.signal;this.clearTimer();this.set({phase:'transcribing',error:null,activity:null});
    const work=this.operation.catch(()=>{}).then(async()=>{
      try{const uri=await this.adapter.stop();if(!this.current(gen))return;if(!uri)throw new Error();const text=await this.adapter.transcribe(uri,signal);if(!this.current(gen))return;
        await this.discard();if(!this.current(gen))return;
        if(!text.trim()){if(this.automatic){if(++this.silenceRetries>2)this.pause('No speech detected. Tap Resume to try again.');else {this.set({phase:'idle'});void this.start();}}else this.set({phase:'error',error:'No speech was detected. Try recording again.'});return;}
        this.set({phase:'review',text,error:null});
      }catch{if(this.current(gen)){if(this.automatic)this.pause('Could not transcribe. Tap Resume to try again.');else this.set({phase:'error',error:'Could not transcribe this recording. Please try again.'});}}
      finally{await this.discard();}
    });
    this.operation=work;await work;
    if(this.current(gen) && this.automatic && this.getState().phase==='review'){if(!this.canCapture()){this.pause('Conversation paused because the chat needs attention.');return;}this.silenceRetries=0;await this.send();}
  };
  edit=(text:string)=>{if(this.state.phase==='review')this.set({text});};
  waitingLonger=(valid:()=>boolean)=>{if(valid() && this.adapter.valid() && this.state.phase==='sent')this.set({notice:'Hermes is still working. Audio starts after the full reply is ready.'});};
  private applyOutcome(outcome:VoiceOutcome) {
    const notice=outcome==='interrupted'?'The turn stopped. See chat for details.':outcome==='error'?'The turn ended. See chat for details.':outcome==='empty'?'The reply finished without spoken text. See chat.':'The reply is taking longer. Continue in chat.';
    this.set({phase:'idle',text:'',error:null,notice});
  }
  settle=(valid:()=>boolean,outcome:VoiceOutcome)=>{if(!valid())return;if(outcome!=='timeout')this.pending=false;if(!this.adapter.valid())return;if(this.automatic){this.pause('The reply ended or timed out. Check chat before resuming.');return;}if(this.state.phase==='sending')this.pendingOutcome=outcome;else if(this.state.phase==='sent')this.applyOutcome(outcome);};
  send=async()=>{if(this.state.phase!=='review'||!this.state.text.trim())return false;return this.submit(this.state.text);};
  sendImages=async(images:Array<{path:string;mime:string}>)=>{if(!images.length || !this.automatic || this.state.phase!=='paused' || this.pending || !this.canCapture())return false;return this.submit('',images);};
  private submit=async(text:string,images?:Array<{path:string;mime:string}>)=>{if(!this.adapter.valid())return false;const gen=this.generation;this.pendingOutcome=null;if(this.automatic)this.pending=true;this.set({phase:'sending',error:null,notice:null});
    try{await this.adapter.send(text,()=>this.current(gen),images);if(this.current(gen)){const outcome=this.pendingOutcome;this.pendingOutcome=null;if(outcome)this.applyOutcome(outcome);else {this.set({phase:'sent',text:'',error:null,sentText:text});const reply=this.earlyReply;this.earlyReply=null;if(reply)void this.reply(reply);}}return true;}
    catch(error){if(error instanceof DefiniteVoiceSendError)this.pending=false;if(this.current(gen)){this.pendingOutcome=null;if(this.automatic)this.pause(error instanceof DefiniteVoiceSendError?'Could not save the message. Tap Resume to try again.':'The message may still be pending. Check chat before resuming.');else this.set({phase:'review',error:'Could not save this message. Please try again.'});}return false;}
  };
  stopSpeaking=()=>{if(this.state.phase!=='playing')return;if(this.automatic){this.pause();return;}this.generation++;this.controller?.abort();this.controller=null;this.adapter.stopPlayback();this.set({phase:'idle',error:null});};
  private rearm(gen:number){this.clearTimer();this.set({phase:'cooldown',error:null});this.timer=setTimeout(()=>{if(this.current(gen) && this.canCapture()){this.set({phase:'idle'});void this.start();}else if(this.current(gen))this.pause('Conversation paused because the chat needs attention.');},400);}
  mute=()=>{if(this.state.phase!=='playing')return;if(this.automatic){this.pause();return;}this.generation++;this.controller?.abort();this.controller=null;this.adapter.stopPlayback();this.set({phase:'idle',error:null});};
  reply=async(text:string)=>{if(this.state.phase==='sending'){this.earlyReply=text;return;}this.pending=false;if(this.automatic && this.state.phase==='paused')return;if(!this.ready() && this.automatic){this.pause('Conversation paused because the chat needs attention.');return;}if(this.adapter.shouldSpeak?.()===false){if(this.automatic)this.rearm(++this.generation);else this.set({phase:'idle',error:null});return;}if(!this.automatic){await this.play(text);return;}await this.play(text,true);};
  replay=async(text:string)=>{if(this.state.phase==='playing')this.stopSpeaking();await this.play(text,false,true);};
  play=async(text:string,autoReply=false,replay=false)=>{if(!this.adapter.valid()||(!['idle','sent','error'].includes(this.state.phase) && !(replay && this.automatic && this.state.phase==='paused')))return;const gen=++this.generation;this.controller?.abort();this.controller=new AbortController();this.adapter.stopPlayback();this.set({phase:'playing',error:null});
    try{const result=await this.adapter.play(text,this.controller.signal);if(this.current(gen)){if(autoReply && this.automatic && result!=='finished'){this.pause('Speech stopped. Tap Resume to continue.');return;}if(autoReply && this.automatic){this.rearm(gen);}else if(replay && this.automatic)this.set({phase:'paused',notice:'Conversation paused. Tap Resume to continue.'});else this.set({phase:'idle'});}}catch{if(this.current(gen)){if(this.automatic)this.pause('Could not play the reply. Tap Resume to continue.');else this.set({phase:'error',error:'Could not play this reply. Please try again.'});}}};
}
