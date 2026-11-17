import { gatewayOrigin, ntfyOrigin, readDeploymentToken } from '../config.mjs';
// Explicit PC-only integration. No phone/Android interaction or existing chat mutation.
import {readFileSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {CanonicalClient} from '@hermes-mobile/protocol';

it('ordinary GUI worker hooks publish a generic private notification with the session link',async()=>{
  const token = readDeploymentToken();
  const cfg=JSON.parse(readFileSync('.artifacts/notifications/plugin-config.json','utf8'));
  const client=new CanonicalClient({baseUrl:gatewayOrigin(),getToken:async()=>token,persistSubmission:async()=>{},acknowledgeSubmission:async()=>{}});
  let owned:string|null=null,observed=false;
  try{
    await client.connect(); const created=await client.createSession({title:'Hermes Mobile notify smoke '+crypto.randomUUID()}); owned=created.session_id; await client.openSession(owned);
    await client.submit({session_id:owned,text:'Without using any tools, reply exactly NOTIFICATION_HOOK_OK.'});
    const until=Date.now()+90_000;
    while(Date.now()<until){
      const response=await fetch(ntfyOrigin()+'/' +encodeURIComponent(cfg.topic)+'/json?poll=1',{redirect:'error'});
      if(response.ok){for(const line of (await response.text()).split('\n').filter(Boolean)){const message=JSON.parse(line);if(message.click==='hermesmobile://session/'+encodeURIComponent(owned)&&message.message==='Hermes turn finished'){observed=true;break;}}}
      if(observed)break; await new Promise(resolve=>setTimeout(resolve,400));
    }
    expect(observed).toBe(true);
  }finally{
    try{if(owned&&client.connectionState==='ready')await client.mutate(owned,'archive',{archived:true});}
    finally{client.close();writeFileSync('.artifacts/notifications/hook-live-result.json',JSON.stringify({checked_at:new Date().toISOString(),gui_session:owned,ordinary_worker_notification_observed:observed,phone_tested:false},null,2));}
  }
});
