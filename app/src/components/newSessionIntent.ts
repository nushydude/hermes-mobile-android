// Runtime only: the destination consumes an intent once with its own speech owner.
type Intent={token:object;epoch:number;origin:string;target:string|null;revision:number|null;expires:number};
let current:Intent|null=null;const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(fn=>fn());
export function reserveVoiceEntry(epoch:number,origin:string){const token={};current={token,epoch,origin,target:null,revision:null,expires:Date.now()+60000};return token;}
export function targetVoiceEntry(token:object,target:string,revision:number){if(current?.token!==token)return;current={...current,target,revision};emit();}
export function cancelVoiceEntry(token:object){if(current?.token===token){current=null;emit();}}
export function consumeVoiceEntry(epoch:number,origin:string,target:string,revision:number){if(!current)return false;if(current.expires<Date.now()){current=null;return false;}if(current.epoch!==epoch || current.origin!==origin || current.target!==target || current.revision!==revision)return false;current=null;return true;}
export function subscribeVoiceEntry(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
