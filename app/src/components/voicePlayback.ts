export type PlaybackStatus = { position:number; duration:number; playing:boolean; buffering:boolean; finished:boolean; error?:boolean };
export type PlaybackHandle = { play:()=>void; pause:()=>void; seek:(seconds:number)=>Promise<void>; rate:(rate:number)=>void; release:()=>void; subscribe:(fn:(status:PlaybackStatus)=>void)=>()=>void };
export type PlaybackAdapter = { acquire:(text:string, signal:AbortSignal)=>Promise<PlaybackHandle> };
export type PlaybackState = { phase:'idle'|'preparing'|'playing'|'paused'|'error'; part:number; count:number; position:number; duration:number; speed:number };

/** Owns one program and one native resource at a time. Every asynchronous completion is generation fenced. */
export class VoicePlayback {
  private state:PlaybackState={phase:'idle',part:0,count:0,position:0,duration:0,speed:1};
  private listeners=new Set<()=>void>(); private generation=0; private abort:AbortController|null=null;
  private loadId=0; private handle:PlaybackHandle|null=null; private unsubscribe:(()=>void)|null=null; private parts:string[]=[];
  private next:{index:number;promise:Promise<PlaybackHandle|null>;handle:PlaybackHandle|null;abort:AbortController;unlink:()=>void}|null=null; private durations:number[]=[]; private paused=false; private awaitingResume=false; private resolve:((result:'finished'|'stopped')=>void)|null=null; private reject:((e:Error)=>void)|null=null;
  constructor(private adapter:PlaybackAdapter) {}
  getState=()=>this.state; subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private set(patch:Partial<PlaybackState>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  private release(){this.awaitingResume=false;const unsubscribe=this.unsubscribe;this.unsubscribe=null;try{unsubscribe?.();}catch{}const h=this.handle;this.handle=null;try{h?.release();}catch{}}
  private dropNext(){const next=this.next;this.next=null;if(next){next.unlink();next.abort.abort();}if(next?.handle){try{next.handle.release();}catch{} next.handle=null;}}
  private prefetch(index:number,gen:number){
    if(index>=this.parts.length)return;this.dropNext();
    const abort=new AbortController(), program=this.abort!.signal;
    const cancel=()=>abort.abort();program.addEventListener('abort',cancel,{once:true});
    const slot:{index:number;promise:Promise<PlaybackHandle|null>;handle:PlaybackHandle|null;abort:AbortController;unlink:()=>void}={index,handle:null,abort,unlink:()=>program.removeEventListener('abort',cancel),promise:Promise.resolve(null)};
    this.next=slot;
    slot.promise=this.adapter.acquire(this.parts[index],abort.signal).then(h=>{if(gen!==this.generation || this.next!==slot || abort.signal.aborted){h.release();return null;}slot.handle=h;return h;},()=>null);
  }
  stop=()=>{this.generation++;this.loadId++;this.abort?.abort();this.abort=null;this.dropNext();this.release();this.resolve?.('stopped');this.resolve=null;this.reject=null;this.set({phase:'idle',position:0,duration:0});};
  play(parts:string[], signal:AbortSignal):Promise<'finished'|'stopped'>{
    this.stop();this.paused=false;this.parts=parts;this.durations=[];this.set({count:parts.length,part:0});
    if(!parts.length)return Promise.resolve('finished');
    const gen=this.generation;this.abort=new AbortController();
    return new Promise<'finished'|'stopped'>((resolve,reject)=>{this.resolve=resolve;this.reject=reject;
      const cancel=()=>{if(gen===this.generation)this.stop();};signal.addEventListener('abort',cancel,{once:true});
      const originalResolve=this.resolve,originalReject=this.reject;
      this.resolve=(result)=>{signal.removeEventListener('abort',cancel);originalResolve(result);};
      this.reject=(e)=>{signal.removeEventListener('abort',cancel);originalReject(e);};
      if(signal.aborted)cancel();else void this.load(0,0,gen);
    });
  }
  private async load(index:number,position:number,gen:number){
    const loadId=++this.loadId;this.release();this.set({phase:'preparing',part:index,position:0,duration:0});
    try{
      let h:PlaybackHandle|null=null;const slot=this.next;if(slot?.index===index){h=await slot.promise;if(this.next===slot){this.next=null;slot.unlink();slot.handle=null;}}else this.dropNext();
      if(gen!==this.generation || loadId!==this.loadId)return;
      if(!h)h=await this.adapter.acquire(this.parts[index],this.abort!.signal);
      if(gen!==this.generation || loadId!==this.loadId){h.release();return;}
      this.handle=h;h.rate(this.state.speed);
      if(position>0)await h.seek(position);
      if(gen!==this.generation || this.handle!==h)return;
      let started=false;
      this.unsubscribe=h.subscribe(status=>{
        if(gen!==this.generation || this.handle!==h)return;
        if(status.error){this.fail(gen);return;}
        if(status.duration>0)this.durations[index]=status.duration;
        if(status.finished){if(index+1<this.parts.length)void this.load(index+1,0,gen);else{this.release();this.set({phase:'idle'});const done=this.resolve;this.resolve=null;this.reject=null;done?.('finished');}return;}
        if(status.playing){started=true;this.awaitingResume=false;}
        else if(started && !status.buffering && !this.paused && !this.awaitingResume)this.paused=true;
        const phase=this.paused?'paused':status.playing||this.awaitingResume?'playing':'preparing';
        this.set({position:status.position,duration:status.duration,phase});
      });
      this.prefetch(index+1,gen);
      if(this.paused)this.set({phase:'paused'});else h.play();
    }catch{if(gen===this.generation && loadId===this.loadId)this.fail(gen);}
  }
  private fail(gen:number){if(gen!==this.generation)return;this.abort?.abort();this.dropNext();this.release();this.set({phase:'error'});const reject=this.reject;this.reject=null;this.resolve=null;reject?.(new Error('Playback failed'));}
  toggle=()=>{if(!this.handle)return;try{if(this.state.phase==='playing'){this.paused=true;this.awaitingResume=false;this.handle.pause();this.set({phase:'paused'});}else if(this.state.phase==='paused'){this.paused=false;this.awaitingResume=true;this.handle.play();this.set({phase:'playing'});}}catch{this.fail(this.generation);}};
  speed=(speed:number)=>{this.set({speed});try{this.handle?.rate(speed);}catch{}};
  rewind=async()=>{if(!this.handle||!['playing','paused'].includes(this.state.phase))return;const gen=this.generation;let index=this.state.part,position=this.state.position-10;
    while(position<0&&index>0){index--;position+=this.durations[index]||0;}
    position=Math.max(0,position);
    if(index!==this.state.part){void this.load(index,position,gen);return;}
    const handle=this.handle;
    try{await handle.seek(position);if(gen===this.generation && this.handle===handle)this.set({position});}catch{if(gen===this.generation && this.handle===handle)this.fail(gen);}
  };
}
