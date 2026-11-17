import { gatewayOrigin, hermesHome } from '../config.mjs';
import { mkdirSync, readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { transcriptDiagnostic, matchedTranscript, numberRendering, audioMime, completionFor, metadata, compareMetadata, userRows, boundedBytes } from './audio-core.mjs';

const ORIGIN=gatewayOrigin();
const ARTIFACT=join(process.cwd(),'.artifacts','audio-smoke');
const FIXTURE=join(ARTIFACT,'fixture.wav');
const AUDIO_LIMIT=5*1024*1024;
const args=process.argv.slice(2);
const MODE=args.length===0?'combined':args.length===1&&args[0]==='--audio-only'?'audio':args.length===1&&args[0]==='--speech-only'?'speech':args.length===1&&args[0]==='--continuity-only'?'continuity':'invalid';
const RESULT_FILE=MODE==='audio'?'audio-result.json':MODE==='speech'?'speech-result.json':MODE==='continuity'?'continuity-result.json':'result.json';
const SYNTHETIC_WORDS='remember the blue lantern number seven';
const SCOPE=Object.freeze({audioTimeout:45000, connectTimeout:20000, rpcTimeout:20000, turnTimeout:120000});
const evidence={version:1, started_at:new Date().toISOString(), result:'incomplete', checks:{}, timings_ms:{}, cleanup:'not_needed'};
let stage='startup', ownedSession=null; const clients=[];
class CheckFailure extends Error { constructor(code) { super('Check failed'); this.code=code; } }
function check(ok,name) { if (!ok) throw new CheckFailure(name); }
function tokenFromDisk() {
  const text=readFileSync(join(hermesHome(),'.env'),'utf8');
  const entries=[...text.matchAll(/^\s*(?:export\s+)?HERMES_DASHBOARD_SESSION_TOKEN\s*=\s*(.*)$/gm)];
  check(entries.length===1,'credential'); let token=entries[0][1].trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token=token.slice(1,-1);
  check(token && !token.startsWith('file:'),'credential'); return token;
}
function durableFile(file,value) { const fd=openSync(file,'wx',0o600); try {writeSync(fd,JSON.stringify(value));fsyncSync(fd);} finally {closeSync(fd);} }
function checkpoint() { writeFileSync(join(ARTIFACT,RESULT_FILE),JSON.stringify(evidence,null,2),{mode:0o600}); }
async function timed(name,fn) { stage=name; const start=performance.now(); try{return await fn();}finally{evidence.timings_ms[name]=Math.round(performance.now()-start);checkpoint();} }
async function deadline(promise,ms,onTimeout=()=>{}) { let timer; try {return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{onTimeout();reject(new Error('timeout'));},ms);})]);} finally {clearTimeout(timer);} }
async function waitUntil(fn,ms) {const until=Date.now()+ms;while(Date.now()<until){const result=fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('turn timeout');}
function publicMetadata(input) { return Object.fromEntries(Object.entries(input).map(([k,v])=>[k,typeof v==='string' && /^[\w./:+-]{1,120}$/.test(v) ? v : null])); }
function makeClient(CanonicalClient,token,events) {
  const client=new CanonicalClient({baseUrl:ORIGIN,getToken:async()=>token,requestTimeoutMs:SCOPE.rpcTimeout,connectTimeoutMs:SCOPE.connectTimeout,
    onEvent:event=>{if(events.length<5000)events.push(event);},
    persistSubmission:async submission=>durableFile(join(ARTIFACT,`submission-${submission.submission_id}.json`),submission),
    acknowledgeSubmission:async (submission,receipt)=>durableFile(join(ARTIFACT,`receipt-${submission.submission_id}.json`),{submission_id:submission.submission_id,admission_id:typeof receipt?.admission_id==='string'?receipt.admission_id:null,status:typeof receipt?.status==='string'?receipt.status:null})});
  clients.push(client);return client;
}
async function turn(client,events,session,text) {
  const from=events.length, submission_id=randomUUID();
  const receipt=await deadline(client.submit({session_id:session,submission_id,text}),SCOPE.rpcTimeout*3,()=>client.close());
  check(typeof receipt?.admission_id==='string' && receipt.admission_id,'missing admission');
  const complete=await deadline(waitUntil(()=>completionFor(events,from,session,receipt),SCOPE.turnTimeout),SCOPE.turnTimeout+1000,()=>client.close());
  check(complete.payload?.status==='complete','turn failed'); return complete;
}
async function transcript(client,session) {
  const result=await client.request('session.transcript',{session_id:session,order:'latest',limit:50},SCOPE.rpcTimeout);
  check(Array.isArray(result?.rows),'transcript shape');return result.rows;
}
async function continuity(CanonicalClient,token,sttText) {
  check(sttText===SYNTHETIC_WORDS,'invalid transcript');
  const eventsA=[],a=makeClient(CanonicalClient,token,eventsA);await deadline(a.connect(),SCOPE.connectTimeout,()=>a.close());
  evidence.cleanup='creation_outcome_unknown'; checkpoint();
  const created=await a.createSession({title:`Hermes Mobile voice smoke ${randomUUID()}`});
  check(typeof created.session_id==='string' && created.session_id,'missing session');ownedSession=created.session_id;
  durableFile(join(ARTIFACT,`session-${randomUUID()}.json`),{session_id:ownedSession,created_at:new Date().toISOString()});
  const first=await a.openSession(ownedSession);check(first.session_id===ownedSession,'session mismatch');
  const fact=`SILVER_PEBBLE_${randomUUID().replaceAll('-','').toUpperCase()}`;
  const seed=`Without using any tools, remember the code ${fact}. Reply only READY now. On my next message, reply with that exact code and nothing else.`;
  const seedComplete=await turn(a,eventsA,ownedSession,seed);check(String(seedComplete.payload?.text??'').trim()==='READY','seed reply mismatch');
  const baseline=metadata(await a.refreshSession(ownedSession));
  a.close();
  const eventsB=[],b=makeClient(CanonicalClient,token,eventsB);await deadline(b.connect(),SCOPE.connectTimeout,()=>b.close());
  const resumed=await b.openSession(ownedSession);check(resumed.session_id===ownedSession,'session mismatch');
  const complete=await turn(b,eventsB,ownedSession,sttText);
  const after=metadata(await b.refreshSession(ownedSession));
  const rowsB=await transcript(b,ownedSession);
  const eventsC=[],c=makeClient(CanonicalClient,token,eventsC);await deadline(c.connect(),SCOPE.connectTimeout,()=>c.close());
  const viewer=await c.openSession(ownedSession);check(viewer.session_id===ownedSession,'viewer mismatch');
  const rowsC=await transcript(c,ownedSession);
  const rowB=userRows(rowsB,sttText),rowC=userRows(rowsC,sttText);
  evidence.checks.same_session=true;
  evidence.checks.seed_context_recalled=String(complete.payload?.text??'').trim()===fact;
  evidence.checks.one_transcribed_user_row=rowB.length===1;
  evidence.checks.second_viewer_one_user_row=rowC.length===1;
  evidence.checks.same_user_row_id=rowB.length===1&&rowC.length===1&&rowB[0].row_id!=null&&rowC[0].row_id!=null ? rowB[0].row_id===rowC[0].row_id : null;
  evidence.checks.seed_visible_to_viewer=userRows(rowsC,seed).length===1;
  evidence.metadata_before=publicMetadata(baseline);evidence.metadata_after=publicMetadata(after);evidence.metadata_unchanged=compareMetadata(baseline,after);
  check(evidence.checks.seed_context_recalled && evidence.checks.one_transcribed_user_row && evidence.checks.second_viewer_one_user_row && evidence.checks.same_user_row_id===true && evidence.checks.seed_visible_to_viewer,'continuity');
  check(!Object.values(evidence.metadata_unchanged).includes(false),'metadata changed');
  return c;
}
import { statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
function decodeAudio(bytes) {
  const result=spawnSync('ffmpeg',['-v','error','-i','pipe:0','-t','30','-ac','1','-ar','16000','-f','s16le','pipe:1'],{input:bytes,timeout:15000,maxBuffer:1024*1024,windowsHide:true});
  check(!result.error && result.status===0 && result.stdout?.length>=3200 && result.stdout.length<=960000,'audio decode');
  return {decoded_samples:result.stdout.length/2,decoded_seconds:result.stdout.length/32000};
}
async function post(path,body,token) {
  const response=await fetch(`${ORIGIN}${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(SCOPE.audioTimeout)});
  return response;
}
async function jsonBody(response,limit) { const bytes=await boundedBytes(response,limit);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
async function audioStages(token) {
  stage='fixture';
  const size=statSync(FIXTURE).size;check(size>44&&size<=2*1024*1024,'fixture size');
  const wav=readFileSync(FIXTURE);evidence.fixture_sha256=createHash('sha256').update(wav).digest('hex');check(wav.subarray(0,4).toString()==='RIFF'&&wav.subarray(8,12).toString()==='WAVE','fixture format');
  const inputDecode=decodeAudio(wav);evidence.checks.fixture={mime:'audio/wav',bytes:size,decoded_seconds:inputDecode.decoded_seconds};
  const transcribeBody={data_url:`data:audio/wav;base64,${wav.toString('base64')}`,mime_type:'audio/wav'};
  const speakBody=SPEAK_BODY;
  await timed('unauthenticated_routes',async()=>{
    for(const [path,body,key] of [['/api/audio/transcribe',transcribeBody,'transcribe'],['/api/audio/speak',speakBody,'speak']]){
      const response=await post(path,body,null);evidence.checks[`${key}_unauthenticated_status`]=response.status;await response.body?.cancel();check(response.status===401,'unauthenticated route');
    }
  });
  const transcribed=await timed('transcription',async()=>{
    const response=await post('/api/audio/transcribe',transcribeBody,token);evidence.checks.transcribe_status=response.status;check(response.ok,'transcription status');
    const json=await jsonBody(response,256*1024);
    evidence.checks.transcription_ok=json?.ok===true;
    evidence.checks.transcript_present=Object.prototype.hasOwnProperty.call(json ?? {},'transcript');
    evidence.checks.transcript_type=typeof json?.transcript;
    evidence.transcription_provider=publicMetadata({provider:json?.provider}).provider;
    Object.assign(evidence.checks,transcriptDiagnostic(json?.transcript));
    evidence.checks.number_rendering=numberRendering(json?.transcript);
    check(json?.ok===true,'transcription shape');const text=matchedTranscript(json.transcript);check(text,'transcription mismatch');
    evidence.checks.transcription_matches=true;return text;
  });
  await speechStage(token);
  return transcribed;
}
const SPEAK_BODY={text:'Hello. This is the Hermes Mobile audio smoke test.'};
async function speechStage(token) {
  const speakBody=SPEAK_BODY;
  await timed('speech',async()=>{
    const response=await post('/api/audio/speak',speakBody,token);evidence.checks.speak_status=response.status;check(response.ok,'speech status');
    const json=await jsonBody(response,Math.ceil(AUDIO_LIMIT*4/3)+4096);check(json?.ok===true&&typeof json.data_url==='string','speech shape');
    const mime=audioMime(json.mime_type);check(mime,'speech mime');
    const match=/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(json.data_url);check(match&&audioMime(match[1])===mime,'speech data');
    check(match[2].length%4===0,'speech base64');const bytes=Buffer.from(match[2],'base64');check(bytes.length>0&&bytes.length<=AUDIO_LIMIT&&bytes.toString('base64')===match[2],'speech size');
    const decoded=decodeAudio(bytes);const ext=({'audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/wave':'wav','audio/ogg':'ogg','audio/opus':'opus','audio/webm':'webm','audio/mp4':'m4a'})[mime];
    const filename=`reply-${randomUUID()}.${ext}`;durableFileBytes(join(ARTIFACT,filename),bytes);
    evidence.checks.speech={mime,bytes:bytes.length,decoded_seconds:decoded.decoded_seconds,fixture:filename};evidence.speech_provider=publicMetadata({provider:json.provider}).provider;
  });
}
async function speechOnly(token) {
  await timed('unauthenticated_speech',async()=>{
    const response=await post('/api/audio/speak',SPEAK_BODY,null);evidence.checks.speak_unauthenticated_status=response.status;await response.body?.cancel();check(response.status===401,'unauthenticated route');
  });
  await speechStage(token);
}
function durableFileBytes(file,bytes) { const fd=openSync(file,'wx',0o600);try{writeSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);} }
async function cleanup(CanonicalClient,token) {
  if (!ownedSession) return;
  evidence.cleanup='archive_pending';checkpoint();
  let client=clients.findLast(c=>c.connectionState==='ready'&&c.getSession(ownedSession));
  try {
    if (!client) {client=makeClient(CanonicalClient,token,[]);await deadline(client.connect(),SCOPE.connectTimeout,()=>client.close());await deadline(client.openSession(ownedSession),SCOPE.rpcTimeout,()=>client.close());}
    await deadline(client.mutate(ownedSession,'archive',{archived:true}),SCOPE.rpcTimeout,()=>client.close());evidence.cleanup='archived';
  } catch {evidence.cleanup='archive_failed';process.exitCode=1;}
}
async function main() {
  mkdirSync(ARTIFACT,{recursive:true});let token, CanonicalClient;
  try {
    check(MODE!=='invalid','invalid mode');
    stage='credentials';token=tokenFromDisk();
    let transcriptText;
    if (MODE==='speech') { await speechOnly(token); evidence.result='speech_passed'; }
    else if (MODE==='continuity') {
      stage='prior_audio_evidence';
      const size=statSync(FIXTURE).size;check(size>44&&size<=2*1024*1024,'fixture size');
      const hash=createHash('sha256').update(readFileSync(FIXTURE)).digest('hex');
      const previous=JSON.parse(readFileSync(join(ARTIFACT,'audio-result.json'),'utf8'));
      check(previous.result==='audio_passed' && previous.checks?.transcription_matches===true && previous.checks?.speech?.decoded_seconds>0 && previous.fixture_sha256===hash,'missing prior audio proof');
      evidence.fixture_sha256=hash;evidence.checks.audio_previously_passed=true;transcriptText=SYNTHETIC_WORDS;
    } else transcriptText=await audioStages(token);
    if (MODE==='audio') evidence.result='audio_passed';
    else if (MODE!=='speech') {
      stage='protocol_runtime';({CanonicalClient}=await import('../../.artifacts/protocol-runtime/index.js'));
      evidence.cleanup='creation_not_started';
      await timed('continuity',()=>continuity(CanonicalClient,token,transcriptText));
      if (evidence.metadata_unchanged.model!==true || evidence.metadata_unchanged.effort!==true) {evidence.result='partial';evidence.failed_stage='metadata_unverified';process.exitCode=1;}
      else evidence.result='passed';
    }
  } catch (error) {evidence.result='failed';evidence.failed_stage=stage;if(error instanceof CheckFailure)evidence.failed_check=error.code;process.exitCode=1;}
  finally {
    if (CanonicalClient && token) await cleanup(CanonicalClient,token);
    for (const client of clients) client.close();
    if(evidence.cleanup==='archive_failed')evidence.result='failed';
    evidence.finished_at=new Date().toISOString();checkpoint();
    console.log(JSON.stringify({result:evidence.result,failed_stage:evidence.failed_stage??null,cleanup:evidence.cleanup,evidence_file:`.artifacts/audio-smoke/${RESULT_FILE}`}));
  }
}
try { await main(); } catch { console.error('Audio smoke failed before sanitized evidence could be written.'); process.exitCode=1; }
