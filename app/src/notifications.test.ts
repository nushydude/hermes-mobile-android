import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({seen:new Set<string>(),shown:new Map<string,any>(), display:vi.fn(async (n:any) => { if (m.failDisplay) throw Error('display'); m.shown.set(n.id,n); }), cancel:vi.fn(async (id:string) => {m.shown.delete(id);}), stop:vi.fn(async () => { if (m.stopGate) await m.stopGate; }), state:{credentialsConfigured:true,connection:'ready',chats:{} as Record<string,any>,activeSessionId:null as string|null,sessions:[] as Array<{id:string;title:string}>}, mode:'off', change:undefined as undefined|(()=>void), appChange:undefined as undefined|(()=>void), runner:undefined as any, bg:undefined as any, fg:undefined as any, link:undefined as any, origin:'https://example.test', gate:null as null|Promise<void>, stopGate:null as null|Promise<void>, initialFail:false, openFail:false, failDisplay:false, queries:[] as string[]}));
vi.mock('@notifee/react-native', () => ({default:{createChannel:vi.fn(async()=>{if (m.gate) await m.gate;}),displayNotification:m.display,cancelNotification:m.cancel,getDisplayedNotifications:async()=>Array.from(m.shown.values()).map(notification=>({notification})),stopForegroundService:m.stop,registerForegroundService:(fn:any)=>{m.runner=fn;},onBackgroundEvent:(fn:any)=>{m.bg=fn;},onForegroundEvent:(fn:any)=>{m.fg=fn;return ()=>{};},getInitialNotification:async()=>{if(m.initialFail) throw Error('initial');return null;},requestPermission:vi.fn()},AndroidForegroundServiceType:{FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING:512},AndroidImportance:{DEFAULT:3,LOW:2},AndroidStyle:{BIGTEXT:1},AndroidVisibility:{PRIVATE:0},EventType:{PRESS:1,ACTION_PRESS:2}}));
vi.mock('react-native', () => ({AppState:{currentState:'active',addEventListener:(_n:string,fn:any)=>{m.appChange=fn;return {remove(){}};}},Linking:{addEventListener:(_n:string,fn:any)=>{m.link=fn;return {remove(){}};},getInitialURL:async()=>{if(m.initialFail)throw Error('initial');return null;}}}));
vi.mock('expo-sqlite', () => ({openDatabaseSync:()=>({execSync(){},getFirstSync:(_sql:string,key:string)=>m.seen.has(key)?{key}:null,runSync:(sql:string,key:string)=>{m.queries.push(sql);if (sql.startsWith('INSERT')) {if(m.seen.has(key))return {changes:0};m.seen.add(key);return {changes:1};}return {changes:0};}})}));
vi.mock('./state', () => ({appManager:{getState:()=>m.state,getConfiguredOrigin:()=>m.origin,subscribe:(fn:any)=>{m.change=fn;return ()=>{};},initialize:async()=>{},openSession:async()=>{if(m.openFail)throw Error('open');}}}));
vi.mock('./preferences', () => ({getMonitorMode:()=>m.mode,subscribeMonitorMode:()=>()=>{}}));
import { AppState } from 'react-native';
import { getMonitorStatus, notifyEvent, reconcileSnapshot, registerNotifications, setupNotifications } from './notifications';
const event = {type:'approval.request',session_id:'s',replay_epoch:'e',seq:1,execution_generation:2,payload:{prompt_id:'p',choices:['once','deny','always']}};
beforeEach(()=>{m.seen.clear();m.shown.clear();m.display.mockClear();m.cancel.mockClear();m.origin='https://example.test';m.gate=null;m.failDisplay=false;m.openFail=false;m.initialFail=false;m.queries=[];m.state.activeSessionId=null;m.state.sessions=[];});
describe('native notification adapter',()=>{
 it('persists a child terminal identity across replays and ignores unconfirmed outcomes',async()=>{
  const task={type:'subagent.complete',session_id:'s',payload:{subagent_id:'child',status:'completed',summary:'private'}};
  await notifyEvent(m.origin,task);
  await notifyEvent(m.origin,{...task,seq:9,replay_epoch:'new'});
  await notifyEvent(m.origin,{...task,payload:{...task.payload,status:'failed'}});
  await notifyEvent(m.origin,{...task,payload:{...task.payload,subagent_id:'other',status:'running'}});
  expect(m.display).toHaveBeenCalledTimes(1);
  expect(m.seen.size).toBe(1);
  expect(m.display.mock.calls[0][0].body).not.toContain('private');
 });
 it('deduplicates live replay and snapshots and cancels settled prompts',async()=>{
  await notifyEvent('https://example.test',event);
  await notifyEvent('https://example.test',event);
  await reconcileSnapshot('https://example.test','s',{execution_generation:2,prompts:[event.payload]});
  expect(m.display).toHaveBeenCalledTimes(1);
  expect(m.display.mock.calls[0][0].android.actions.map((a:any)=>a.pressAction.id)).toEqual(['once','deny']);
  await reconcileSnapshot('https://example.test','s',{prompts:[]});
  expect(m.cancel).toHaveBeenCalledTimes(1);
 });
 it('previews the final reply, replaces only that session alert, and keeps routing',async()=>{
  m.state.sessions=[{id:'s',title:'PC upgrade'}];
  const complete={...event,type:'message.complete',payload:{status:'complete',text:'**Try a faster SSD.**'}};
  await notifyEvent(m.origin,complete);
  const first=m.display.mock.calls[0][0];
  expect(first.title).toBe('PC upgrade · Reply ready');
  expect(first.body).toBe('Try a faster SSD.');
  expect(first.android.style.text).toBe('Try a faster SSD.');
  expect(first.android.visibility).toBe(0);
  expect(first.data).toMatchObject({origin:m.origin,session:'s',url:'hermesmobile://session/s'});
  await notifyEvent(m.origin,{...complete,seq:2});
  expect(m.display.mock.calls[1][0].id).toBe(first.id);
  await notifyEvent(m.origin,{...complete,session_id:'other',seq:3});
  expect(m.display.mock.calls[2][0].id).not.toBe(first.id);
 });
 it('does not display for the visible chat',async()=>{m.state.activeSessionId='s';await notifyEvent('https://example.test',event); expect(m.display).not.toHaveBeenCalled(); expect(m.seen.size).toBe(1);});
 it('filters stream events before a blocked native operation',async()=>{
  let release!:()=>void; m.gate=new Promise<void>(r=>{release=r;});
  const blocked=notifyEvent('https://example.test',event); await Promise.resolve();
  let finished=false; await notifyEvent('https://example.test',{type:'message.delta',payload:{text:'large'}}).then(()=>{finished=true;});
  expect(finished).toBe(true); release(); await blocked;
 });
 it('rechecks visibility and origin after native channel creation',async()=>{
  let release!:()=>void; m.gate=new Promise<void>(r=>{release=r;});
  const waiting=notifyEvent('https://example.test',event); await Promise.resolve(); await Promise.resolve();
  m.state.activeSessionId='s'; release(); await waiting; expect(m.display).not.toHaveBeenCalled(); expect(m.seen.size).toBe(1);
  m.seen.clear(); m.state.activeSessionId=null; m.gate=new Promise<void>(r=>{release=r;});
  const old=notifyEvent('https://example.test',event); await Promise.resolve(); await Promise.resolve(); m.origin='https://new.test'; release(); await old;
  expect(m.display).not.toHaveBeenCalled(); expect(m.seen.size).toBe(0);
 });
 it('retries failed display and bounds the ledger after successful display',async()=>{
  m.failDisplay=true; await expect(notifyEvent('https://example.test',event)).rejects.toThrow(); expect(m.seen.size).toBe(0);
  m.failDisplay=false; await notifyEvent('https://example.test',event); expect(m.display).toHaveBeenCalledTimes(2); expect(m.seen.size).toBe(1);
  expect(m.queries.some(sql=>sql.includes('OFFSET 4096'))).toBe(true);
 });
 it('handles initial link and foreground routing failures',async()=>{
  m.initialFail=true; m.openFail=true; const cleanup=setupNotifications();
  m.link({url:'hermesmobile://session/s'}); m.fg({type:1,detail:{notification:{data:{url:'hermesmobile://session/s',origin:'https://example.test'}}}});
  await new Promise(r=>setTimeout(r,0)); cleanup();
 });
 it('registers headless callbacks early and starts only while activity is active',async()=>{
  registerNotifications(); expect(m.runner).toBeTypeOf('function'); expect(m.bg).toBeTypeOf('function');
  m.mode='always'; const cleanup=setupNotifications(); await new Promise(r=>setTimeout(r,0));
  expect(m.display).toHaveBeenCalledWith(expect.objectContaining({id:'hermes-monitor'}));
  expect(getMonitorStatus()).toBe('running');
  m.display.mockClear(); m.state.connection='reconnecting'; m.failDisplay=true; m.change?.(); await new Promise(r=>setTimeout(r,0)); m.failDisplay=false; m.change?.(); await new Promise(r=>setTimeout(r,0)); expect(m.display).toHaveBeenCalledWith(expect.objectContaining({id:'hermes-monitor',body:'Connection: reconnecting'}));
  let releaseStop!:()=>void; m.stopGate=new Promise<void>(r=>{releaseStop=r;}); m.mode='off'; m.change?.(); await Promise.resolve(); m.mode='always'; m.change?.(); releaseStop(); m.stopGate=null; await new Promise(r=>setTimeout(r,0)); expect(m.display.mock.calls.filter(([n])=>n.id==='hermes-monitor').length).toBeGreaterThanOrEqual(2);
  m.stop.mockClear(); vi.useFakeTimers(); m.mode='whileturnruns'; m.change?.(); expect(getMonitorStatus()).toBe('finishing'); await vi.advanceTimersByTimeAsync(3*60*1000); expect(m.stop).toHaveBeenCalledTimes(1); expect(getMonitorStatus()).toBe('waiting');
  m.display.mockClear(); (AppState as any).currentState='background'; m.mode='always'; m.change?.(); await vi.advanceTimersByTimeAsync(0); expect(m.display).not.toHaveBeenCalled();
  (AppState as any).currentState='active'; m.appChange?.(); await vi.advanceTimersByTimeAsync(0); expect(m.display).toHaveBeenCalledWith(expect.objectContaining({id:'hermes-monitor'}));
  vi.useRealTimers(); cleanup();
 });
});
