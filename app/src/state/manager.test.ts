import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ saved: '', fail: false, clients: [] as any[], secure: new Map<string,string>(), failConnect: false, failReplace: false, rejectReplace: false, replacements: [] as any[], transcript: null as null | (() => Promise<any>), rejectSubmissionSession: '', listCalls: [] as any[], storedRows: [] as any[], blockWrite: null as null | (() => Promise<void>), writeHook: null as null | ((value:string) => Promise<void>), openHook: null as null | (() => Promise<void>), wire: [] as any[], rows: null as null | Map<string,string>, connectHook: null as null | ((client:any) => Promise<void>), secureHook: null as null | ((key:string,value:string) => Promise<void>), listHook: null as null | ((params:any) => Promise<any>), readHook: null as null | ((key:string) => Promise<void>), ackReceipt: {} as any, receiptResult: {} as any }));
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn() } }));
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: vi.fn() } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (k: string) => mocks.secure.get(k) ?? null, setItemAsync: async (k: string, v: string) => { if (mocks.secureHook) await mocks.secureHook(k,v); mocks.secure.set(k,v); }, deleteItemAsync: async (k: string) => { mocks.secure.delete(k); } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({ execAsync: async () => {}, getFirstAsync: async (_sql:string, key:string) => { if (mocks.readHook) await mocks.readHook(key); const value = mocks.rows ? mocks.rows.get(key) : mocks.saved; return value ? {value} : null; }, runAsync: async (_sql:string, _key:string, value:string) => { if (mocks.writeHook) await mocks.writeHook(value); if (mocks.blockWrite) { const block = mocks.blockWrite; mocks.blockWrite = null; await block(); } if (mocks.fail) throw Error('disk full'); mocks.saved=value; mocks.rows?.set(_key,value); } }) }));
vi.mock('@hermes-mobile/protocol', () => ({ randomUUID: () => crypto.randomUUID(), JsonRpcGatewayError: class extends Error {}, CanonicalClient: class {
  opts:any; connectionState = 'offline'; runtime = {}; submissions:any[] = [];
  constructor(opts:any) { this.opts=opts; mocks.clients.push(this); }
  async connect() { if (mocks.connectHook) await mocks.connectHook(this); if (mocks.failConnect) throw Error('dial failed'); this.connectionState='ready'; this.opts.onState?.('ready'); }
  async openSession(session_id:string) { if (mocks.openHook) await mocks.openHook(); return {session_id, execution_generation:1}; }
  async refreshSession(session_id:string) { return {session_id, execution_generation:1, prompts:[{prompt_id:'p', choices:['once','deny']}]}; }
  async request(method:string, params:any) { if (method === 'approval.respond') mocks.wire.push({method,params}); if (method === 'session.list') { mocks.listCalls.push(params); if (mocks.listHook) return mocks.listHook(params); return {sessions: params.scope === 'stored' ? mocks.storedRows : []}; } if (method === 'prompt.receipt') return mocks.receiptResult; if (method === 'session.transcript' && mocks.transcript) return mocks.transcript(); if (method === 'prompt.replace_queued') { mocks.wire.push({method,params}); mocks.replacements.push(params); if (mocks.rejectReplace) { const { JsonRpcGatewayError } = await import('@hermes-mobile/protocol'); throw new JsonRpcGatewayError('rejected', {code:4001}); } if (mocks.failReplace) throw Error('lost response'); } return {}; }
  async submit(item:any) { mocks.wire.push({method:'prompt.submit',params:item}); this.submissions.push(item); await this.opts.persistSubmission(item); if (mocks.rejectSubmissionSession === item.session_id) { const { JsonRpcGatewayError } = await import('@hermes-mobile/protocol'); throw new JsonRpcGatewayError('rejected', {code:4001}); } await this.opts.acknowledgeSubmission(item, mocks.ackReceipt); }
  async detachSession() {} close() {} reconnectNow() {} getSession() { return {execution_generation:1}; }
} }));
vi.mock('../notifications', () => ({ notifyEvent: vi.fn(async () => {}), reconcileSnapshot: vi.fn(async () => {}) }));
import { AppManager } from './index';
import { conversationDiagnostics } from './conversationDiagnostics';

describe('conversation mode mutation',()=>{
  it('keeps a send behind the atomic mode mutation while preserving the draft',async()=>{
    mocks.secure.set('hermes.baseUrl','https://example.test');mocks.secure.set('hermes.token','secret');
    const manager=new AppManager();await manager.initialize();await flush();const client=mocks.clients[0];
    let release!:(value:any)=>void;const blocked=new Promise<any>(resolve=>{release=resolve;});let payload:any;
    client.mutate=vi.fn(async (_session:string,_operation:string,value:any)=>{payload=value;return blocked;});
    manager.setDraft('s','keep this draft');
    const changing=manager.setConversationMode('s',{model:'gpt-6-luna',provider:'openai-codex',reasoning:'none'});await flush();
    const sending=manager.send('s','other message',undefined,{preserveDraft:true});await flush();
    expect(manager.getState().outbox).toHaveLength(0);expect(manager.getState().drafts.s).toBe('keep this draft');
    expect(payload).toEqual({model:'gpt-6-luna',provider:'openai-codex',reasoning:'none'});
    release({status:'deferred'});expect(await changing).toEqual({status:'deferred'});await sending;
    expect(manager.getState().drafts.s).toBe('keep this draft');manager.dispose();
  });
  it('returns confirmation and propagates failure without changing drafts',async()=>{
    mocks.secure.set('hermes.baseUrl','https://example.test');mocks.secure.set('hermes.token','secret');
    const manager=new AppManager();await manager.initialize();await flush();const client=mocks.clients[0];manager.setDraft('s','saved');
    client.mutate=vi.fn(async()=>({status:'confirmation_required',confirm:'token'}));
    const payload={model:'gpt-6.1-sol',provider:'openai-codex',reasoning:'medium'};
    expect(await manager.setConversationMode('s',payload)).toEqual({status:'confirmation_required',confirm:'token'});
    client.mutate=vi.fn(async()=>{throw new Error('rejected');});await expect(manager.setConversationMode('s',payload)).rejects.toThrow('rejected');
    expect(manager.getState().drafts.s).toBe('saved');manager.dispose();
  });
  it('rejects a late mutation result after the manager is disposed',async()=>{
    mocks.secure.set('hermes.baseUrl','https://example.test');mocks.secure.set('hermes.token','secret');
    const manager=new AppManager();await manager.initialize();await flush();const client=mocks.clients[0];
    let release!:(value:any)=>void;client.mutate=vi.fn(()=>new Promise(resolve=>{release=resolve;}));
    const changing=manager.setConversationMode('s',{model:'gpt-6-luna',provider:'openai-codex',reasoning:'none'});await flush();
    manager.dispose();release({status:'applied'});await expect(changing).rejects.toThrow('Gateway changed');
  });
  it('does not overtake a saved message awaiting gateway admission',async()=>{
    mocks.secure.set('hermes.baseUrl','https://example.test');mocks.secure.set('hermes.token','secret');
    const manager=new AppManager();await manager.initialize();await flush();const client=mocks.clients[0];
    let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});const submit=client.submit.bind(client);
    client.submit=vi.fn(async(item:any)=>{await blocked;return submit(item);});client.mutate=vi.fn(async()=>({status:'applied'}));
    manager.setDraft('s','keep draft');await manager.send('s','waiting',undefined,{preserveDraft:true});await flush();
    expect(manager.getState().outbox).toHaveLength(1);
    await expect(manager.setConversationMode('s',{model:'gpt-6-luna',provider:'openai-codex',reasoning:'none'})).rejects.toThrow('pending messages');
    expect(client.mutate).not.toHaveBeenCalled();expect(manager.getState().drafts.s).toBe('keep draft');
    release();await flush();expect(manager.getState().outbox).toHaveLength(0);manager.dispose();
  });
});
const cachePayload = (value: string) => { const parsed = JSON.parse(value); return parsed.payload ?? parsed; };
const flush = async () => { for (let n=0;n<10;n++) await new Promise(r => setTimeout(r,0)); };
beforeEach(() => { mocks.saved=''; mocks.fail=false; mocks.clients=[]; mocks.secure.clear(); mocks.failConnect=false; mocks.failReplace=false; mocks.rejectReplace=false; mocks.replacements=[]; mocks.transcript=null; mocks.rejectSubmissionSession=''; mocks.listCalls=[]; mocks.storedRows=[]; mocks.blockWrite=null; mocks.writeHook=null; mocks.openHook=null; mocks.wire=[]; mocks.rows=null; mocks.connectHook=null; mocks.secureHook=null; mocks.listHook=null; mocks.readHook=null; mocks.ackReceipt={}; mocks.receiptResult={}; });
describe('durable outbox', () => {
  it('survives restart offline, retries the same ID, and removes it on receipt', async () => {
    const first = new AppManager(); await first.initialize(); first.setDraft('s','hello'); await first.send('s');
    const stored = cachePayload(mocks.saved); expect(stored.outbox).toHaveLength(1); const submissionId=stored.outbox[0].submission_id; expect(stored.drafts.s).toBe('');
    mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
    const second = new AppManager(); await second.initialize(); await flush();
    expect(mocks.clients[0].submissions[0].submission_id).toBe(submissionId); expect(second.getState().outbox).toHaveLength(0);
  });
  it('does not transmit when persisting the submission fails', async () => {
    const manager = new AppManager(); await manager.initialize(); mocks.fail=true;
    await expect(manager.send('s','unsaved')).rejects.toThrow('disk full'); expect(mocks.clients).toHaveLength(0); expect(manager.getState().outbox).toHaveLength(0); expect(manager.getState().drafts.s).toBe('unsaved');
  });
});

describe('connection lifecycle', () => {
  it('initializes once and cancels an open secret request when withdrawn', async () => {
    mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
    const manager = new AppManager(); await Promise.all([manager.initialize(), manager.initialize()]); await flush();
    expect(mocks.clients).toHaveLength(1);
    const controller = new AbortController();
    const answer = mocks.clients[0].opts.requestSecret('sudo', {prompt:'Password'}, controller.signal);
    expect(manager.getState().secureRequest?.method).toBe('sudo');
    controller.abort(); await expect(answer).rejects.toThrow('cancelled'); expect(manager.getState().secureRequest).toBeNull(); manager.dispose();
  });
  it('batches stream deltas and tracks a complete turn', async () => {
    mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
    const manager = new AppManager(); await manager.initialize(); await flush(); const client = mocks.clients[0];
    client.opts.onEvent({type:'message.start',session_id:'s',payload:{}});
    client.opts.onEvent({type:'message.delta',session_id:'s',payload:{text:'Hello'}});
    expect(manager.getState().chats.s).toBeUndefined(); await new Promise(r => setTimeout(r,70));
    expect(manager.getState().chats.s.liveText).toBe('Hello'); manager.dispose();
  });
});


describe('repair: setup and queued edits', () => {
  it('keeps existing credentials and cached draft when authority dial fails', async () => {
    mocks.secure.set('hermes.baseUrl','https://old.test'); mocks.secure.set('hermes.token','old-token');
    const manager = new AppManager(); await manager.initialize(); await flush(); manager.setDraft('s','saved draft');
    vi.stubGlobal('fetch', async () => ({ok:true})); mocks.failConnect=true;
    await expect(manager.configure({baseUrl:'https://new.test',token:'new-token'})).rejects.toThrow('dial failed');
    expect(JSON.parse(mocks.secure.get('hermes.config.v1')!)).toMatchObject({origin:'https://old.test',token:'old-token'}); expect(manager.getState().drafts.s).toBe('saved draft');
    manager.dispose(); vi.unstubAllGlobals();
  });
  it('persists replacement before sending and retries the same ID after restart', async () => {
    const first = new AppManager(); await first.initialize(); await first.replaceQueued('s','a','edited');
    const saved = cachePayload(mocks.saved).queuedEdits[0]; expect(saved.text).toBe('edited');
    mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
    mocks.failReplace=true; const second = new AppManager(); await second.initialize(); await flush(); expect(mocks.replacements[0].submission_id).toBe(saved.submission_id); expect(second.getState().queuedEdits).toHaveLength(1); second.dispose();
    mocks.failReplace=false; const third = new AppManager(); await third.initialize(); await flush(); expect(mocks.replacements.at(-1).submission_id).toBe(saved.submission_id); expect(third.getState().queuedEdits).toHaveLength(0); third.dispose();
  });
});

