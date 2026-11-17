import { createOwnedFixture, archiveOwnedFixture } from './fixture.mjs';
import { gatewayOrigin, readDeploymentToken } from '../config.mjs';
// Owned idle fixture only: no prompt, provider call, global config or raw transport output.
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
const directory='.artifacts/usability-batch';mkdirSync(directory,{recursive:true});
const evidence={result:'incomplete',checks:[],cleanup:'not_needed'};
let client,session,stage='credentials';
const safe=v=>typeof v==='string' && /^[\w./:+-]{0,120}$/.test(v)?v:null;
try {
  const token = readDeploymentToken();
  const {CanonicalClient}=await import('../../.artifacts/protocol-runtime/index.js');
  client=new CanonicalClient({baseUrl:gatewayOrigin(),getToken:async()=>token,persistSubmission:async()=>{throw Error();},acknowledgeSubmission:async()=>{}});
  stage='connect';await client.connect();
  stage='create';session=await createOwnedFixture(client, 'Hermes Mobile reasoning picker protocol check');
  writeFileSync(join(directory,'reasoning-fixture.json'),JSON.stringify({session_id:session}));
  evidence.cleanup='pending';
  await client.openSession(session);
  const read=async()=>await client.request('session.info',{session_id:session});
  const initial=await read();
  evidence.model=safe(initial.model);evidence.provider=safe(initial.provider);
  for(const effort of ['none','minimal','low','medium','high','xhigh','max','ultra',null]) {
    stage='reasoning_mutation';const result=await client.mutate(session,'reasoning',{effort});
    const info=await read();
    evidence.checks.push({effort,requested:safe(info.reasoning_effort),wire:safe(info.reasoning_effort_wire),status:safe(result.status),same_model:info.model===initial.model && info.provider===initial.provider});
    if(info.model!==initial.model||info.provider!==initial.provider)throw Error();
    if(effort!==null && info.reasoning_effort!==effort)throw Error();
  }
  stage='invalid_choice';let rejected=false;
  try{await client.mutate(session,'reasoning',{effort:'not-a-real-effort'});}catch{rejected=true;}
  evidence.invalid_rejected=rejected;if(!rejected)throw Error();
  evidence.result='passed';
}catch{evidence.result='failed';evidence.failed_stage=stage;process.exitCode=1;}
finally{
  if(session&&client)try{await archiveOwnedFixture(client,session);evidence.cleanup='archived';}catch{evidence.cleanup='failed';evidence.result='failed';process.exitCode=1;}
  client?.close();writeFileSync(join(directory,'reasoning-smoke.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
