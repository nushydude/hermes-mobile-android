/** Keeps a reviewed transcript immutable while its durable import is retried. */
export class TranscriptTransfer {
  private state:'idle'|'saving'|'retry'|'recovering'='idle';
  private revision=0;
  private captured:{id:string;text:string;revision:number}|null=null;
  private sequence=0;
  private priorSaved=false;
  canLeave=()=>this.state==='idle';
  edit=(text:string,apply:(text:string)=>void)=>{if(this.state!=='idle')return false;this.revision++;apply(text);return true;};
  begin=(text:string,makeId:()=>string)=>{
    if(this.state==='saving'||this.state==='recovering'||this.priorSaved||text.length>100000)return null;
    if(!this.captured)this.captured={id:makeId(),text,revision:this.revision};
    this.state='saving';const token=++this.sequence;
    return {...this.captured,token};
  };
  fail=(token:number)=>{if(this.state!=='saving'||token!==this.sequence)return false;this.state='retry';return true;};
  finish=(token:number,currentText:string)=>{
    if(this.state!=='saving'||token!==this.sequence)return 'stale' as const;
    if(!this.captured || this.revision!==this.captured.revision || currentText!==this.captured.text){this.state='idle';this.captured=null;this.priorSaved=true;return 'changed' as const;}
    this.state='idle';this.captured=null;return 'saved' as const;
  };
  canRecover=()=>this.state==='retry' || (this.state==='idle' && this.priorSaved);
  recover=async(text:string,copy:(text:string)=>Promise<boolean>,valid:()=>boolean,current:()=>string)=>{
    if(!this.canRecover())return false;
    const previous=this.state;this.state='recovering';
    try {const copied=await copy(text);if(!copied || !valid() || current()!==text){this.state=previous;return false;}this.sequence++;this.state='idle';this.captured=null;return true;}
    catch {this.state=previous;return false;}
  };
}