it('marks definitive replacement rejection for recovery without blocking later edits', async () => {
  const offline = new AppManager(); await offline.initialize(); await offline.replaceQueued('s','a','first'); await offline.replaceQueued('s','b','second');
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret'); mocks.rejectReplace=true;
  const online = new AppManager(); await online.initialize(); await flush();
  expect(mocks.replacements).toHaveLength(2); expect(online.getState().queuedEdits.every(edit => !!edit.error)).toBe(true);
  const first = online.getState().queuedEdits[0]; await online.discardQueuedEdit(first.submission_id); expect(online.getState().queuedEdits).toHaveLength(1); online.dispose();
});



it('older transcript preserves concurrent live delta and settled approval, retaining identical distinct rows', async () => {
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
  const manager = new AppManager(); await manager.initialize(); await flush(); const client = mocks.clients[0];
  client.opts.onSnapshot('s',{session_id:'s',replay_epoch:'e',last_sequence:0,execution_generation:1,messages:[{row_id:2,role:'user',text:'continue'}],prompts:[{prompt_id:'p'}],running:true},'resume');
  let resolve!: (v:any) => void; mocks.transcript = () => new Promise(r => { resolve=r; });
  const loading = manager.loadEarlier('s');
  client.opts.onEvent({type:'message.delta',session_id:'s',replay_epoch:'e',seq:1,payload:{text:'stream'}});
  client.opts.onEvent({type:'approval.settled',session_id:'s',replay_epoch:'e',seq:2,payload:{prompt_id:'p'}});
  await new Promise(r => setTimeout(r,70)); resolve({rows:[{row_id:1,role:'user',text:'continue'}],next_cursor:null}); await loading;
  expect(manager.getState().chats.s.liveText).toBe('stream'); expect(manager.getState().chats.s.prompts).toEqual([]); expect(manager.getState().chats.s.messages).toHaveLength(2); manager.dispose();
});
it('snapshot supersedes replayed prompt state and ignores covered held frames while preserving active text', async () => {
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
  const manager = new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0];
  const snap={session_id:'s',replay_epoch:'e',last_sequence:0,execution_generation:1,messages:[],prompts:[],running:true};
  client.opts.onSnapshot('s',snap,'resume');
  client.opts.onEvent({type:'approval.request',session_id:'s',replay_epoch:'e',seq:1,payload:{prompt_id:'p'}});
  client.opts.onEvent({type:'message.delta',session_id:'s',replay_epoch:'e',seq:2,payload:{text:'partial'}});
  client.opts.onEvent({type:'approval.settled',session_id:'s',replay_epoch:'e',seq:3,payload:{prompt_id:'p'}});
  client.opts.onSnapshot('s',{...snap,last_sequence:3},'resume');
  client.opts.onEvent({type:'approval.request',session_id:'s',replay_epoch:'e',seq:1,payload:{prompt_id:'p'}});
  await new Promise(r => setTimeout(r,70)); expect(manager.getState().chats.s.prompts).toEqual([]); expect(manager.getState().chats.s.liveText).toBe('partial'); manager.dispose();
});


it('definitive rejection keeps one message recoverable while later sessions send and retry uses same ID', async () => {
  const offline = new AppManager(); await offline.initialize(); await offline.send('bad','first'); await offline.send('good','second');
  const firstId = offline.getState().outbox[0].submission_id;
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret'); mocks.rejectSubmissionSession='bad';
  const online = new AppManager(); await online.initialize(); await flush();
  expect(online.getState().outbox).toHaveLength(1); expect(online.getState().outbox[0].submission_id).toBe(firstId); expect(online.getState().outbox[0].error).toBeTruthy();
  expect(mocks.clients[0].submissions.map((x:any) => x.session_id)).toEqual(['bad','good']);
  mocks.rejectSubmissionSession=''; await online.retryOutbox(firstId); await flush();
  expect(mocks.clients[0].submissions.at(-1).submission_id).toBe(firstId); expect(online.getState().outbox).toHaveLength(0); online.dispose();
});


it('offline user turn survives durable acceptance and retires only when its committed row appears', async () => {
  const offline = new AppManager(); await offline.initialize(); await offline.send('s','hello');
  const local=offline.getState().chats.s.localMessages[0]; expect(local.text).toBe('hello'); expect(local.status).toBe('pending');
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
  const online = new AppManager(); await online.initialize(); await flush(); const client=mocks.clients[0];
  expect(online.getState().outbox).toHaveLength(0); expect(online.getState().chats.s.localMessages[0].status).toBe('accepted');
  mocks.transcript = async () => ({rows:[{role:'user',text:'hello',row_id:123}],next_cursor:null});
  client.opts.onEvent({type:'message.complete',session_id:'s',payload:{text:'done',persisted_turn:{submission_id:local.submission_id,user_row_id:123}}});
  await flush(); expect(online.getState().chats.s.localMessages).toHaveLength(0); expect(online.getState().chats.s.messages.some((x:any)=>x.row_id===123)).toBe(true); online.dispose();
});
it('requests maximum inventory and exposes possible truncation', async () => {
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret'); mocks.storedRows=Array.from({length:200},(_,i)=>({id:String(i)}));
  const manager=new AppManager(); await manager.initialize(); await flush(); expect(manager.getState().historyTruncated).toBe(true); expect(mocks.listCalls.find(x=>x.scope==='stored').limit).toBe(200); await manager.findByTitle('Exact'); expect(mocks.listCalls.at(-1)).toEqual({title:'Exact'}); manager.dispose();
});

it('does not clear newly typed draft after delayed action or sending different text', async () => {
  const manager = new AppManager(); await manager.initialize(); manager.setDraft('s','newer text');
  manager.replaceDraftIfUnchanged('s','old captured text',''); expect(manager.getState().drafts.s).toBe('newer text');
  await manager.send('s','expanded command'); expect(manager.getState().drafts.s).toBe('newer text');
  manager.replaceDraftIfUnchanged('s','newer text','replacement'); expect(manager.getState().drafts.s).toBe('replacement'); manager.dispose();
});


it('failed discard rollback retains concurrent outbox send in memory and storage', async () => {
  const manager=new AppManager(); await manager.initialize(); await manager.send('s','first'); const firstId=manager.getState().outbox[0].submission_id;
  let reject!: (e:Error)=>void; mocks.blockWrite=()=>new Promise((_resolve,r)=>{reject=r;});
  const discarding=manager.discardOutbox(firstId); await flush(); const sending=manager.send('s','second');
  reject(Error('disk full')); await expect(discarding).rejects.toThrow('disk full'); await sending;
  expect(manager.getState().outbox.map(x=>x.text)).toEqual(['first','second']); expect(cachePayload(mocks.saved).outbox.map((x:any)=>x.text)).toEqual(['first','second']); manager.dispose();
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret'); const online=new AppManager(); await online.initialize(); await flush(); expect(mocks.clients[0].submissions.map((x:any)=>x.text)).toEqual(['first','second']); online.dispose();
});
it('failed retry rollback retains concurrent queued edit in memory and storage', async () => {
  const manager=new AppManager(); await manager.initialize(); await manager.replaceQueued('s','a','first'); const id=manager.getState().queuedEdits[0].submission_id;
  let reject!: (e:Error)=>void; mocks.blockWrite=()=>new Promise((_resolve,r)=>{reject=r;});
  const retrying=manager.retryQueuedEdit(id); await flush(); const adding=manager.replaceQueued('s','b','second'); reject(Error('disk full'));
  await expect(retrying).rejects.toThrow('disk full'); await adding;
  expect(manager.getState().queuedEdits.map(x=>x.text).sort()).toEqual(['first','second']); expect(cachePayload(mocks.saved).queuedEdits.map((x:any)=>x.text).sort()).toEqual(['first','second']); manager.dispose();
});
it('failed send save does not overwrite a draft typed while the write was pending', async () => {
  const manager=new AppManager(); await manager.initialize(); manager.setDraft('s','old'); await flush();
  let reject!: (e:Error)=>void; mocks.blockWrite=()=>new Promise((_resolve,r)=>{reject=r;});
  const sending=manager.send('s'); await flush(); manager.setDraft('s','new'); reject(Error('disk full'));
  await expect(sending).rejects.toThrow('disk full'); expect(manager.getState().drafts.s).toBe('new'); expect(cachePayload(mocks.saved).drafts.s).toBe('new'); manager.dispose();
});

it('failed queued edit discard restores its original position before newer edits', async () => {
  const manager=new AppManager(); await manager.initialize(); await manager.replaceQueued('s','a','first'); const id=manager.getState().queuedEdits[0].submission_id;
  let reject!: (e:Error)=>void; mocks.blockWrite=()=>new Promise((_resolve,r)=>{reject=r;});
  const discard=manager.discardQueuedEdit(id); await flush(); const add=manager.replaceQueued('s','b','second'); reject(Error('disk full'));
  await expect(discard).rejects.toThrow('disk full'); await add;
  expect(manager.getState().queuedEdits.map(x=>x.text)).toEqual(['first','second']); expect(cachePayload(mocks.saved).queuedEdits.map((x:any)=>x.text)).toEqual(['first','second']); manager.dispose();
});


it('overlapping failed discards preserve actual online FIFO and exact submit keys', async () => {
  const offline=new AppManager(); await offline.initialize(); await offline.send('s','A'); await offline.send('s','B');
  const ids=offline.getState().outbox.map(x=>x.submission_id); offline.dispose();
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
  let releaseOpen!:()=>void; mocks.openHook=()=>new Promise(r=>{releaseOpen=r;});
  const manager=new AppManager(); await manager.initialize(); await flush();
  let rejectA!:(e:Error)=>void, rejectB!:(e:Error)=>void; let first=true, second=true;
  mocks.writeHook=async value=>{ const texts=cachePayload(value).outbox.map((x:any)=>x.text); if(first && !texts.includes('A')) {first=false; await new Promise((_r,j)=>{rejectA=j;});} else if(second && texts.includes('A') && !texts.includes('B')) {second=false; await new Promise((_r,j)=>{rejectB=j;});} };
  const a=manager.discardOutbox(ids[0]); const b=manager.discardOutbox(ids[1]); const c=manager.send('s','C'); await flush(); releaseOpen(); await flush(); expect(mocks.wire).toHaveLength(0);
  rejectA(Error('disk full')); await expect(a).rejects.toThrow(); await flush(); expect(mocks.wire).toHaveLength(0); rejectB(Error('disk full')); await expect(b).rejects.toThrow(); await c;
  mocks.writeHook=null; mocks.openHook=null; await flush();
  expect(mocks.wire.map(x=>x.params.text)).toEqual(['A','B','C']); for(const call of mocks.wire) expect(Object.keys(call.params).sort()).toEqual(['session_id','submission_id','text']); manager.dispose();
});
it('merged queue sends earlier queued edit before later prompt with exact wire keys', async () => {
  const offline=new AppManager(); await offline.initialize(); await offline.replaceQueued('s','admission','edited'); await offline.send('s','later'); offline.dispose();
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret'); const manager=new AppManager(); await manager.initialize(); await flush();
  expect(mocks.wire.map(x=>x.method)).toEqual(['prompt.replace_queued','prompt.submit']); expect(Object.keys(mocks.wire[0].params).sort()).toEqual(['admission_id','session_id','submission_id','text']); expect(Object.keys(mocks.wire[1].params).sort()).toEqual(['session_id','submission_id','text']); manager.dispose();
});
it('legacy queues migrate to stable persisted ordinals preserving prior effective order', async () => {
  mocks.saved=JSON.stringify({outbox:[{session_id:'s',submission_id:'a',text:'first'}],queuedEdits:[{session_id:'s',admission_id:'q',submission_id:'b',text:'second'}],chats:{},drafts:{},sessions:[]});
  const manager=new AppManager(); await manager.initialize(); const cache=cachePayload(mocks.saved); expect(cache.outbox[0].enqueue_order).toBeLessThan(cache.queuedEdits[0].enqueue_order); expect(cache.nextOrdinal).toBeGreaterThan(cache.queuedEdits[0].enqueue_order); manager.dispose();
});
it('ack persistence failure restores same ordered item for idempotent retry', async () => {
  const offline=new AppManager(); await offline.initialize(); await offline.send('s','first'); await offline.send('s','second'); const first=offline.getState().outbox[0]; offline.dispose();
  let rejected=false; mocks.writeHook=async value=>{ if(!rejected && cachePayload(value).outbox.length===1) {rejected=true; throw Error('disk full');} };
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret'); const manager=new AppManager(); await manager.initialize(); await flush();
  expect(manager.getState().outbox.map(x=>x.text)).toEqual(['first','second']); expect(manager.getState().outbox[0].enqueue_order).toBe(first.enqueue_order);
  mocks.writeHook=null; manager.dispose(); const restarted=new AppManager(); await restarted.initialize(); await flush(); expect(mocks.wire.filter(x=>x.params.submission_id===first.submission_id)).toHaveLength(2); expect(mocks.wire.at(-1).params.text).toBe('second'); restarted.dispose();
});

