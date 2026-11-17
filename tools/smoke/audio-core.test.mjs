import {test} from 'node:test'; import assert from 'node:assert/strict';
import {transcriptDiagnostic,matchedTranscript,numberRendering,audioMime,completionFor,metadata,compareMetadata,userRows,boundedBytes} from './audio-core.mjs';
test('validates only expected short synthetic transcript',()=>{assert.equal(matchedTranscript('Remember the blue lantern number seven.'),'remember the blue lantern number seven');assert.equal(matchedTranscript('Remember the blue lantern number eight.'),null);assert.equal(matchedTranscript('Remember the blue lantern number seven.\nprivate'),null);assert.equal(matchedTranscript('x'.repeat(301)),null);});
test('accepts bounded audio types and guards admission matching',()=>{assert.equal(audioMime('audio/mpeg; charset=binary'),'audio/mpeg');assert.equal(audioMime('application/json'),null);const events=[{type:'message.complete',session_id:'s',admission_id:'old'},{type:'message.complete',session_id:'other',admission_id:'new'},{type:'message.complete',session_id:'s',admission_id:'new'}];assert.equal(completionFor(events,0,'s',{admission_id:'new'}),events[2]);assert.equal(completionFor(events,3,'s',{admission_id:'new'}),undefined);});
test('unknown model or effort is unverified and transcript duplicates are detected',()=>{assert.deepEqual(compareMetadata(metadata({info:{model:'a',provider:'p',reasoning_effort:'high'}}),metadata({info:{model:'a',provider:'p'}})),{model:true,provider:true,effort:null});assert.equal(userRows([{role:'user',text:'x'},{role:'user',text:'x'},{role:'assistant',text:'x'}],'x').length,2);});
test('refuses announced and streamed oversized response bodies',async()=>{await assert.rejects(boundedBytes(new Response('12345',{headers:{'content-length':'5'}}),4));await assert.rejects(boundedBytes(new Response('12345'),4));assert.equal(new TextDecoder().decode(await boundedBytes(new Response('abc'),4)),'abc');});

test('transcription diagnostics expose only fixture vocabulary, even on invalid or oversized text',()=>{
 assert.deepEqual(transcriptDiagnostic('Remember THE secret! 7.'),{transcript_empty:false,transcript_word_count:4,transcript_tokens:['remember','the','[other]','7'],transcript_tokens_truncated:false});
 assert.deepEqual(transcriptDiagnostic('  '),{transcript_empty:true,transcript_word_count:0,transcript_tokens:[],transcript_tokens_truncated:false});
 const result=transcriptDiagnostic(Array(70).fill('private').join(' '));assert.equal(result.transcript_word_count,70);assert.equal(result.transcript_tokens.length,64);assert.equal(result.transcript_tokens_truncated,true);assert.ok(result.transcript_tokens.every(x=>x==='[other]'));
});

test('accepts only exact number word or numeral without fuzzy word matching',()=>{
 assert.equal(matchedTranscript('Remember the blue lantern number seven.'),'remember the blue lantern number seven');
 assert.equal(matchedTranscript('Remember the blue lantern number 7.'),'remember the blue lantern number seven');
 assert.equal(numberRendering('Remember the blue lantern number seven.'),'word');
 assert.equal(numberRendering('Remember the blue lantern number 7.'),'digit');
 assert.equal(matchedTranscript('Remember the blue lantern number eight.'),null);
 assert.equal(matchedTranscript('Remember the blue ladder number 7.'),null);
 assert.equal(numberRendering('Remember the blue ladder number 7.'),null);
});

test('completion requires a matching admission identity, including on interleaved events',()=>{
 const events=[{type:'message.complete',session_id:'s'},{type:'message.complete',session_id:'s',admission_id:'other'},{type:'message.complete',session_id:'s',admission_id:'own'}];
 assert.equal(completionFor(events,0,'s',{admission_id:'own'}),events[2]);
 assert.equal(completionFor(events,0,'s',{}),undefined);
 assert.equal(completionFor(events.slice(0,2),0,'s',{admission_id:'own'}),undefined);
});
