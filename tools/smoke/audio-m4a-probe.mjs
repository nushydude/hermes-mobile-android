import { gatewayOrigin, hermesHome } from '../config.mjs';
// Encoding compatibility only. Requires the independent synthetic WAV audio gate to pass first.
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {matchedTranscript,transcriptDiagnostic,boundedBytes} from './audio-core.mjs';
const dir=join(process.cwd(),'.artifacts','audio-smoke');
const result={started_at:new Date().toISOString(),result:'failed',encoding:'AAC mono 44100Hz, audio/mp4'};
try {
  const prior=JSON.parse(readFileSync(join(dir,'audio-result.json'),'utf8'));
  if(prior.result!=='audio_passed') throw new Error();
  const wav=readFileSync(join(dir,'fixture.wav'));
  if(createHash('sha256').update(wav).digest('hex')!==prior.fixture_sha256) throw new Error();
  const bytes=readFileSync(join(dir,'fixture.m4a'));
  if(bytes.length<100 || bytes.length>2*1024*1024) throw new Error();
  const entries=[...readFileSync(join(hermesHome(),'.env'),'utf8').matchAll(/^\s*(?:export\s+)?HERMES_DASHBOARD_SESSION_TOKEN\s*=\s*(.*)$/gm)];
  if(entries.length!==1) throw new Error();
  let token=entries[0][1].trim();
  if((token.startsWith('"')&&token.endsWith('"'))||(token.startsWith("'")&&token.endsWith("'"))) token=token.slice(1,-1);
  if(!token || token.startsWith('file:')) throw new Error();
  const start=Date.now();
  const response=await fetch(gatewayOrigin()+'/api/audio/transcribe',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({data_url:`data:audio/mp4;base64,${bytes.toString('base64')}`,mime_type:'audio/mp4'}),signal:AbortSignal.timeout(45000)});
  result.status=response.status;result.transcription_ms=Date.now()-start;
  if(!response.ok) throw new Error();
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(response,256*1024)));
  result.diagnostic=transcriptDiagnostic(body.transcript);
  result.transcription_matches=body.ok===true&&!!matchedTranscript(body.transcript);
  result.bytes=bytes.length;result.fixture_sha256=createHash('sha256').update(bytes).digest('hex');
  if(!result.transcription_matches) throw new Error();
  result.result='passed';
} catch { process.exitCode=1; }
result.finished_at=new Date().toISOString();
writeFileSync(join(dir,'m4a-result.json'),JSON.stringify(result,null,2),{mode:0o600});
console.log(JSON.stringify(result));