it('reselects after open and never dispatches an item discarded during that await', async () => {
  const offline=new AppManager(); await offline.initialize(); await offline.send('s','discard'); await offline.send('s','keep'); const id=offline.getState().outbox[0].submission_id; offline.dispose();
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret'); let release!:()=>void; let first=true;
  mocks.openHook=()=> first ? (first=false, new Promise<void>(r=>{release=r;})) : Promise.resolve();
  const manager=new AppManager(); await manager.initialize(); await flush(); await manager.discardOutbox(id); release(); await flush();
  expect(mocks.wire.map(x=>x.params.text)).toEqual(['keep']); manager.dispose();
});
it('failed queued edit enqueue cannot be resurrected by a later successful enqueue', async () => {
  const manager=new AppManager(); await manager.initialize(); let reject!:(e:Error)=>void; mocks.blockWrite=()=>new Promise((_r,j)=>{reject=j;});
  const a=manager.replaceQueued('s','a','failed'); await flush(); const b=manager.replaceQueued('s','b','saved'); reject(Error('disk full')); await expect(a).rejects.toThrow(); await b;
  expect(manager.getState().queuedEdits.map(x=>x.text)).toEqual(['saved']); expect(cachePayload(mocks.saved).queuedEdits.map((x:any)=>x.text)).toEqual(['saved']); manager.dispose();
});
it('post-open barrier waits for mutations queued while an earlier mutation is pending', async () => {
  const offline=new AppManager(); await offline.initialize(); await offline.send('s','A'); await offline.send('s','B'); const ids=offline.getState().outbox.map(x=>x.submission_id); offline.dispose();
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret'); let releaseOpen!:()=>void; let first=true;
  mocks.openHook=()=>first ? (first=false,new Promise<void>(r=>{releaseOpen=r;})) : Promise.resolve();
  const manager=new AppManager(); await manager.initialize(); await flush(); let releaseWrite!:()=>void;
  mocks.blockWrite=()=>new Promise<void>(r=>{releaseWrite=r;}); const firstDiscard=manager.discardOutbox(ids[1]); await flush(); releaseOpen(); await flush();
  const secondDiscard=manager.discardOutbox(ids[0]); releaseWrite(); await Promise.all([firstDiscard,secondDiscard]); await flush();
  expect(mocks.wire).toHaveLength(0); manager.dispose();
});


it('keeps client credentials bound and refuses switching after a draft appears during candidate validation', async () => {
  mocks.rows = new Map(); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture-a');
  const manager = new AppManager(); await manager.initialize(); await flush(); const old = mocks.clients[0];
  let release!:()=>void; mocks.connectHook = client => client === old ? Promise.resolve() : new Promise<void>(r => { release=r; });
  vi.stubGlobal('fetch', async () => ({ok:true})); const switching = manager.configure({baseUrl:'https://b.test',token:'fixture-b'}); await flush();
  manager.setDraft('s','keep this'); release(); await expect(switching).rejects.toThrow('Resolve drafts');
  expect(await old.opts.getToken()).toBe('fixture-a'); expect(manager.getState().drafts.s).toBe('keep this');
  expect(JSON.parse(mocks.secure.get('hermes.config.v1')!).origin).toBe('https://a.test'); manager.dispose(); vi.unstubAllGlobals();
});
it('rejects an already aborted secret without superseding an existing request', async () => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager = new AppManager(); await manager.initialize(); await flush();
  const client=mocks.clients[0], first=new AbortController(), cancelled=new AbortController(); const pending=client.opts.requestSecret('sudo',{prompt:'first'},first.signal); cancelled.abort();
  await expect(client.opts.requestSecret('secret',{},cancelled.signal)).rejects.toThrow('cancelled'); expect(manager.getState().secureRequest?.params.prompt).toBe('first'); manager.answerSecret(manager.getState().secureRequest!, 'answer'); await expect(pending).resolves.toBe('answer'); manager.dispose();
});
it('ignores an older transcript response after a newer completion', async () => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager = new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0];
  const waiting:Array<(v:any)=>void>=[]; mocks.transcript=()=>new Promise(r=>waiting.push(r));
  client.opts.onEvent({type:'message.complete',session_id:'s',payload:{}}); client.opts.onEvent({type:'message.complete',session_id:'s',payload:{}});
  waiting[1]({rows:[{row_id:1},{row_id:2}]}); await flush(); waiting[0]({rows:[{row_id:1}]}); await flush();
  expect(manager.getState().chats.s.messages).toEqual([{row_id:1},{row_id:2}]); manager.dispose();
});
it('does not fall back to legacy credentials when the new envelope is malformed', async () => {
  mocks.secure.set('hermes.config.v1','invalid'); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture');
  const manager = new AppManager(); await manager.initialize(); expect(mocks.clients).toHaveLength(0); expect(manager.getState().credentialsConfigured).toBe(false); manager.dispose();
});

it('persists a draft typed for the old gateway during the credential commit', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture-a'); const manager=new AppManager(); await manager.initialize(); await flush();
  let release!:()=>void; mocks.secureHook = async (key,value) => { if (key === 'hermes.config.v1' && JSON.parse(value).origin === 'https://b.test') await new Promise<void>(r=>{release=r;}); };
  vi.stubGlobal('fetch',async()=>({ok:true})); const switching=manager.configure({baseUrl:'https://b.test',token:'fixture-b'}); await flush(); manager.setDraft('old-session','typed during commit'); release(); await switching;
  expect(cachePayload(mocks.rows.get('state:https://a.test')!).drafts['old-session']).toBe('typed during commit'); expect(manager.getState().drafts['old-session']).toBeUndefined(); manager.dispose(); vi.unstubAllGlobals();
});

it('late alias resolution preserves the newer selection and moves an unconflicted draft', async () => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0];
  let release!:(v:any)=>void; client.openSession=(session_id:string)=>session_id==='alias' ? new Promise(r=>{release=r;}) : Promise.resolve({session_id});
  manager.setDraft('alias','unfinished'); const first=manager.openSession('alias'); await flush(); await manager.openSession('later'); release({session_id:'owner'}); await first;
  expect(manager.getState().activeSessionId).toBe('later'); expect(manager.getState().drafts.owner).toBe('unfinished'); manager.dispose();
});
it('snapshot invalidates a history cursor whose rows were replaced', async () => {
  const {emptyChat,snapshotChat}=await import('./reducer'); const chat={...emptyChat(),cursor:'old-cursor',messages:[{row_id:1},{row_id:2}]};
  expect(snapshotChat({session_id:'s',messages:[{row_id:2}]} as any,chat).cursor).toBeNull();
});
it('resets transcript history when the server rejects a paging cursor', async () => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0];
  client.opts.onSnapshot('s',{session_id:'s',replay_epoch:'e',last_sequence:0,execution_generation:1,messages:[{row_id:1}],running:false},'resume');
  mocks.transcript=async()=>({rows:[{row_id:9}],next_cursor:'fresh',reset:true}); await manager.loadEarlier('s');
  expect(manager.getState().chats.s.messages).toEqual([{row_id:9}]); expect(manager.getState().chats.s.cursor).toBe('fresh'); manager.dispose();
});

it('binds a first-setup draft typed while credentials are committing', async () => {
  mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize(); let release!:()=>void;
  mocks.secureHook=async key=>{if(key==='hermes.config.v1') await new Promise<void>(r=>{release=r;});}; vi.stubGlobal('fetch',async()=>({ok:true}));
  const setup=manager.configure({baseUrl:'https://a.test',token:'fixture'}); await flush(); manager.setDraft('s','late first draft'); release(); await setup;
  expect(cachePayload(mocks.rows.get('state:https://a.test')!).drafts.s).toBe('late first draft'); manager.dispose(); vi.unstubAllGlobals();
});

