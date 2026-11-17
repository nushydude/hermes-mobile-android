import { gatewayOrigin, readDeploymentToken } from '../config.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createInterface } from 'node:readline/promises';
import { RpcError, mutateWithRetry, latestVersion, reconstructDeltas, armDisconnect, findCompletion, isDisconnectTrigger, findHandoffEvent, imageAnswerMatches } from './core.mjs';

// This deliberately records only shapes and selected non-sensitive protocol values.
// It never logs the session token, socket ticket, session titles or messages.
type Json = any;
const base = gatewayOrigin();
const token = readDeploymentToken();
const secrets = [token];
function shape(value: Json, depth = 0): Json {
  if (value === null) return 'null';
  if (Array.isArray(value)) return { type: 'array', count: value.length, item: value.length && depth < 5 ? shape(value[0], depth + 1) : undefined };
  if (typeof value !== 'object') return typeof value;
  if (depth >= 6) return 'object';
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shape(child, depth + 1)]));
}
function safe(value: string): string {
  for (const secret of secrets) value = value.split(secret).join('[REDACTED]');
  return value.replace(/hermes-gateway-ticket\.[^\s"']+/g, 'hermes-gateway-ticket.[REDACTED]')
    .replace(/([?&](?:token|ticket)=)[^\s&"']+/gi, '$1[REDACTED]');
}
const evidence: Json = { base, started_at: new Date().toISOString(), steps: [] };
function record(step: string, data: Json) {
  const result = { step, ...data };
  evidence.steps.push(result);
  console.log(safe(JSON.stringify(result)));
}
function timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })]).finally(() => clearTimeout(timer));
}

