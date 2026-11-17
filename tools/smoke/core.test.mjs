import test from 'node:test';
import assert from 'node:assert/strict';
import {RpcError,mutateWithRetry,latestVersion,reconstructDeltas,armDisconnect,findCompletion,isDisconnectTrigger,findHandoffEvent,imageAnswerMatches} from './core.mjs';

test('revision retry carries fresh fence, preserves request id, and retries at most once', async () => {
  const calls=[];
  const params={request_id:'stable',expected_revision:1,operation:'rename'};
  const call=async (_,p) => { calls.push(p); if (calls.length===1) throw new RpcError('session.mutate',4001,'revision_conflict',{reason:'revision_conflict',revision:8,execution_generation:3,secret:'ignore'}); return {revision:9}; };
  assert.deepEqual(await mutateWithRetry(call,params),{revision:9});
  assert.equal(calls[1].request_id,'stable'); assert.equal(calls[1].expected_revision,8);
  let attempts=0;
  await assert.rejects(mutateWithRetry(async()=>{attempts++;throw new RpcError('session.mutate',4001,'x',{reason:'revision_conflict',revision:8,execution_generation:3});},params));
  assert.equal(attempts,2);
});
test('stale generation uses fresh values and unrelated errors never retry', async () => {
  const seen=[];
  await mutateWithRetry(async(_,p)=>{seen.push(p);if(seen.length===1) throw new RpcError('session.mutate',4001,'x',{reason:'stale_generation',revision:4,execution_generation:7});return {};},{request_id:'x',expected_revision:2,expected_generation:1});
  assert.equal(seen[1].expected_generation,7); assert.equal(seen[1].expected_revision,4);
  let calls=0; await assert.rejects(mutateWithRetry(async()=>{calls++;throw new RpcError('x',4001,'x',{reason:'invalid_params'});},{})); assert.equal(calls,1);
});
const delta=(seq,offset,text)=>({session_id:'s',type:'message.delta',seq,payload:{segment:0,offset,text}});
test('overlapping replay and live frames reconstruct UTF-16 chunks without duplication', () => {
  const a=delta(1,0,'A😀'), b=delta(2,3,'BC'), c=delta(3,4,'C!');
  assert.equal(reconstructDeltas([a,b,a,c,b],'s'),'A😀BC!');
  assert.throws(()=>reconstructDeltas([a,delta(2,4,'x')],'s'),/gap/i);
  assert.throws(()=>reconstructDeltas([a,delta(2,1,'X')],'s'),/conflicting/i);
});
test('disconnect is synchronous on first matching delta, and never after buffered completion', () => {
  const channel={events:[],close(){this.closed=true;}};
  const on=armDisconnect(channel,'s');
  on(delta(0,0,null)); assert.notEqual(channel.closed,true);
  assert.equal(isDisconnectTrigger(delta(0,0,null)),false);
  assert.equal(isDisconnectTrigger(delta(0,0,'')),false);
  on(delta(1,0,'hello')); assert.equal(channel.closed,true);
  const late={events:[{session_id:'s',type:'message.complete'}],close(){this.closed=true;}};
  armDisconnect(late,'s')(delta(1,0,'hello')); assert.notEqual(late.closed,true);
});
test('revision tracker ignores other sessions and stale revision',()=>{
  assert.deepEqual(latestVersion([{session_id:'other',type:'session.info',payload:{revision:99}},{session_id:'s',type:'session.info',payload:{revision:2,execution_generation:4}}],'s',3,1),{revision:3,generation:4});
});
test('completion arriving during resume or in follow-up replay is found',()=>{
  const done={session_id:'s',type:'message.complete',payload:{status:'complete'}};
  const other={session_id:'other',type:'message.complete'};
  assert.equal(findCompletion('s',[],[other,done]),done);
  assert.equal(findCompletion('s',[other],[],[done]),done);
  assert.equal(findCompletion('s',[other],[]),undefined);
});
test('handoff settlement checkpoint ignores earlier events and unrelated prompt IDs',()=>{
  const events=[{session_id:'s',type:'approval.settled',payload:{prompt_id:'old'}},{session_id:'s',type:'approval.settled',payload:{prompt_id:'other'}}];
  const settlement=e=>e.type==='approval.settled';
  assert.equal(findHandoffEvent(events,1,'s',settlement,'old'),undefined);
  assert.equal(findHandoffEvent(events,0,'s',settlement,'new'),undefined);
  events.push({session_id:'s',type:'approval.settled',payload:{prompt_id:'new'}});
  assert.equal(findHandoffEvent(events,1,'s',settlement,'new').index,2);
});
test('image response must associate each expected colour with the correct side',()=>{
  assert.equal(imageAnswerMatches('- Left half: blue\n- Right half: red'),false);
  assert.equal(imageAnswerMatches('The left is not red and the right is not blue.'),false);
  assert.equal(imageAnswerMatches('{"left":"blue","right":"red"}'),false);
  assert.equal(imageAnswerMatches('{"left":"red","right":"blue"}'),true);
  assert.equal(imageAnswerMatches('```json\n{"left":"red","right":"blue"}\n```'),true);
  assert.equal(imageAnswerMatches('{"left":"red","right":"blue","other":"red"}'),false);
  assert.equal(imageAnswerMatches('Left and right have red and blue.'),false);
});