it('refuses a cross-gateway switch when an offline A submission is queued during B authentication', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture-a'); const manager=new AppManager(); await manager.initialize(); await flush(); const old=mocks.clients[0]; old.opts.onState('offline');
  let release!:()=>void; vi.stubGlobal('fetch',()=>new Promise(r=>{release=()=>r({ok:true} as Response);})); const switching=manager.configure({baseUrl:'https://b.test',token:'fixture-b'}); await flush();
  await manager.send('a-session','A only'); release(); await expect(switching).rejects.toThrow('Resolve drafts'); expect(manager.getState().outbox[0].text).toBe('A only'); expect(mocks.wire).toEqual([]); expect(await old.opts.getToken()).toBe('fixture-a'); manager.dispose(); vi.unstubAllGlobals();
});
it('ignores late old inventory and acknowledgement after a gateway switch', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture-a'); const manager=new AppManager(); await manager.initialize(); await flush(); const old=mocks.clients[0];
  const pending:Array<(value:any)=>void>=[]; mocks.listHook=()=>new Promise(r=>pending.push(r)); const refresh=manager.refreshSessions(); await flush(); mocks.listHook=null;
  vi.stubGlobal('fetch',async()=>({ok:true})); await manager.configure({baseUrl:'https://b.test',token:'fixture-b'}); for(const resolve of pending) resolve({sessions:[{id:'old-session'}]}); await expect(refresh).rejects.toThrow('Gateway changed');
  await expect(old.opts.acknowledgeSubmission({session_id:'s',submission_id:'old'},{})).rejects.toThrow('Gateway changed'); expect(manager.getState().sessions.some(x=>x.id==='old-session')).toBe(false); manager.dispose(); vi.unstubAllGlobals();
});
it('rejects overlapping setups and preserves A after secure storage failure', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture-a'); const manager=new AppManager(); await manager.initialize(); await flush(); let release!:()=>void;
  mocks.secureHook=async (_key,value)=>{if(JSON.parse(value).origin==='https://b.test') {await new Promise<void>(r=>{release=r;}); throw Error('secure failed');}}; vi.stubGlobal('fetch',async()=>({ok:true}));
  const first=manager.configure({baseUrl:'https://b.test',token:'fixture-b'}); await flush(); await expect(manager.configure({baseUrl:'https://c.test',token:'fixture-c'})).rejects.toThrow('already in progress'); release(); await expect(first).rejects.toThrow('secure failed');
  expect(JSON.parse(mocks.secure.get('hermes.config.v1')!).origin).toBe('https://a.test'); expect(manager.getState().credentialsConfigured).toBe(true); manager.dispose(); vi.unstubAllGlobals();
});
it('retains failed source writes independently for two gateway origins', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture-a'); const manager=new AppManager(); await manager.initialize(); await flush(); vi.stubGlobal('fetch',async()=>({ok:true}));
  let release!:()=>void; let target='https://b.test'; mocks.secureHook=async (_key,value)=>{if(JSON.parse(value).origin===target) await new Promise<void>(r=>{release=r;});};
  let failA=false, failB=false; mocks.writeHook=async value=>{const c=JSON.parse(value); if((failA && c.origin==='https://a.test') || (failB && c.origin==='https://b.test')) throw Error('disk full');};
  const first=manager.configure({baseUrl:target,token:'fixture-b'}); await flush(); failA=true; manager.setDraft('a','draft A'); await flush(); release(); await first;
  target='https://c.test'; const second=manager.configure({baseUrl:target,token:'fixture-c'}); await flush(); failB=true; manager.setDraft('b','draft B'); await flush(); release(); await second;
  mocks.writeHook=null; mocks.secureHook=null; await manager.configure({baseUrl:'https://a.test',token:'fixture-a'}); expect(manager.getState().drafts.a).toBe('draft A');
  expect(cachePayload(mocks.rows.get('state:https://b.test')!).drafts.b).toBe('draft B'); manager.dispose(); vi.unstubAllGlobals();
});
it('keeps colliding alias drafts reachable and lets the user swap them', async () => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0]; client.openSession=async()=>({session_id:'owner'});
  manager.setDraft('alias','alias text'); manager.setDraft('owner','owner text'); await manager.openSession('alias'); expect(manager.getState().chats.owner.draftAlternatives).toEqual(['alias']);
  manager.swapAliasDraft('owner','alias'); expect(manager.getState().drafts.owner).toBe('alias text'); expect(manager.getState().drafts.alias).toBe('owner text'); manager.dispose();
});
it('retains a recoverable missing session and marks its pending queue failed', async () => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0]; client.opts.onState('offline');
  manager.setDraft('s','unfinished'); await manager.send('s','queued'); await manager.openSession('s'); client.opts.onSessionUnavailable('s',{reason:'not_found',code:4004}); await flush();
  expect(manager.getState().activeSessionId).toBe('s'); expect(manager.getState().chats.s.sessionUnavailable).toBe(true); expect(manager.getState().outbox[0].error).toMatch('unavailable'); expect(manager.getState().drafts.s).toBe('unfinished');
  client.opts.onState('ready'); await flush(); await manager.openSession('s'); expect(manager.getState().sessions.some(x=>x.id==='s')).toBe(true); manager.dispose();
});

it('preserves the working gateway if the destination cache cannot be read', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture-a'); const manager=new AppManager(); await manager.initialize(); await flush(); const old=mocks.clients[0];
  mocks.readHook=async key=>{if(key==='state:https://b.test') throw Error('cache read failed');}; vi.stubGlobal('fetch',async()=>({ok:true}));
  await expect(manager.configure({baseUrl:'https://b.test',token:'fixture-b'})).rejects.toThrow('cache read failed'); expect(JSON.parse(mocks.secure.get('hermes.config.v1')!).origin).toBe('https://a.test'); expect(await old.opts.getToken()).toBe('fixture-a'); manager.dispose(); vi.unstubAllGlobals();
});
it('ignores an old alias open completion after the endpoint changes', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture-a'); const manager=new AppManager(); await manager.initialize(); await flush(); const old=mocks.clients[0];
  let release!:(v:any)=>void; old.openSession=()=>new Promise(r=>{release=r;}); const opening=manager.openSession('old'); await flush(); vi.stubGlobal('fetch',async()=>({ok:true})); await manager.configure({baseUrl:'https://b.test',token:'fixture-b'}); release({session_id:'old-owner'}); await opening;
  expect(manager.getState().activeSessionId).not.toBe('old-owner'); expect(manager.getState().chats['old-owner']).toBeUndefined(); manager.dispose(); vi.unstubAllGlobals();
});

it('resolves an offline alias on reconnect and acknowledges its queued message at the canonical session', async () => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0]; client.opts.onState('offline');
  await manager.openSession('stored-tip'); await manager.send('stored-tip','queued text'); manager.setDraft('stored-tip','offline draft');
  const queued=manager.getState().outbox[0];
  client.openSession=async (session_id:string)=>{const resolved=session_id==='stored-tip'?'owner':session_id; const snapshot={session_id:resolved,replay_epoch:'e',last_sequence:0,execution_generation:1,messages:[],running:false}; client.opts.onSnapshot(resolved,snapshot,'resume'); return snapshot;};
  client.opts.onState('ready'); await flush(); await flush(); const state=manager.getState();
  expect(state.activeSessionId).toBe('owner'); expect(state.drafts.owner).toBe('offline draft'); expect(state.drafts['stored-tip']).toBeUndefined(); expect(state.outbox).toEqual([]);
  expect(state.chats.owner.localMessages.find(x=>x.submission_id===queued.submission_id)?.status).toBe('accepted'); expect(mocks.wire.filter(x=>x.method==='prompt.submit').map(x=>x.params)).toEqual([{session_id:'owner',submission_id:queued.submission_id,text:'queued text'}]); manager.dispose();
});
it('rejects sending and retrying queued work for an unavailable session', async () => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0]; client.opts.onState('offline');
  await manager.send('s','pending'); await manager.replaceQueued('s','admission','edit'); const outbox=manager.getState().outbox[0].submission_id, edit=manager.getState().queuedEdits[0].submission_id;
  client.opts.onSessionUnavailable('s',{reason:'not_found',code:4004}); await flush();
  await expect(manager.send('s','new')).rejects.toThrow('unavailable'); await expect(manager.replaceQueued('s','admission','new')).rejects.toThrow('unavailable'); await expect(manager.retryOutbox(outbox)).rejects.toThrow('unavailable'); await expect(manager.retryQueuedEdit(edit)).rejects.toThrow('unavailable'); expect(manager.getState().outbox[0].error).toBeTruthy(); expect(mocks.wire).toEqual([]); manager.dispose();
});

it('resolves an alias selected by drain and preserves queued edit and prompt order', async () => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0]; client.opts.onState('offline');
  await manager.replaceQueued('alias','admission','first edit'); await manager.send('alias','second prompt'); const edit=manager.getState().queuedEdits[0], submission=manager.getState().outbox[0];
  client.openSession=async (session_id:string)=>({session_id:session_id==='alias'?'owner':session_id}); client.opts.onState('ready'); await flush(); await flush();
  expect(mocks.wire).toEqual([{method:'prompt.replace_queued',params:{session_id:'owner',admission_id:'admission',submission_id:edit.submission_id,text:'first edit'}},{method:'prompt.submit',params:{session_id:'owner',submission_id:submission.submission_id,text:'second prompt'}}]);
  expect(manager.getState().chats.owner.localMessages[0].status).toBe('accepted'); expect(manager.getState().queuedEdits).toEqual([]); manager.dispose();
});

it('keeps a settled saved copy at its origin without blocking gateway changes or resubmitting', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture-a'); mocks.ackReceipt={admission_id:'admission'}; mocks.receiptResult={status:'terminal'};
  const manager=new AppManager(); await manager.initialize(); await flush(); await manager.openSession('s'); await manager.send('s','saved sent text'); await flush(); await manager.openSession('s'); await flush();
  const original=manager.getState().chats.s.localMessages[0]; expect(original.status).toBe('completed'); const wireCount=mocks.wire.length;
  vi.stubGlobal('fetch',async()=>({ok:true})); await manager.configure({baseUrl:'https://b.test',token:'fixture-b'}); expect(manager.getState().chats.s).toBeUndefined(); expect(cachePayload(mocks.rows.get('state:https://a.test')!).chats.s.localMessages[0].status).toBe('completed'); await manager.configure({baseUrl:'https://a.test',token:'fixture-a'}); await flush();
  expect(manager.getState().chats.s.localMessages[0]).toMatchObject({submission_id:original.submission_id,text:'saved sent text',status:'completed'}); expect(mocks.wire).toHaveLength(wireCount); manager.dispose(); vi.unstubAllGlobals();
});

it('recovers an origin-scoped cache after invalid credentials and preserves a late conflicting draft', async () => {
  const cached={sessions:[],chats:{},drafts:{s:'saved draft'},outbox:[{session_id:'s',submission_id:'saved-id',text:'saved queued',enqueue_order:1}],queuedEdits:[],nextOrdinal:2,recent:[]};
  mocks.rows=new Map([['state:https://a.test',JSON.stringify({version:1,origin:'https://a.test',payload:cached})]]); mocks.secure.set('hermes.config.v1','invalid'); mocks.openHook=()=>new Promise(()=>{});
  const manager=new AppManager(); await manager.initialize(); let release!:()=>void; mocks.secureHook=async key=>{if(key==='hermes.config.v1') await new Promise<void>(r=>{release=r;});}; vi.stubGlobal('fetch',async()=>({ok:true}));
  const setup=manager.configure({baseUrl:'https://a.test',token:'fixture'}); await flush(); manager.setDraft('s','late draft'); release(); await setup;
  const state=manager.getState(); expect(state.drafts.s).toBe('saved draft'); const alternate=state.chats.s.draftAlternatives![0]; expect(state.drafts[alternate]).toBe('late draft'); expect(state.outbox[0]).toMatchObject({submission_id:'saved-id',text:'saved queued'});
  const persisted=cachePayload(mocks.rows.get('state:https://a.test')!); expect(persisted.outbox[0].submission_id).toBe('saved-id'); expect(persisted.drafts[alternate]).toBe('late draft'); manager.dispose(); vi.unstubAllGlobals();
});
it('merges unbound queued work with a scoped cache when credentials are missing', async () => {
  const cached={sessions:[],chats:{},drafts:{saved:'saved draft'},outbox:[{session_id:'saved',submission_id:'saved-id',text:'saved queued',enqueue_order:4}],queuedEdits:[],nextOrdinal:5,recent:[]};
  const unbound={sessions:[],chats:{},drafts:{fresh:'fresh draft'},outbox:[{session_id:'fresh',submission_id:'fresh-id',text:'fresh queued',enqueue_order:1}],queuedEdits:[],nextOrdinal:2,recent:[]};
  mocks.rows=new Map([['state:https://a.test',JSON.stringify({version:1,origin:'https://a.test',payload:cached})],['state',JSON.stringify(unbound)]]); mocks.openHook=()=>new Promise(()=>{}); const manager=new AppManager(); await manager.initialize(); vi.stubGlobal('fetch',async()=>({ok:true}));
  await manager.configure({baseUrl:'https://a.test',token:'fixture'}); const state=manager.getState(); expect(state.drafts).toMatchObject({saved:'saved draft',fresh:'fresh draft'}); expect(state.outbox.map(x=>x.submission_id)).toEqual(['saved-id','fresh-id']); expect(state.outbox[1].enqueue_order).toBeGreaterThan(state.outbox[0].enqueue_order); manager.dispose(); vi.unstubAllGlobals();
});

it('retries first setup after secure write failure without duplicating merged queued work', async () => {
  const cached={sessions:[],chats:{},drafts:{saved:'saved draft'},outbox:[],queuedEdits:[],nextOrdinal:1,recent:[]}; const unbound={sessions:[],chats:{},drafts:{fresh:'fresh draft'},outbox:[{session_id:'fresh',submission_id:'fresh-id',text:'fresh queued',enqueue_order:1}],queuedEdits:[],nextOrdinal:2,recent:[]};
  mocks.rows=new Map([['state:https://a.test',JSON.stringify({version:1,origin:'https://a.test',payload:cached})],['state',JSON.stringify(unbound)]]); mocks.openHook=()=>new Promise(()=>{}); const manager=new AppManager(); await manager.initialize(); vi.stubGlobal('fetch',async()=>({ok:true}));
  mocks.secureHook=async()=>{throw Error('secure failed');}; await expect(manager.configure({baseUrl:'https://a.test',token:'fixture'})).rejects.toThrow('secure failed'); mocks.secureHook=null;
  await manager.configure({baseUrl:'https://a.test',token:'fixture'}); expect(manager.getState().outbox.map(x=>x.submission_id)).toEqual(['fresh-id']); expect(manager.getState().drafts).toMatchObject({saved:'saved draft',fresh:'fresh draft'}); manager.dispose(); vi.unstubAllGlobals();
});