class Channel {
  ws: WebSocket;
  pending = new Map<number, {method: string, resolve: (x: Json) => void, reject: (e: Error) => void}>();
  next = 0;
  ready: Promise<Json>;
  heartbeat?: NodeJS.Timeout;
  events: Json[] = [];
  onEvent?: (event: Json) => void;
  constructor(ticket: string) {
    this.ws = new WebSocket(base.replace('https:', 'wss:') + '/api/ws', ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`]);
    this.ready = new Promise((resolve, reject) => {
      let resolved = false;
      this.ws.addEventListener('message', event => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.method === 'event' && msg.params?.type === 'gateway.ready' && !resolved) { resolved = true; resolve(msg); }
          else if (msg.method === 'event') {
            this.events.push(msg.params);
            if (process.argv.includes('--exercise') || process.argv.includes('--handoff')) record('event', {type:msg.params?.type, frame_shape:shape(msg.params)});
            if (msg.params?.session_id === testSessionId && ['message.delta','message.complete','session.info','approval.request','approval.settled'].includes(msg.params.type)) {
              const event = msg.params, payload = event.payload || {};
              record('test_event_sample',{frame:{type:event.type,session_id:event.session_id,seq:event.seq,replay_epoch:event.replay_epoch,authority_epoch:event.authority_epoch,execution_generation:event.execution_generation,admission_id:event.admission_id,payload:{segment:payload.segment,offset:payload.offset,text_length:typeof payload.text === 'string' ? payload.text.length : null,status:payload.status,revision:payload.revision}}});
            }
            if (msg.params?.session_id === testSessionId && ['session.updated','session.info'].includes(msg.params.type) && typeof msg.params.payload?.title === 'string') record('test_title_event',{type:msg.params.type,title:msg.params.payload.title});
            this.onEvent?.(msg.params);
          }
          else if (msg.method && msg.id !== undefined) {
            const method = String(msg.method);
            const isBridge = /^(preview\.|terminal\.read$|window\.read$|tour$|theme\.|vault\.|setup_beat$)/.test(method);
            this.ws.send(JSON.stringify({jsonrpc:'2.0', id:msg.id, error:{code:isBridge ? 4404 : -32601, message:'Unsupported by smoke client'}}));
            record('server_request', {method: isBridge ? 'desktop bridge' : 'unsupported', response_code: isBridge ? 4404 : -32601});
          } else if (msg.id !== undefined && this.pending.has(msg.id)) {
            const request = this.pending.get(msg.id)!; this.pending.delete(msg.id);
            if (msg.error) {
              const code = Number(msg.error.code) || 0;
              const message = safe(String(msg.error.message || 'Unknown error'));
              request.reject(new RpcError(request.method, code, message, msg.error.data));
            } else request.resolve(msg.result);
          }
        } catch { if (!resolved) reject(new Error('Invalid WebSocket frame')); }
      });
      this.ws.addEventListener('error', () => { if (!resolved) reject(new Error('WebSocket connection failed')); });
      this.ws.addEventListener('close', () => {
        if (!resolved) reject(new Error('WebSocket closed before gateway.ready'));
        for (const request of this.pending.values()) request.reject(new Error('WebSocket closed'));
        this.pending.clear();
      });
    });
  }
  async call(method: string, params: Json): Promise<Json> {
    if (this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
    const id = ++this.next;
    const response = new Promise<Json>((resolve, reject) => this.pending.set(id, {method, resolve, reject}));
    this.ws.send(JSON.stringify({jsonrpc:'2.0', id, method, params}));
    try { return await timeout(response, 30000, method); } finally { this.pending.delete(id); }
  }
  close() { if (this.heartbeat) clearInterval(this.heartbeat); this.ws.close(); }
}

let channel: Channel | undefined;
let testSessionId: string | undefined;
async function connect(): Promise<Channel> {
  const ticketResponse = await fetch(base + '/api/auth/ws-ticket', {method:'POST', headers:{Authorization:`Bearer ${token}`}, redirect:'error', signal:AbortSignal.timeout(15000)});
  if (!ticketResponse.ok) throw new Error(`Ticket endpoint returned HTTP ${ticketResponse.status}`);
  const minted: Json = await ticketResponse.json();
  if (typeof minted.ticket !== 'string' || !minted.ticket) throw new Error('Ticket endpoint did not return a ticket');
  secrets.push(minted.ticket);
  record('ticket', {status:ticketResponse.status, ttl_seconds:minted.ttl_seconds, response_shape:shape(minted)});
  const next = new Channel(minted.ticket);
  let ready: Json;
  try { ready = await timeout(next.ready, 30000, 'gateway.ready'); }
  catch (error) { next.close(); throw error; }
  record('gateway.ready', {frame_shape:shape({jsonrpc:ready.jsonrpc,method:ready.method,params:{type:ready.params?.type,payload:{...ready.params?.payload,skin:undefined}}}), session_authority:ready.params?.payload?.session_authority === true, heartbeat:ready.params?.payload?.heartbeat, selected_protocol:next.ws.protocol});
  if (ready.params?.payload?.session_authority !== true) { next.close(); throw new Error('Gateway lacks session authority'); }
  if (next.ws.protocol !== 'hermes-gateway-v1') { next.close(); throw new Error('Gateway selected an unexpected subprotocol'); }
  next.heartbeat = setInterval(() => { next.call('gateway.ping', {}).catch(() => {}); }, 15000);
  return next;
}
async function waitEvent(connection: Channel, sessionId: string, types: string[], from = 0, milliseconds = 120000, filter: (event:Json)=>boolean = () => true): Promise<Json> {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const event = connection.events.slice(from).find(e => e?.session_id === sessionId && types.includes(e?.type) && filter(e));
    if (event) return event;
    if (connection.ws.readyState !== WebSocket.OPEN) throw new Error('Socket closed waiting for event');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${types.join(' or ')}`);
}
function testPng(): string {
  // Deterministic 64×64 RGB image: left half solid red, right half solid blue.
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const byte of buf) { c ^= byte; for (let i=0;i<8;i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (name: string, data: Buffer) => { const kind=Buffer.from(name); const len=Buffer.alloc(4); len.writeUInt32BE(data.length); const sum=Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([kind,data]))); return Buffer.concat([len,kind,data,sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(64,0); header.writeUInt32BE(64,4); header[8]=8; header[9]=2;
  const raw = Buffer.alloc((64*3+1)*64);
  for (let y=0;y<64;y++) for (let x=0;x<64;x++) { const i=y*(64*3+1)+1+x*3; raw[i]=x<32?255:0; raw[i+2]=x<32?0:255; }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
try {
  channel = await connect();
  let stored: Json;
  for (const [method, params] of [
    ['client.capabilities', {server_requests:true}], ['runtime.describe', {}],
    ['session.list', {scope:'live',limit:100,picker:true}], ['session.list', {scope:'stored',limit:100,picker:true}],
  ] as [string, Json][]) {
    const result = await channel.call(method, params);
    const extra: Json = {method, params_shape:shape(params), result_shape:shape(result)};
    if (method === 'session.list') { extra.scope = params.scope; extra.rows = Array.isArray(result.sessions) ? result.sessions.length : null; }
    if (method === 'runtime.describe') { extra.session_create = result?.session_create; extra.capabilities = result?.capabilities; }
    if (method === 'session.list' && params.scope === 'stored') stored = result;
    record('rpc', extra);
  }
  if (process.argv.includes('--resume-desktop')) {
    const candidates = stored?.sessions?.filter((s: Json) => (s.source === 'gui' || s.source === 'desktop') && !s.running && s.message_count > 0) ?? [];
    const row = candidates.find((s: Json) => s.source === 'desktop') || candidates[0];
    if (!row) throw new Error('No nonempty idle desktop session found in first stored page');
    const snapshot = await channel.call('session.resume', {session_id:row.session_id || row.id, display_projection:true});
    record('resume_desktop', {source:row.source, running:snapshot.running, message_count:snapshot.message_count, result_shape:shape(snapshot)});
    await channel.call('session.detach', {session_id:snapshot.session_id, subscription_id:snapshot.subscription_id});
    record('detach_desktop', {success:true});
  }
  if (process.argv.includes('--handoff')) {
    const title = `Hermes Mobile handoff ${new Date().toISOString()}`;
    const created = await channel.call('session.create',{request_id:randomUUID(),source:'gui',title,client:{name:'hermes-mobile',version:'smoke-1'}});
    const sid = created.session_id;
    if (!sid) throw new Error('session.create returned no session_id');
    testSessionId = sid;
    const attached = await channel.call('session.resume',{session_id:sid,display_projection:true});
    record('handoff_ready',{session_id:sid,title,instructions:'Open this session in Hermes Desktop. Commands: send <text>, wait <marker>, wait-event <event> [prompt_id], pending, approve <choice>, quit'});
    const input = createInterface({input:process.stdin,output:process.stdout,terminal:false});
    let cursor = channel.events.length;
    try {
      for await (const line of input) {
        const [command,...words] = line.trim().split(/\s+/);
        const argument = words.join(' ');
        if (command === 'quit') break;
        if (command === 'send' && argument) {
          cursor = channel.events.length;
          const receipt = await channel.call('prompt.submit',{session_id:sid,submission_id:randomUUID(),text:argument});
          record('handoff_sent',{status:receipt.status});
        } else if (command === 'wait' && argument) {
          const until = Date.now()+120000;
          const find = () => findHandoffEvent(channel!.events,cursor,sid,(e:Json)=>JSON.stringify(e.payload).includes(argument));
          while (Date.now()<until && !find()) await new Promise(resolve=>setTimeout(resolve,100));
          const found = find();
          record('handoff_marker',{found:!!found,marker:argument});
          if (!found) throw new Error('Timed out waiting for marker');
          cursor = found.index + 1;
        } else if (command === 'wait-event' && argument) {
          const [eventType,promptId] = words;
          const until = Date.now()+120000;
          const find = () => findHandoffEvent(channel!.events,cursor,sid,(e:Json)=>e.type === eventType,promptId);
          while (Date.now()<until && !find()) await new Promise(resolve=>setTimeout(resolve,100));
          const found = find();
          if (!found) throw new Error('Timed out waiting for new handoff event');
          record('handoff_event_observed',{type:found.event.type,prompt_id:found.event.payload?.prompt_id,frame_shape:shape(found.event)});
          cursor = found.index + 1;
        } else if (command === 'pending') {
          const prompt = [...channel.events].reverse().find(e=>e.session_id === sid && ['approval.request','approval.settled','approval.cancelled'].includes(e.type));
          if (prompt?.type !== 'approval.request') { record('handoff_approval',{available:false}); continue; }
          record('handoff_approval',{available:!!prompt,prompt_id:prompt?.payload?.prompt_id,command:prompt?.payload?.command,choices:prompt?.payload?.choices});
        } else if (command === 'approve' && argument) {
          const prompt = [...channel.events].reverse().find(e=>e.session_id === sid && ['approval.request','approval.settled','approval.cancelled'].includes(e.type));
          if (prompt?.type !== 'approval.request' || !Array.isArray(prompt.payload?.choices) || !prompt.payload.choices.includes(argument)) throw new Error('Choice does not match an open approval request');
          const result = await channel.call('approval.respond',{session_id:sid,execution_generation:prompt.payload.execution_generation ?? prompt.execution_generation,prompt_id:prompt.payload.prompt_id,choice:argument});
          record('handoff_respond',{result_shape:shape(result)});
        } else record('handoff_command',{error:'Expected send <text>, wait <marker>, wait-event <event>, pending, approve <choice>, or quit'});
      }
    } finally {
      input.close();
      await channel.call('session.detach',{session_id:sid,subscription_id:attached.subscription_id});
    }
  }
  if (process.argv.includes('--exercise')) {
    // Operations below only mutate the fresh session created by this invocation.
    const created = await channel.call('session.create', {request_id:randomUUID(), source:'gui', client:{name:'hermes-mobile',version:'smoke-1'}});
    const sid = created.session_id;
    if (!sid) throw new Error('session.create returned no session_id');
    testSessionId = sid;
    record('create', {session_id:sid, title:created.info?.title, result_shape:shape(created)});
    let snapshot = await channel.call('session.resume', {session_id:sid, display_projection:true});
    record('resume_created', {result_shape:shape(snapshot), last_sequence:snapshot.last_sequence, revision:snapshot.revision});
    const receipt = await channel.call('prompt.submit', {session_id:sid, submission_id:randomUUID(), text:'Without using any tools, please reply with a numbered list of 100 different common colours or colour names. One per line.'});
    record('submit', {status:receipt.status,admission_id:receipt.admission_id,sequence:receipt.sequence,execution_generation:receipt.execution_generation,result_shape:shape(receipt)});
    if (channel.events.some(e => e.session_id === sid && e.type === 'message.complete')) throw new Error('Turn completed before mid-turn disconnect was armed');
    const start = channel.events.length;
    channel.onEvent = armDisconnect(channel, sid);
    const first = await waitEvent(channel, sid, ['message.delta','message.complete'], start, 120000, e => e.type === 'message.complete' || isDisconnectTrigger(e));
    if (first.type === 'message.complete') throw new Error('Turn completed before mid-turn reconnect could be exercised');
    if (channel.ws.readyState === WebSocket.OPEN) throw new Error('Socket did not close on a live delta');
    record('disconnect',{trigger:'nonempty message.delta',seq:first.seq,text_length:first.payload.text.length,socket_state:channel.ws.readyState});
    const beforeDisconnect = channel.events.slice();
    channel = await connect();
    await channel.call('client.capabilities', {server_requests:true});
    const replay = await channel.call('session.events.since', {session_id:sid,last_sequence:snapshot.last_sequence,replay_epoch:snapshot.replay_epoch});
    record('replay', {result_shape:shape(replay),snapshot_required:replay.snapshot_required,event_count:replay.events?.length});
    if (replay.snapshot_required || replay.truncated) throw new Error('Replay requested a fresh snapshot, cannot verify catch-up');
    const replayComplete = findCompletion(sid,replay.events || []);
    const afterReconnect = channel.events.length;
    snapshot = await channel.call('session.resume', {session_id:sid,display_projection:true});
    record('resume_after_replay', {running:snapshot.running,title:snapshot.info?.title,result_shape:shape(snapshot)});
    let complete = findCompletion(sid,replay.events || [],channel.events.slice(afterReconnect));
    if (!complete && snapshot.running) complete = await waitEvent(channel,sid,['message.complete'],afterReconnect);
    const finalReplay = await channel.call('session.events.since', {session_id:sid,last_sequence:0,replay_epoch:snapshot.replay_epoch});
    if (finalReplay.snapshot_required || finalReplay.truncated) throw new Error('Final replay requires snapshot');
    complete ||= findCompletion(sid,channel.events.slice(afterReconnect),finalReplay.events || []);
    if (!complete) throw new Error('Completion was not observed during resume or final replay');
    record('completion', {status:complete?.payload?.status});
    if (complete?.payload?.status !== 'complete') throw new Error('Prompt did not complete successfully');
    const reconstructed = reconstructDeltas([...beforeDisconnect,...replay.events,...channel.events,...finalReplay.events], sid);
    const finalText = typeof complete.payload?.text === 'string' ? complete.payload.text : '';
    record('delta_reconstruction',{characters:reconstructed.length,completion_characters:finalText.length, matches_completion:reconstructed === finalText});
    if (!reconstructed || reconstructed !== finalText) throw new Error('Replayed deltas do not reconstruct the completed response');
    const version = latestVersion(channel.events,sid,snapshot.revision,snapshot.execution_generation);
    const mutate = (params:Json) => mutateWithRetry(channel!.call.bind(channel),params,(fresh:Json) => record('mutation_retry',fresh));
    const renamedTitle = `Hermes Mobile smoke ${randomUUID()}`;
    let mutation = await mutate({session_id:sid,request_id:randomUUID(),expected_revision:version.revision,operation:'rename',payload:{title:renamedTitle}});
    record('rename',{result_shape:shape(mutation), revision:mutation.revision});
    mutation = await mutate({session_id:sid,request_id:randomUUID(),expected_revision:mutation.revision,operation:'archive',payload:{archived:true}});
    record('archive',{result_shape:shape(mutation),revision:mutation.revision});
    const fixture = Buffer.from(testPng(),'base64');
    const fixtureDigest = createHash('sha256').update(fixture).digest('hex');
    const fixtureName = `fixture-${randomUUID()}.png`;
    mkdirSync(join(import.meta.dirname,'runs'),{recursive:true});
    writeFileSync(join(import.meta.dirname,'runs',fixtureName),fixture,{mode:0o600});
    record('image_fixture',{width:64,height:64,left:'red',right:'blue',sha256:fixtureDigest,file:fixtureName});
    const upload = await fetch(base+'/api/chat/image-upload',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({filename:'smoke.png',data_url:'data:image/png;base64,'+fixture.toString('base64')}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if (!upload.ok) throw new Error(`Image upload returned HTTP ${upload.status}`);
    const image:Json = await upload.json();
    record('image_upload',{status:upload.status,result_shape:shape(image)});
    const imageStart = channel.events.length;
    const imageReceipt = await channel.call('prompt.submit',{session_id:sid,submission_id:randomUUID(),text:'Identify the color of each half of this image. Reply only with a JSON object containing exactly the keys "left" and "right", with each observed color as a lowercase string.',attachments:[{path:image.path,mime:image.mime_type}]});
    record('image_submit',{status:imageReceipt.status,result_shape:shape(imageReceipt)});
    const imageComplete = await waitEvent(channel,sid,['message.complete'],imageStart);
    const answer = typeof imageComplete.payload?.text === 'string' ? imageComplete.payload.text : '';
    const imageMatches = imageAnswerMatches(answer);
    record('image_completion',{status:imageComplete.payload?.status,answer:safe(answer),associations_match:imageMatches});
    if (imageComplete.payload?.status !== 'complete' || !imageMatches) throw new Error('Image response did not associate red with left and blue with right');
    await channel.call('session.detach',{session_id:sid,subscription_id:snapshot.subscription_id});
  }
  record('probe_complete', {success:true});
} catch (error) {
  record('failure', {message:safe(error instanceof Error ? error.message : 'Unknown error'), ...(error instanceof RpcError ? {rpc_data:error.data} : {})});
  process.exitCode = 1;
} finally {
  channel?.close();
  mkdirSync(join(import.meta.dirname, 'runs'), {recursive:true});
  const target = join(import.meta.dirname, 'runs', `probe-${Date.now()}.json`);
  writeFileSync(target, safe(JSON.stringify(evidence, null, 2)), {mode:0o600});
}
