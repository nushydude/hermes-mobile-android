import { VoiceCorrelation, type CompletionEvent } from './voiceCorrelation';

/** Installed before sending; accepts only the matching durable submission. */
export class TypedSpeechWatcher {
  private correlation:VoiceCorrelation;
  private closed=false;
  constructor(session:string, admission:(submission:string)=>string|undefined, private valid:()=>boolean, private speak:(text:string)=>void) {
    this.correlation=new VoiceCorrelation(session,admission,event=>{
      if(this.closed)return;
      this.close();
      if(this.valid() && event.payload?.status==='complete' && typeof event.payload?.text==='string' && event.payload.text.trim())this.speak(event.payload.text);
    });
  }
  event=(event:CompletionEvent)=>{if(!this.closed)this.correlation.event(event);};
  bind=(submission:string)=>{if(!this.closed)this.correlation.bind(submission);};
  refresh=()=>{if(!this.closed)this.correlation.refresh();};
  close=()=>{this.closed=true;this.correlation.close();};
}