it('retries failed first binding with identical nonempty history and one local message', async () => {
  const {emptyChat}=await import('./reducer'); const local={submission_id:'local-id',text:'sent',status:'accepted',enqueue_order:2};
  const chat={...emptyChat(), snapshot:{session_id:'s',metadata:{b:2,a:1}}, messages:[{row_id:1,text:'history'}], localMessages:[local]};
  const unbound={sessions:[],chats:{s:chat},drafts:{s:'unfinished'},outbox:[],queuedEdits:[],nextOrdinal:3,recent:[]}; mocks.rows=new Map([['state',JSON.stringify(unbound)]]); mocks.openHook=()=>new Promise(()=>{});
  const manager=new AppManager(); await manager.initialize(); vi.stubGlobal('fetch',async()=>({ok:true})); mocks.secureHook=async()=>{throw Error('secure failed');};
  await expect(manager.configure({baseUrl:'https://a.test',token:'fixture'})).rejects.toThrow('secure failed'); mocks.secureHook=null; await manager.configure({baseUrl:'https://a.test',token:'fixture'});
  expect(manager.getState().chats.s.messages).toEqual(chat.messages); expect(manager.getState().chats.s.snapshot).toEqual(chat.snapshot); expect(manager.getState().chats.s.localMessages).toHaveLength(1); expect(manager.getState().drafts.s).toBe('unfinished'); manager.dispose(); vi.unstubAllGlobals();
});
it('merges identical history despite object key order and local ordinal changes while preserving recovery keys', async () => {
  const {emptyChat}=await import('./reducer'); const manager=new AppManager(); const local={submission_id:'id',text:'x',status:'accepted',enqueue_order:1};
  const source={...emptyChat(),snapshot:{session_id:'s',nested:{a:1,b:2}},messages:[{row_id:1,text:'x'}],localMessages:[local]};
  const target={...source,snapshot:{nested:{b:2,a:1},session_id:'s'},localMessages:[{...local,enqueue_order:9}],draftAlternatives:['alias']};
  const result=(manager as any).mergeUnbound({chats:{s:target},drafts:{alias:'saved'}},{chats:{s:source},drafts:{}}); expect(result.chats.s.localMessages).toHaveLength(1); expect(result.chats.s.localMessages[0].enqueue_order).toBe(9); expect(result.chats.s.draftAlternatives).toEqual(['alias']);
});
it('rejects different complete chat histories while preserving the scoped cache', async () => {
  const {emptyChat}=await import('./reducer'); const manager=new AppManager(); const base={...emptyChat(),snapshot:{session_id:'s',nested:{enqueue_order:1}},messages:[{row_id:1},{row_id:2}]};
  for (const changed of [{...base,snapshot:{session_id:'s',nested:{enqueue_order:2}}},{...base,messages:[{row_id:2},{row_id:1}]},{...base,cursor:'different'},{...base,sessionUnavailable:true}]) {
    const scoped={chats:{s:base},drafts:{}}; expect(()=>(manager as any).mergeUnbound(scoped,{chats:{s:changed},drafts:{}})).toThrow('conflict'); expect(scoped.chats.s).toEqual(base);
  }
  const result=(manager as any).mergeUnbound({chats:{s:base},drafts:{}},{chats:{s:{...emptyChat(),localMessages:[{submission_id:'new',text:'x',status:'pending',enqueue_order:1}]}},drafts:{}}); expect(result.chats.s.snapshot).toEqual(base.snapshot); expect(result.chats.s.localMessages).toHaveLength(1);
});

it('checkpoints typing without serializing transcripts and restores newer drafts after restart', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.config.v1',JSON.stringify({version:1,origin:'https://a.test',token:'fixture'}));
  const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0]; client.opts.onState('offline');
  client.opts.onSnapshot('s',{session_id:'s',messages:Array.from({length:100},(_,row_id)=>({row_id,text:'x'.repeat(10_000)})),running:false,prompts:[],pending:[]},'resume');
  for(let n=0;n<40;n++)manager.setDraft('s','typed '+n); await flush();
  const draft=mocks.rows.get('drafts:https://a.test')!; expect(draft.length).toBeLessThan(200); expect(JSON.parse(draft).drafts.s).toBe('typed 39'); manager.dispose();
  const next=new AppManager(); await next.initialize(); expect(next.getState().drafts.s).toBe('typed 39'); next.dispose();
});
it('a durable send supersedes an older draft journal while retaining the prepared submission ID', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.config.v1',JSON.stringify({version:1,origin:'https://a.test',token:'fixture'})); const manager=new AppManager(); await manager.initialize(); await flush(); mocks.clients[0].opts.onState('offline');
  manager.setDraft('s','hello'); await flush(); await manager.send('s'); const submission=manager.getState().outbox[0];
  const main=cachePayload(mocks.rows.get('state:https://a.test')!); expect(main.drafts.s).toBe(''); expect(main.draftRevision).toBeGreaterThan(JSON.parse(mocks.rows.get('drafts:https://a.test')!).revision); manager.dispose();
  mocks.failConnect=true; const restarted=new AppManager(); await restarted.initialize(); expect(restarted.getState().drafts.s).toBe(''); expect(restarted.getState().outbox[0].submission_id).toBe(submission.submission_id); restarted.dispose();
});
it('restores a verified scoped draft journal after invalid credentials without using another origin journal', async () => {
  mocks.rows=new Map([['drafts:https://a.test',JSON.stringify({version:1,origin:'https://a.test',revision:50,drafts:{s:'recover'}})],['drafts:',JSON.stringify({version:1,origin:'https://b.test',revision:100,drafts:{wrong:'do not load'}})]]);
  mocks.secure.set('hermes.config.v1','broken'); const manager=new AppManager(); await manager.initialize(); expect(manager.getState().drafts).toEqual({}); vi.stubGlobal('fetch',async()=>({ok:true}));
  await manager.configure({baseUrl:'https://a.test',token:'fixture'}); expect(manager.getState().drafts).toEqual({s:'recover'}); manager.dispose(); vi.unstubAllGlobals();
});
it('keeps failed draft writes visible in memory and reports the storage failure', async () => {
  mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize(); mocks.fail=true; manager.setDraft('s','keep this'); await flush();
  expect(manager.getState().drafts.s).toBe('keep this'); expect(manager.getState().error).toContain('draft'); expect(mocks.wire).toEqual([]); manager.dispose();
});
it('coalesces inventory bursts and performs a trailing refresh for changes received during the first', async () => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0]; mocks.listCalls=[];
  const pending:Array<(value:any)=>void>=[]; mocks.listHook=()=>new Promise(resolve=>pending.push(resolve));
  const complete=manager.refreshSessions(); for(let n=0;n<40;n++)client.opts.onEvent({type:'sessions.changed',payload:{}}); expect(mocks.listCalls).toHaveLength(2);
  mocks.listHook=null; mocks.storedRows=[{id:'latest',title:'latest inventory'}]; pending.forEach(resolve=>resolve({sessions:[]})); await complete;
  expect(mocks.listCalls).toHaveLength(4); expect(manager.getState().sessions.some(row=>row.id==='latest')).toBe(true); manager.dispose();
});
it('background deltas preserve active-chat and inventory identities; prompts still update attention', async () => {
  const manager=new AppManager(); await manager.initialize();
  const {emptyChat}=await import('./reducer'); (manager as any).update({sessions:[{id:'active'},{id:'other'}],activeSessionId:'active',chats:{active:emptyChat(),other:emptyChat()}});
  const active=manager.getState().chats.active, rows=manager.getState().sessions;
  (manager as any).events.push({type:'message.delta',session_id:'other',payload:{text:'stream'}}); (manager as any).flushEvents();
  expect(manager.getState().chats.active).toBe(active); expect(manager.getState().sessions).toBe(rows);
  (manager as any).events.push({type:'approval.request',session_id:'other',payload:{prompt_id:'p'}}); (manager as any).flushEvents(); expect(manager.getState().sessions[1].needs_attention).toBe(true);
  (manager as any).events.push({type:'approval.settled',session_id:'other',payload:{prompt_id:'p'}}); (manager as any).flushEvents(); expect(manager.getState().sessions[1].needs_attention).toBe(false); manager.dispose();
});
it('bounds idle transcript retention after browsing while preserving all local recovery work', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0];
  const {emptyChat}=await import('./reducer');
  (manager as any).update({drafts:{saved:'draft',alias:'alternate'},chats:{saved:{...emptyChat(),messages:[{text:'replaceable'}],localMessages:[{submission_id:'local',text:'accepted copy',status:'accepted',enqueue_order:1}],draftAlternatives:['alias']},gone:{...emptyChat(),sessionUnavailable:true,messages:[{text:'only cached recovery history'}]}}});
  client.openSession=async(session_id:string)=>{const snapshot={session_id,messages:Array.from({length:50},(_,row_id)=>({row_id,text:'history'})),running:false,prompts:[],pending:[]}; client.opts.onSnapshot(session_id,snapshot,'resume'); return snapshot;};
  for(let n=0;n<40;n++)await manager.openSession('visit'+n);
  const state=manager.getState(); expect(Object.keys(state.chats)).toHaveLength(10); expect(state.chats.visit0).toBeUndefined(); expect(state.chats.visit39.messages).toHaveLength(50);
  expect(state.drafts).toEqual({saved:'draft',alias:'alternate'}); expect(state.chats.saved.localMessages[0].submission_id).toBe('local'); expect(state.chats.saved.draftAlternatives).toEqual(['alias']); expect(state.chats.gone.messages[0]).toEqual({text:'only cached recovery history'}); expect(mocks.wire).toEqual([]); manager.dispose();
});
it('shares image reads and rejects stale in-flight results on a verified endpoint change', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); let release!:(value:any)=>void, imageCalls=0; let signal!:AbortSignal;
  vi.stubGlobal('fetch',async(url:string,options:any)=>{if(url.endsWith('/api/auth/me'))return {ok:true}; imageCalls++; signal=options.signal; return new Promise(resolve=>{release=resolve;});});
  const first=manager.readImage('s','C:/image.png'), second=manager.readImage('s','C:/image.png'); const rejected=Promise.all([expect(first).rejects.toThrow('cancelled'),expect(second).rejects.toThrow('cancelled')]); await flush(); expect(imageCalls).toBe(1);
  await manager.configure({baseUrl:'https://b.test',token:'fixture-b'}); await rejected; expect(signal.aborted).toBe(true); release({ok:true,json:async()=>({dataUrl:'data:image/png;base64,b2xk'})}); await flush();
  vi.stubGlobal('fetch',async()=>({ok:true,json:async()=>({dataUrl:'data:image/png;base64,bmV3'})})); expect(await manager.readImage('s','C:/image.png')).toBe('data:image/png;base64,bmV3'); manager.dispose(); vi.unstubAllGlobals();
});

