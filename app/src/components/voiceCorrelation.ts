export type CompletionEvent = {type?:unknown;session_id?:unknown;admission_id?:unknown;payload?:any};
export class VoiceCorrelation {
  private id:string|null=null; private pending:CompletionEvent[]=[]; private done=false;
  constructor(private session:string, private admission: (submission:string)=>string | undefined, private matched:(event:CompletionEvent)=>void) {}
  event(event:CompletionEvent) { if(this.done || event.type!=='message.complete' || event.session_id!==this.session)return; this.pending.push(event); if(this.pending.length>100)this.pending.shift(); this.flush(); }
  bind(submission:string) {if(this.done)return;this.id=submission;this.flush();}
  refresh() {this.flush();}
  private flush() {if(!this.id||this.done)return;const admission=this.admission(this.id);const event=this.pending.find(e=>e.payload?.persisted_turn?.submission_id===this.id || (!!admission && e.admission_id===admission));if(event){this.done=true;this.pending=[];this.matched(event);}}
  close(){this.done=true;this.pending=[];}
}
