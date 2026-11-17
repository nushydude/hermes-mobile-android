import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactActivity, emptyChat, mergeSessions, reduceEvent, snapshotChat } from './reducer.ts';

test('inventory merges stored aliases into live owner and preserves live fields', () => {
  const rows = mergeSessions([{id:'owner', title:'Live', running:true}], [{id:'stored', resolved_id:'owner', title:'Old', cwd:'C:/work'}]);
  assert.equal(rows.length, 1); assert.equal(rows[0].title, 'Live'); assert.equal(rows[0].cwd, 'C:/work');
});
test('approval settlement removes only its matching prompt', () => {
  let chat = emptyChat();
  chat = reduceEvent(chat, {type:'approval.request', payload:{prompt_id:'a'}});
  chat = reduceEvent(chat, {type:'clarify.request', payload:{prompt_id:'b'}});
  chat = reduceEvent(chat, {type:'approval.settled', payload:{prompt_id:'a'}});
  assert.deepEqual(chat.prompts.map(p => p.prompt_id), ['b']);
});
test('rebuild discards partial stream and takes authoritative snapshot', () => {
  let chat = reduceEvent(emptyChat(), {type:'message.delta', payload:{text:'partial'}});
  chat = snapshotChat({session_id:'s', messages:[{role:'assistant',text:'saved'}], running:false}, chat, true);
  assert.equal(chat.liveText, ''); assert.equal(chat.messages.length, 1);
});

test('idle resume retires a partial reply that completed offline', () => {
  let chat = reduceEvent(emptyChat(), {type:'message.delta', payload:{text:'old partial'}});
  chat = snapshotChat({session_id:'s', messages:[{role:'assistant',text:'complete'}], running:false}, chat);
  assert.equal(chat.liveText, ''); assert.equal(chat.messages[0].text, 'complete');
});

test('idle live sessions sort before newer stored history', () => {
  const rows = mergeSessions([{id:'live', running:false, last_active_at:1}], [{id:'history', last_active_at:999}]);
  assert.deepEqual(rows.map(row => [row.id, row.is_live]), [['live', true], ['history', false]]);
});

test('reasoning deltas retain all text in one card and preserve essential events', () => {
  let chat=emptyChat();
  for(let n=0;n<4000;n++)chat=reduceEvent(chat,{type:n%2?'thinking.delta':'reasoning.delta',payload:{turn_id:'t',text:'word '}});
  assert.equal(chat.blocks.length,1); assert.equal(chat.blocks[0].payload.text,'word '.repeat(4000));
  chat=reduceEvent(chat,{type:'reasoning.delta',payload:{turn_id:'other',text:'next'}});
  chat=reduceEvent(chat,{type:'notice',payload:{message:'notice'}}); chat=reduceEvent(chat,{type:'error',payload:{message:'error'}});
  chat=reduceEvent(chat,{type:'approval.request',payload:{prompt_id:'approve'}}); chat=reduceEvent(chat,{type:'clarify.request',payload:{prompt_id:'clarify'}});
  assert.equal(chat.blocks.length,4); assert.equal(chat.prompts.length,2);
});
test('tool progress updates one card without dropping arguments, results or image metadata', () => {
  const events=[{type:'tool.start',payload:{tool_id:'a',name:'terminal',args:{command:'Get-Date'}}},{type:'tool.progress',payload:{tool_id:'a',percent:50,message:'working'}},{type:'notice',payload:{message:'keep'}},{type:'tool.complete',payload:{tool_id:'a',result_text:'done',image_path:'C:/image.png'}}];
  const blocks=compactActivity(events); assert.equal(blocks.length,2); assert.equal(blocks[0].payload.args.command,'Get-Date'); assert.equal(blocks[0].payload.result_text,'done'); assert.equal(blocks[0].payload.image_path,'C:/image.png'); assert.equal(blocks[1].type,'notice');
});

test('session info merges partial metadata without changing snapshot fences', () => {
  let chat=snapshotChat({session_id:'s',revision:4,execution_generation:2,last_sequence:12,info:{model:'old',reasoning_effort:'low',provider:'p'},messages:[],running:false});
  chat=reduceEvent(chat,{type:'session.info',payload:{model:'new',reasoning_effort:'high',running:true,pending:[{id:'a'}]}});
  assert.equal(chat.snapshot.info.model,'new'); assert.equal(chat.snapshot.info.reasoning_effort,'high'); assert.equal(chat.snapshot.info.provider,'p');
  assert.equal(chat.snapshot.revision,4); assert.equal(chat.snapshot.execution_generation,2); assert.equal(chat.snapshot.last_sequence,12);
  assert.equal(chat.running,true); assert.equal(chat.pending.length,1);
  chat=reduceEvent(chat,{type:'session.info',payload:{model:'newer'}});
  assert.equal(chat.snapshot.info.reasoning_effort,'high'); assert.equal(chat.snapshot.info.model,'newer');
  assert.equal(reduceEvent(emptyChat(),{type:'session.info',payload:{model:'new'}}).snapshot,null);
});