it.each(['completion','paging'] as const)('does not recreate pruned history from a delayed %s response', async kind => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); const {emptyChat}=await import('./reducer');
  const chats=Object.fromEntries(['old',...Array.from({length:8},(_,n)=>'keep'+n)].map(id=>[id,{...emptyChat(),messages:[{row_id:1,text:'history'}]}]));
  (manager as any).update({chats,activeSessionId:'keep7'}); (manager as any).recent=Array.from({length:8},(_,n)=>'keep'+n);
  let release!:(value:any)=>void; mocks.transcript=()=>new Promise(resolve=>{release=resolve;});
  const pending=kind==='paging'?manager.loadEarlier('old'):(manager as any).refreshTranscript('old'); await flush();
  (manager as any).trimIdleChats(); expect(manager.getState().chats.old).toBeUndefined(); release({rows:[{row_id:2,text:'late'}],next_cursor:null}); await pending;
  expect(manager.getState().chats.old).toBeUndefined(); expect(Object.keys(manager.getState().chats)).toHaveLength(8); manager.dispose();
});
it('flushes pending starts and approvals before deciding which old sessions may be detached', async () => {
  mocks.secure.set('hermes.baseUrl','https://a.test'); mocks.secure.set('hermes.token','fixture'); const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0]; const {emptyChat}=await import('./reducer');
  const ids=['running','approval',...Array.from({length:6},(_,n)=>'idle'+n)]; (manager as any).recent=ids; (manager as any).update({chats:Object.fromEntries(ids.map(id=>[id,emptyChat()]))}); const detached:string[]=[]; client.detachSession=async(id:string)=>{detached.push(id);};
  client.opts.onEvent({type:'message.start',session_id:'running',payload:{}}); client.opts.onEvent({type:'approval.request',session_id:'approval',payload:{prompt_id:'p'}});
  await manager.openSession('new'); expect(manager.getState().chats.running.running).toBe(true); expect(manager.getState().chats.approval.prompts).toHaveLength(1); expect(detached).not.toContain('running'); expect(detached).not.toContain('approval'); expect(detached).toHaveLength(1); manager.dispose();
});


describe('notification approval actions', () => {
  it('resumes and checks endpoint, generation, prompt and offered choice before response', async () => {
    mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
    const manager = new AppManager(); await manager.initialize(); await flush();
    const data = {origin:'https://example.test',session:'s',prompt:'p',generation:'1'};
    await expect(manager.respondNotificationApproval({...data,origin:'https://other.test'},'once')).rejects.toThrow();
    await expect(manager.respondNotificationApproval({...data,generation:'2'},'once')).rejects.toThrow();
    await expect(manager.respondNotificationApproval(data,'always')).rejects.toThrow();
    expect(mocks.wire).toHaveLength(0);
    await manager.respondNotificationApproval(data,'deny');
    expect(mocks.wire).toEqual([{method:'approval.respond',params:{session_id:'s',execution_generation:1,prompt_id:'p',choice:'deny'}}]);
    manager.dispose();
  });
});


it('requests only explicitly configured models globally and for the selected session', async () => {
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
  const manager = new AppManager(); await manager.initialize(); await flush();
  const calls:any[] = []; mocks.clients[0].request = async (method:string, params:any) => { calls.push({method,params}); return {providers:[]}; };
  await manager.modelOptions(); await manager.modelOptions('session-1');
  expect(calls).toEqual([{method:'model.options',params:{explicit_only:true}},{method:'model.options',params:{session_id:'session-1',explicit_only:true}}]);
  manager.dispose();
});


it('voice send preserves identical typed draft and fences a cancelled queued request', async () => {
  const manager = new AppManager(); await manager.initialize(); manager.setDraft('s','same words');
  await manager.send('s','same words',undefined,{preserveDraft:true,valid:()=>true});
  expect(manager.getState().drafts.s).toBe('same words');
  await expect(manager.send('s','cancelled',undefined,{preserveDraft:true,valid:()=>false})).rejects.toThrow('Voice session ended');
  expect(manager.getState().outbox.filter(x=>x.text==='cancelled')).toHaveLength(0);manager.dispose();
});

it('voice transport rejects invalid audio and cancels when the configured endpoint changes', async () => {
  mocks.rows=new Map();
  mocks.secure.set('hermes.config.v1',JSON.stringify({version:1,origin:'https://example.test',token:'secret'}));
  const manager = new AppManager();await manager.initialize();await flush();
  const originalFetch=globalThis.fetch;
  try {
    globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify({ok:true,mime_type:'application/json',data_url:'data:application/json;base64,YWJj'}),{status:200})) as typeof fetch;
    await expect(manager.speakAudio('hello',new AbortController().signal,manager.getEndpointEpoch())).rejects.toThrow('Invalid audio');
    let resolve!:(response:Response)=>void, observed!:AbortSignal;
    globalThis.fetch=vi.fn((url,options)=>{if(String(url).endsWith('/api/auth/me')) return Promise.resolve(new Response('{}',{status:200}));observed=options!.signal as AbortSignal;return new Promise<Response>(r=>{resolve=r;});}) as typeof fetch;
    const pending=manager.transcribeAudio('data:audio/mp4;base64,YWJj',new AbortController().signal,manager.getEndpointEpoch());
    await manager.configure({baseUrl:'https://another.test',token:'new-secret'});
    expect(observed.aborted).toBe(true);resolve(new Response(JSON.stringify({ok:true,transcript:'late'}),{status:200}));
    await expect(pending).rejects.toThrow();
  } finally {globalThis.fetch=originalFetch;manager.dispose();}
});

it('failed voice persistence keeps the typed draft and never leaves a queued send', async () => {
 const manager=new AppManager();await manager.initialize();manager.setDraft('s','same words');mocks.fail=true;
 await expect(manager.send('s','same words',undefined,{preserveDraft:true,valid:()=>true})).rejects.toThrow();
 expect(manager.getState().drafts.s).toBe('same words');expect(manager.getState().outbox).toHaveLength(0);manager.dispose();
});

it('voice transport ignores a response that resolves after its timeout', async () => {
 mocks.secure.set('hermes.config.v1',JSON.stringify({version:1,origin:'https://example.test',token:'secret'}));
 const manager=new AppManager();await manager.initialize();await flush();const originalFetch=globalThis.fetch;vi.useFakeTimers();
 try {
  let resolve!:(response:Response)=>void,observed!:AbortSignal;
  globalThis.fetch=vi.fn((_url,options)=>{observed=options!.signal as AbortSignal;return new Promise<Response>(r=>{resolve=r;});}) as typeof fetch;
  const pending=manager.transcribeAudio('data:audio/mp4;base64,YWJj',new AbortController().signal,manager.getEndpointEpoch());
  const rejected=expect(pending).rejects.toThrow('Audio unavailable');
  await vi.advanceTimersByTimeAsync(45000);expect(observed.aborted).toBe(true);
  resolve(new Response(JSON.stringify({ok:true,transcript:'too late'}),{status:200}));await rejected;
 } finally {vi.useRealTimers();globalThis.fetch=originalFetch;manager.dispose();}
});

it('voice transport rejects a body that finishes after its deadline', async () => {
 mocks.secure.set('hermes.config.v1',JSON.stringify({version:1,origin:'https://example.test',token:'secret'}));
 const manager=new AppManager();await manager.initialize();await flush();const originalFetch=globalThis.fetch;vi.useFakeTimers();
 try {
  let resolve!:(value:{done:boolean;value?:Uint8Array})=>void, first=true;
  const reader={read:()=>first?(first=false,new Promise(r=>{resolve=r;})):Promise.resolve({done:true}),releaseLock:()=>{},cancel:async()=>{}};
  const response={ok:true,headers:new Headers(),body:{getReader:()=>reader}} as unknown as Response;
  globalThis.fetch=vi.fn(async()=>response) as typeof fetch;
  const pending=manager.transcribeAudio('data:audio/mp4;base64,YWJj',new AbortController().signal,manager.getEndpointEpoch());
  const rejected=expect(pending).rejects.toThrow('Audio unavailable');await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(45000);
  resolve({done:false,value:new TextEncoder().encode(JSON.stringify({ok:true,transcript:'late'}))});await rejected;
 } finally {vi.useRealTimers();globalThis.fetch=originalFetch;manager.dispose();}
});

describe('steer delivery', () => {
  async function setup() {
    mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
    const manager = new AppManager(); await manager.initialize(); await flush();
    manager.setDraft('s','original');
    return {manager, client:mocks.clients[0]};
  }
  it.each(['queued','redirected'])('returns accepted %s without a fallback', async status => {
    const {manager,client}=await setup(); client.request=async()=>({status});
    await expect(manager.steer('s','original')).resolves.toEqual({status});
    expect(mocks.wire.filter(x=>x.method==='prompt.submit')).toHaveLength(0); manager.dispose();
  });
  it('submits exactly once when the rejection explicitly says not delivered', async () => {
    const {manager,client}=await setup(); client.request=async()=>({status:'rejected',delivered:false});
    await manager.steer('s','original'); await flush();
    expect(mocks.wire.filter(x=>x.method==='prompt.submit')).toHaveLength(1); manager.dispose();
  });
  it('keeps the draft and never submits when fallback persistence fails', async () => {
    const {manager,client}=await setup(); client.request=async()=>({status:'rejected',delivered:false}); mocks.fail=true;
    await expect(manager.steer('s','original')).rejects.toThrow('disk full');
    expect(manager.getState().drafts.s).toBe('original'); expect(manager.getState().outbox).toHaveLength(0);
    expect(mocks.wire.filter(x=>x.method==='prompt.submit')).toHaveLength(0); manager.dispose();
  });
  it.each([{status:'rejected'},{status:'rejected',delivered:null},{voice_stopped:true},{status:'unsupported'},null])('keeps draft and avoids fallback for ambiguous response %o', async result => {
    const {manager,client}=await setup(); client.request=async()=>result;
    await expect(manager.steer('s','original').then(()=>manager.replaceDraftIfUnchanged('s','original',''))).rejects.toThrow('Steer delivery is uncertain');
    expect(manager.getState().drafts.s).toBe('original'); expect(mocks.wire.filter(x=>x.method==='prompt.submit')).toHaveLength(0); manager.dispose();
  });
  it('retains a newer draft when the response fails', async () => {
    const {manager,client}=await setup(); let resolve!: (value:any)=>void; client.request=()=>new Promise(r=>{resolve=r;});
    const pending=manager.steer('s','original').then(()=>manager.replaceDraftIfUnchanged('s','original',''));
    manager.setDraft('s','newer'); resolve({status:'rejected'}); await expect(pending).rejects.toThrow();
    expect(manager.getState().drafts.s).toBe('newer'); manager.dispose();
  });
  it('does not fall back after the endpoint epoch changes', async () => {
    const {manager,client}=await setup(); let resolve!: (value:any)=>void; client.request=()=>new Promise(r=>{resolve=r;});
    const pending=manager.steer('s','original'); manager.dispose(); resolve({status:'rejected',delivered:false});
    await expect(pending).rejects.toThrow(); expect(mocks.wire.filter(x=>x.method==='prompt.submit')).toHaveLength(0);
  });
});

describe('shared drafts and draft image recovery', () => {
  const shareId = '00000000-0000-4000-8000-000000000001';
  const firstImage = {uri:'file:///cache/first.jpg',path:'uploads/first.jpg',mime:'image/jpeg'};
  const secondImage = {uri:'file:///cache/second.png',path:'uploads/second.png',mime:'image/png'};

  it('adds shared text and images to the existing draft durably without sending', async () => {
    mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize();
    manager.setDraft('s','My existing question');
    await manager.setDraftAttachments('s',[firstImage]);
    await manager.importSharedDraft('s',shareId,'A shared article',[secondImage]);
    expect(manager.getState().drafts.s).toBe('My existing question\n\nA shared article');
    expect(manager.getState().chats.s.draftAttachments).toEqual([firstImage,secondImage]);
    expect(manager.getState().outbox).toEqual([]); expect(mocks.wire).toEqual([]);
    const saved=cachePayload(mocks.rows.get('state')!);
    expect(saved.drafts.s).toBe('My existing question\n\nA shared article');
    expect(saved.chats.s.draftAttachments).toEqual([firstImage,secondImage]);
    manager.dispose();
  });

  it('checkpoints a failed import on retry without duplicating it or sending it', async () => {
    mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize();
    manager.setDraft('s','Original'); await flush();
    const originalCache=mocks.rows.get('state'); mocks.fail=true;
    const acknowledge=vi.fn();
    await expect(manager.importSharedDraft('s',shareId,'Shared',[firstImage]).then(acknowledge)).rejects.toThrow('disk full');
    expect(acknowledge).not.toHaveBeenCalled();
    expect(manager.getState().drafts.s).toBe('Original\n\nShared');
    expect(manager.getState().chats.s.draftAttachments).toEqual([firstImage]);
    expect(manager.getState().error).toContain('original share');
    expect(mocks.rows.get('state')).toBe(originalCache);
    expect(manager.getState().outbox).toEqual([]); expect(mocks.wire).toEqual([]);
    mocks.fail=false;
    await manager.importSharedDraft('s',shareId,'Shared',[firstImage]).then(acknowledge);
    expect(acknowledge).toHaveBeenCalledTimes(1);
    await manager.importSharedDraft('s',shareId,'Shared',[firstImage]);
    expect(manager.getState().drafts.s).toBe('Original\n\nShared');
    expect(cachePayload(mocks.rows.get('state')!).chats.s.draftAttachments).toEqual([firstImage]);
    manager.dispose();
  });

  it('keeps a failed transcript transfer retryable without duplicating text or losing images', async () => {
    mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize();
    manager.setDraft('s','Existing'); await manager.setDraftAttachments('s',[firstImage]); mocks.fail=true;
    await expect(manager.importSharedDraft('s',shareId,'Transcript',[],()=>true,'transcript')).rejects.toThrow('disk full');
    expect(manager.getState().drafts.s).toBe('Existing\n\nTranscript');
    expect(manager.getState().error).toContain('transcript');expect(manager.getState().outbox).toEqual([]);
    mocks.fail=false; await manager.importSharedDraft('s',shareId,'Transcript',[],()=>true,'transcript');
    expect(cachePayload(mocks.rows.get('state')!).drafts.s).toBe('Existing\n\nTranscript');
    expect(manager.getState().chats.s.draftAttachments).toEqual([firstImage]);manager.dispose();
  });

  it('keeps the import identity after restart and refuses using it for another chat', async () => {
    mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize();
    await manager.importSharedDraft('s',shareId,'Saved',[firstImage]); manager.dispose();
    const restored=new AppManager(); await restored.initialize();
    await restored.importSharedDraft('s',shareId,'Saved',[firstImage]);
    expect(restored.getState().drafts.s).toBe('Saved');
    expect(restored.getState().chats.s.draftAttachments).toEqual([firstImage]);
    await expect(restored.importSharedDraft('other',shareId,'Saved',[firstImage])).rejects.toThrow('another chat');
    expect(restored.getState().drafts.other).toBeUndefined();
    expect(restored.getState().outbox).toEqual([]); restored.dispose();
  });

  it('retains a shared image draft through session cache trimming and a restart', async () => {
    mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize();
    await manager.importSharedDraft('old',shareId,'',[firstImage]);
    for(let n=0;n<10;n++) {
      const id=`new${n}`;
      await manager.setDraftAttachments(id,[]);
      await manager.openSession(id);
    }
    expect(manager.getState().chats.old.draftAttachments).toEqual([firstImage]);
    manager.dispose(); const restored=new AppManager(); await restored.initialize();
    expect(restored.getState().chats.old.draftAttachments).toEqual([firstImage]);
    expect(restored.getState().outbox).toEqual([]); restored.dispose();
  });

  it('preserves imported images and identity when an alias resolves to an already-cached session', async () => {
    mocks.rows=new Map();
    mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
    const manager=new AppManager(); await manager.initialize(); await flush();
    await manager.setDraftAttachments('canonical',[secondImage]);
    await manager.importSharedDraft('alias',shareId,'Shared',[firstImage]);
    const client=mocks.clients[0];
    client.openSession=async(sessionId:string)=>({session_id:sessionId==='alias'?'canonical':sessionId,execution_generation:1});
    await manager.openSession('alias');
    expect(manager.getState().activeSessionId).toBe('canonical');
    expect(manager.getState().chats.canonical.draftAttachments).toHaveLength(2);
    expect(manager.getState().chats.canonical.draftAttachments).toEqual(expect.arrayContaining([firstImage,secondImage]));
    expect(manager.getState().drafts.canonical).toBe('Shared');
    await manager.importSharedDraft('canonical',shareId,'Shared',[firstImage]);
    expect(manager.getState().drafts.canonical).toBe('Shared');
    expect(manager.getState().chats.canonical.draftAttachments).toHaveLength(2);
    manager.dispose();
  });

  it('preserves both imported drafts when binding an unconfigured cache to the same scoped session', async () => {
    const {emptyChat}=await import('./reducer');
    const otherId='00000000-0000-4000-8000-000000000002';
    const scoped={sessions:[],chats:{s:{...emptyChat(),draftAttachments:[secondImage],importedShareIds:[otherId]}},drafts:{},outbox:[],queuedEdits:[],nextOrdinal:1,recent:[]};
    const unbound={sessions:[],chats:{s:{...emptyChat(),draftAttachments:[firstImage],importedShareIds:[shareId]}},drafts:{s:'Shared'},outbox:[],queuedEdits:[],nextOrdinal:1,recent:[]};
    mocks.rows=new Map([['state:https://a.test',JSON.stringify({version:1,origin:'https://a.test',payload:scoped})],['state',JSON.stringify(unbound)]]);
    mocks.openHook=()=>new Promise(()=>{}); const manager=new AppManager(); await manager.initialize();
    vi.stubGlobal('fetch',async()=>({ok:true}));
    try {
      await manager.configure({baseUrl:'https://a.test',token:'fixture'});
      expect(manager.getState().chats.s.draftAttachments).toHaveLength(2);
      expect(manager.getState().chats.s.draftAttachments).toEqual(expect.arrayContaining([firstImage,secondImage]));
      expect(manager.getState().chats.s.importedShareIds).toEqual(expect.arrayContaining([shareId,otherId]));
      expect(manager.getState().drafts.s).toBe('Shared');
      await manager.importSharedDraft('s',shareId,'Shared',[firstImage]);
      expect(manager.getState().drafts.s).toBe('Shared');
      expect(manager.getState().chats.s.draftAttachments).toHaveLength(2);
    } finally {manager.dispose();vi.unstubAllGlobals();}
  });

  it('retains every merged image and requires the owner to reduce an oversized draft before sending', async () => {
    mocks.rows=new Map();
    mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
    const manager=new AppManager(); await manager.initialize(); await flush();
    const canonicalImages=Array.from({length:10},(_,n)=>({...firstImage,uri:`file:///cache/c${n}.jpg`,path:`uploads/c${n}.jpg`}));
    const aliasImages=Array.from({length:10},(_,n)=>({...secondImage,uri:`file:///cache/a${n}.png`,path:`uploads/a${n}.png`}));
    await manager.setDraftAttachments('canonical',canonicalImages);
    await manager.importSharedDraft('alias',shareId,'Shared',aliasImages);
    const client=mocks.clients[0];
    client.openSession=async(sessionId:string)=>({session_id:sessionId==='alias'?'canonical':sessionId,execution_generation:1});
    await manager.openSession('alias');
    const combined=manager.getState().chats.canonical.draftAttachments!;
    expect(combined).toHaveLength(20);
    expect(combined).toEqual(expect.arrayContaining([...canonicalImages,...aliasImages]));
    const wireImages=combined.map(({path,mime})=>({path,mime}));
    await expect(manager.send('canonical','Shared',wireImages)).rejects.toThrow(/10/);
    expect(manager.getState().outbox).toEqual([]);
    expect(mocks.wire.filter(item=>item.method==='prompt.submit')).toEqual([]);
    expect(manager.getState().chats.canonical.draftAttachments).toHaveLength(20);
    await manager.setDraftAttachments('canonical',combined.slice(0,19));
    expect(manager.getState().chats.canonical.draftAttachments).toHaveLength(19);
    const chosen=combined.slice(0,10);
    await manager.setDraftAttachments('canonical',chosen);
    client.opts.onState('offline');
    await manager.send('canonical','Shared',chosen.map(({path,mime})=>({path,mime})));
    expect(manager.getState().outbox[0].attachments).toEqual(chosen.map(({path,mime})=>({path,mime})));
    expect(manager.getState().chats.canonical.draftAttachments).toEqual([]);
    manager.dispose();
  });

  it('restores the draft and images when saving a send fails', async () => {
    mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize();
    manager.setDraft('s','Please inspect'); await manager.setDraftAttachments('s',[firstImage,secondImage]);
    mocks.fail=true;
    await expect(manager.send('s','Please inspect',[{path:firstImage.path,mime:firstImage.mime}])).rejects.toThrow('disk full');
    expect(manager.getState().drafts.s).toBe('Please inspect');
    expect(manager.getState().chats.s.draftAttachments).toEqual([firstImage,secondImage]);
    expect(manager.getState().outbox).toEqual([]); expect(mocks.wire).toEqual([]);
    mocks.fail=false; manager.dispose();
  });

  it('clears only submitted images after a durable send, keeping other draft images', async () => {
    mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize();
    manager.setDraft('s','Please inspect'); await manager.setDraftAttachments('s',[firstImage,secondImage]);
    const submission=await manager.send('s','Please inspect',[{path:firstImage.path,mime:firstImage.mime}]);
    expect(manager.getState().chats.s.draftAttachments).toEqual([secondImage]);
    expect(manager.getState().outbox).toMatchObject([{submission_id:submission,attachments:[{path:firstImage.path,mime:firstImage.mime}]}]);
    const saved=cachePayload(mocks.rows.get('state')!);
    expect(saved.chats.s.draftAttachments).toEqual([secondImage]);
    expect(saved.outbox[0].attachments).toEqual([{path:firstImage.path,mime:firstImage.mime}]);
    manager.dispose();
  });

  it('preserves ordinary text and image drafts during a voice submission', async () => {
    mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize();
    manager.setDraft('s','unfinished typed draft'); await manager.setDraftAttachments('s',[firstImage]);
    await manager.send('s','spoken words',undefined,{preserveDraft:true,valid:()=>true});
    expect(manager.getState().drafts.s).toBe('unfinished typed draft');
    expect(manager.getState().chats.s.draftAttachments).toEqual([firstImage]);
    expect(manager.getState().outbox).toMatchObject([{text:'spoken words'}]);
    expect(cachePayload(mocks.rows.get('state')!).chats.s.draftAttachments).toEqual([firstImage]);
    manager.dispose();
  });

  it('rejects a share that would exceed the image limit without altering the draft', async () => {
    mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize();
    const ten=Array.from({length:10},(_,index)=>({...firstImage,path:`uploads/${index}.jpg`}));
    manager.setDraft('s','Keep me'); await manager.setDraftAttachments('s',ten);
    await expect(manager.importSharedDraft('s',shareId,'Do not append',[secondImage])).rejects.toThrow('up to 10');
    expect(manager.getState().drafts.s).toBe('Keep me');
    expect(manager.getState().chats.s.draftAttachments).toEqual(ten);
    expect(manager.getState().outbox).toEqual([]); manager.dispose();
  });

  it('returns the originally selected destination when a later navigation finishes first', async () => {
    mocks.rows=new Map();
    mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
    const manager=new AppManager(); await manager.initialize(); await flush();
    let finishA!:(value:any)=>void;
    mocks.clients[0].openSession=async(sessionId:string)=>sessionId==='A'
      ? new Promise(resolve=>{finishA=resolve;})
      : {session_id:sessionId,execution_generation:1};
    const selectingA=manager.openSession('A');
    await vi.waitFor(()=>expect(finishA).toBeTypeOf('function'));
    await manager.openSession('B'); expect(manager.getState().activeSessionId).toBe('B');
    finishA({session_id:'A',execution_generation:1});
    const destination=await selectingA;
    expect(destination).toBe('A'); expect(manager.getState().activeSessionId).toBe('B');
    await expect(manager.importSharedDraft(destination!,shareId,'Never to B',[firstImage],()=>manager.getState().activeSessionId===destination)).rejects.toThrow('cancelled');
    expect(manager.getState().drafts.A).toBeUndefined(); expect(manager.getState().drafts.B).toBeUndefined();
    expect(manager.getState().chats.A?.draftAttachments).toBeUndefined(); expect(manager.getState().chats.B?.draftAttachments).toBeUndefined();
    expect(manager.getState().outbox).toEqual([]); manager.dispose();
  });

  it('retains both the failed-send image and a newer image added during checkpoint failure', async () => {
    mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize();
    manager.setDraft('s','Please inspect'); await manager.setDraftAttachments('s',[firstImage]);
    let reject!:(error:Error)=>void;
    mocks.blockWrite=()=>new Promise((_resolve,fail)=>{reject=fail;});
    const sending=manager.send('s','Please inspect',[{path:firstImage.path,mime:firstImage.mime}]);
    await vi.waitFor(()=>expect(reject).toBeTypeOf('function'));
    const adding=manager.setDraftAttachments('s',[secondImage]);
    expect(manager.getState().chats.s.draftAttachments).toEqual([secondImage]);
    reject(Error('disk full'));
    await expect(sending).rejects.toThrow('disk full'); await adding;
    expect(manager.getState().drafts.s).toBe('Please inspect');
    expect(manager.getState().chats.s.draftAttachments).toHaveLength(2);
    expect(manager.getState().chats.s.draftAttachments).toEqual(expect.arrayContaining([firstImage,secondImage]));
    expect(cachePayload(mocks.rows.get('state')!).chats.s.draftAttachments).toEqual(expect.arrayContaining([firstImage,secondImage]));
    expect(manager.getState().outbox).toEqual([]); expect(mocks.wire).toEqual([]); manager.dispose();
  });

  it('rechecks cancellation after a queued share waits for an earlier durable import', async () => {
    mocks.rows=new Map(); const manager=new AppManager(); await manager.initialize();
    let release!:()=>void;
    mocks.blockWrite=()=>new Promise(resolve=>{release=resolve;});
    const first=manager.importSharedDraft('s',shareId,'First',[]);
    await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    let valid=true;
    const cancelledId='00000000-0000-4000-8000-000000000002';
    const second=manager.importSharedDraft('s',cancelledId,'Cancelled',[firstImage],()=>valid);
    const rejected=expect(second).rejects.toThrow('cancelled');
    valid=false; release(); await first; await rejected;
    expect(manager.getState().drafts.s).toBe('First');
    expect(manager.getState().chats.s.draftAttachments).toEqual([]);
    expect(manager.getState().chats.s.importedShareIds).toEqual([shareId]);
    const saved=cachePayload(mocks.rows.get('state')!);
    expect(saved.drafts.s).toBe('First'); expect(saved.chats.s.importedShareIds).toEqual([shareId]);
    expect(manager.getState().outbox).toEqual([]); manager.dispose();
  });
});


it('preserves new endpoint and same-endpoint recovery during delayed deletion', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://old.example'); mocks.secure.set('hermes.token','fixture');
  const manager=new AppManager(); await manager.initialize(); await flush();
  const old=mocks.clients[0]; let release!:()=>void, entered!:()=>void;
  let blocked=new Promise<void>(resolve=>{release=resolve;}); let started=new Promise<void>(resolve=>{entered=resolve;});
  old.mutate=async()=>({deleted:true}); old.detachSession=async()=>{entered(); await blocked;};
  const first=manager.mutate('same','delete',{}); await started;
  await manager.setDraftAttachments('same',[{uri:'file:///fixture.png',path:'/new.png',mime:'image/png'}]);
  release(); await first; expect(manager.getState().chats.same.sessionUnavailable).toBe(true); expect(manager.getState().chats.same.draftAttachments).toHaveLength(1);
  await manager.setDraftAttachments('same',[]);
  blocked=new Promise<void>(resolve=>{release=resolve;}); started=new Promise<void>(resolve=>{entered=resolve;});
  const second=manager.mutate('other','delete',{}); await started;
  vi.stubGlobal('fetch',async()=>({ok:true}));
  try { await manager.configure({baseUrl:'https://new.example',token:'fixture'}); await manager.setDraftAttachments('other',[{uri:'file:///fixture.png',path:'/other.png',mime:'image/png'}]); release(); await second; expect(manager.getState().chats.other.draftAttachments).toHaveLength(1); } finally { release(); manager.dispose(); vi.unstubAllGlobals(); }
});

it('applies queued edit only while captured draft and endpoint remain unchanged', async () => {
  const manager=new AppManager(); await manager.initialize();
  manager.setDraft('s','original'); const captured=manager.captureDraft('s');
  manager.setDraft('s','changed'); manager.setDraft('s','original'); manager.replaceCapturedDraft('s',captured,'queued');
  expect(manager.getState().drafts.s).toBe('original');
  manager.replaceCapturedDraft('s',manager.captureDraft('s'),'queued'); expect(manager.getState().drafts.s).toBe('queued'); manager.dispose();
});

it('secure cancellation and late actions belong only to their request', async () => {
  mocks.secure.set('hermes.baseUrl','https://old.example'); mocks.secure.set('hermes.token','fixture');
  const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0];
  const first=client.opts.requestSecret('sudo',{},new AbortController().signal); const firstRejected=expect(first).rejects.toThrow('Superseded'); const old=manager.getState().secureRequest!;
  const second=client.opts.requestSecret('secret',{},new AbortController().signal); await firstRejected; const current=manager.getState().secureRequest!;
  manager.answerSecret(old,'stale'); manager.cancelSecret(old); expect(manager.getState().secureRequest).toBe(current);
  const secondRejected=expect(second).rejects.toThrow('Request cancelled'); manager.cancelSecret(current); await secondRejected; expect(manager.getState().secureRequest).toBeNull(); manager.dispose();
});

it('clears only its latest recovered draft warning', async () => {
  const manager=new AppManager(); await manager.initialize(); mocks.fail=true; manager.setDraft('s','first'); await flush();
  expect(manager.getState().error).toBe('Could not save your draft.'); mocks.fail=false; manager.setDraft('s','second'); await flush(); expect(manager.getState().error).toBeNull(); manager.dispose();
});

it('does not let an earlier successful checkpoint clear a newer failure or an unrelated error', async () => {
  const manager=new AppManager(); await manager.initialize();
  let release!:()=>void, entered!:()=>void; const blocked=new Promise<void>(resolve=>{release=resolve;}); const started=new Promise<void>(resolve=>{entered=resolve;});
  let count=0; mocks.writeHook=async()=>{ if (++count === 1) { entered(); await blocked; } else throw Error('disk full'); };
  manager.setDraft('s','first'); await started; manager.setDraft('s','second'); release(); await flush();
  expect(manager.getState().error).toBe('Could not save your draft.');
  mocks.writeHook=null; (manager as any).update({error:'Unrelated connection error'}); manager.setDraft('s','third'); await flush();
  expect(manager.getState().error).toBe('Unrelated connection error'); manager.dispose();
});

it('does not apply a captured queued edit after an endpoint change', async () => {
  mocks.rows=new Map(); mocks.secure.set('hermes.baseUrl','https://old.example'); mocks.secure.set('hermes.token','fixture');
  const manager=new AppManager(); await manager.initialize(); await flush();
  const captured=manager.captureDraft('s');
  vi.stubGlobal('fetch',async()=>({ok:true}));
  try {
    await manager.configure({baseUrl:'https://new.example',token:'fixture'});
    manager.replaceCapturedDraft('s',captured,'queued');
    expect(manager.getState().drafts.s ?? '').toBe('');
  } finally { manager.dispose(); vi.unstubAllGlobals(); }
});

it('keeps a replacement secret request alive after cancellation and an old abort', async () => {
  mocks.secure.set('hermes.baseUrl','https://old.example'); mocks.secure.set('hermes.token','fixture');
  const manager=new AppManager(); await manager.initialize(); await flush(); const client=mocks.clients[0];
  const oldAbort=new AbortController(); const oldPromise=client.opts.requestSecret('sudo',{},oldAbort.signal);
  const oldRejected=expect(oldPromise).rejects.toThrow('Request cancelled'); const old=manager.getState().secureRequest!;
  manager.cancelSecret(old); await oldRejected;
  const nextPromise=client.opts.requestSecret('secret',{},new AbortController().signal); const next=manager.getState().secureRequest!;
  oldAbort.abort(); manager.answerSecret(old,'stale'); manager.cancelSecret(old);
  expect(manager.getState().secureRequest).toBe(next);
  manager.answerSecret(next,'new answer'); await expect(nextPromise).resolves.toBe('new answer'); manager.dispose();
});

it('clears a draft warning when a durable send checkpoints the outbox', async () => {
  const manager=new AppManager(); await manager.initialize();
  mocks.fail=true; manager.setDraft('s','send this'); await flush();
  expect(manager.getState().error).toBe('Could not save your draft.');
  mocks.fail=false; await manager.send('s');
  expect(manager.getState().error).toBeNull();
  expect(cachePayload(mocks.saved).outbox[0].text).toBe('send this'); manager.dispose();
});

it('clears a draft warning after a full image checkpoint covers it', async () => {
  const manager=new AppManager(); await manager.initialize();
  mocks.fail=true; manager.setDraft('s','keep this'); await flush();
  expect(manager.getState().error).toBe('Could not save your draft.');
  mocks.fail=false; await manager.setDraftAttachments('s',[{uri:'file:///fixture.png',path:'/new.png',mime:'image/png'}]);
  expect(manager.getState().error).toBeNull(); expect(cachePayload(mocks.saved).drafts.s).toBe('keep this'); manager.dispose();
});

it('does not let an older full checkpoint clear a newer failed draft', async () => {
  const manager=new AppManager(); await manager.initialize();
  mocks.fail=true; manager.setDraft('s','first'); await flush();
  let release!:()=>void, entered!:()=>void; const blocked=new Promise<void>(resolve=>{release=resolve;}); const started=new Promise<void>(resolve=>{entered=resolve;});
  let count=0; mocks.fail=false; mocks.writeHook=async()=>{if (++count === 1) {entered(); await blocked;} else throw Error('disk full');};
  const full=manager.setDraftAttachments('s',[]); await started; manager.setDraft('s','newer'); release(); await full; await flush();
  expect(manager.getState().error).toBe('Could not save your draft.');
  mocks.writeHook=null; (manager as any).update({error:'Unrelated connection error'}); await manager.setDraftAttachments('s',[]);
  expect(manager.getState().error).toBe('Unrelated connection error'); manager.dispose();
});


it('records only the matching typed completion without exporting message content', async () => {
  mocks.secure.set('hermes.baseUrl','https://example.test'); mocks.secure.set('hermes.token','secret');
  const manager=new AppManager(); await manager.initialize(); await flush();
  conversationDiagnostics.setEnabled(true); const submission=await manager.send('s','private words'); await flush();
  const client=mocks.clients[0]; client.opts.onEvent({type:'message.complete',session_id:'s',payload:{text:'unrelated',persisted_turn:{submission_id:'other'}}});
  expect(conversationDiagnostics.export().map(e=>e.stage)).toEqual(['submission_start','submission_saved']);
  client.opts.onEvent({type:'message.complete',session_id:'wrong-session',payload:{text:'other',persisted_turn:{submission_id:submission}}});
  expect(conversationDiagnostics.export().map(e=>e.stage)).toEqual(['submission_start','submission_saved']);
  const event={type:'message.complete',session_id:'s',payload:{text:'private answer',persisted_turn:{submission_id:submission}}};
  client.opts.onEvent(event); client.opts.onEvent(event); const result=conversationDiagnostics.export();
  expect(result.map(e=>e.stage)).toEqual(['submission_start','submission_saved','reply_complete']);
  expect(JSON.stringify(result)).not.toContain('private'); manager.dispose();
});
