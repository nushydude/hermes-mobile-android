import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { summarize, parseLiveArgs, runDirectory } from './timing-summary.mjs';

test('gate and directory isolate runs before credentials',()=>{
  assert.throws(()=>parseLiveArgs([]));assert.throws(()=>parseLiveArgs(['--run-live','--arm','private-value']));
  assert.deepEqual(parseLiveArgs(['--run-live','--arm','candidate']),{arm:'candidate'});
  assert.notEqual(runDirectory('candidate'),runDirectory('candidate'));assert.throws(()=>runDirectory('candidate','../bad'));
  const run=spawnSync(process.execPath,['tools/smoke/voice-latency.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.equal(run.status,2);assert.match(run.stderr,/Explicit --run-live/);assert.doesNotMatch(run.stderr,/HERMES_MOBILE_GATEWAY_URL|credential/i);
});
test('compares arms and counts failures and missing values separately',()=>{
  const summary=summarize([{arm:'baseline',result:'passed',timings_ms:{transcription:10}},{arm:'baseline',result:'passed',timings_ms:{transcription:20}},{arm:'baseline',result:'failed',timings_ms:{transcription:99}},{arm:'candidate',result:'incomplete',timings_ms:{}}]);
  assert.deepEqual(summary.baseline.stages.transcription,{n:2,missing:1,median:15,p95:20});
  assert.equal(summary.baseline.failures,1);assert.equal(summary.candidate.incomplete,1);assert.equal(summary.candidate.stages.transcription.median,null);
});
test('summarizes one numeric voice trace, excluding incomplete measurements',()=>{
  const events=[{trace:2,stage:'transcription_start',elapsedMs:5},{trace:2,stage:'transcription_end',elapsedMs:25},{trace:2,stage:'reply_complete',elapsedMs:40}];
  const summary=summarize([{arm:'candidate',result:'passed',events}]);
  assert.equal(summary.candidate.stages.stt_tail.median,20);assert.equal(summary.candidate.stages.audio_after_reply.missing,1);
});
test('rejects private fields, nonfinite durations, malformed traces and mixed types',()=>{
  for(const input of [
    {arm:'baseline',result:'passed',timings_ms:{transcription:NaN}},
    {arm:'baseline',result:'passed',timings_ms:{private:'secret'}},
    {arm:'baseline',result:'passed',timings_ms:{},secret:'secret'},
    {arm:'baseline',result:'passed',events:[{trace:1,stage:'capture_end',elapsedMs:4,text:'secret'}]},
    {arm:'baseline',result:'passed',events:[{trace:1,stage:'capture_end',elapsedMs:4},{trace:2,stage:'capture_end',elapsedMs:5}]},
  ]) assert.throws(()=>summarize([input]));
  assert.throws(()=>summarize([{arm:'baseline',result:'passed',timings_ms:{}},{arm:'baseline',result:'passed',events:[]}]));
});
test('derives new trace intervals from submit, first delta and synthesis stages',()=>{
  const events=[{trace:3,stage:'submission_start',elapsedMs:0},{trace:3,stage:'submission_saved',elapsedMs:12},{trace:3,stage:'submit_sent',elapsedMs:30},{trace:3,stage:'first_delta',elapsedMs:900},{trace:3,stage:'reply_complete',elapsedMs:2000},{trace:3,stage:'tts_request_start',elapsedMs:2010},{trace:3,stage:'tts_ready',elapsedMs:3200}];
  const {stages}=summarize([{arm:'baseline',result:'passed',events}]).baseline;
  assert.equal(stages.send_after_save.median,18);assert.equal(stages.first_delta_after_submit.median,900);assert.equal(stages.tts_synthesis.median,1190);assert.equal(stages.audio_after_reply.missing,1);
});
test('prints nearest-rank percentiles for duration samples and sums render counts',()=>{
  const persist=Array.from({length:20},(_,n)=>({name:'persist_ms',ms:n+1,chars:1000*(n+1)}));
  const summary=summarize([
    {arm:'baseline',result:'passed',samples:[...persist,{name:'session_open_ms',ms:250}],renders:{chat_screen:40,message_input:80}},
    {arm:'baseline',result:'passed',samples:[{name:'session_open_ms',ms:150}],renders:{chat_screen:2}},
    {arm:'baseline',result:'failed',samples:[{name:'session_open_ms',ms:99999}],renders:{chat_screen:1000}},
    {arm:'candidate',result:'passed',events:[{trace:1,stage:'submission_start',elapsedMs:0}],samples:[{name:'connect_ready_ms',ms:700}]},
  ]);
  assert.deepEqual(summary.baseline.samples.persist_ms,{n:20,p50:10,p90:18,p95:19,max:20,chars:{n:20,p50:10000,p90:18000,p95:19000,max:20000}});
  assert.deepEqual(summary.baseline.samples.session_open_ms,{n:2,p50:150,p90:250,p95:250,max:250});
  assert.deepEqual(summary.baseline.renders,{chat_screen:42,message_input:80});
  assert.equal(summary.baseline.runs,3);assert.equal(summary.baseline.failures,1);
  assert.deepEqual(summary.candidate.samples.connect_ready_ms,{n:1,p50:700,p90:700,p95:700,max:700});
});
test('rejects samples or render counts that could carry content',()=>{
  for(const input of [
    {arm:'baseline',result:'passed',samples:[{name:'persist_ms',ms:3,text:'secret'}]},
    {arm:'baseline',result:'passed',samples:[{name:'private',ms:3}]},
    {arm:'baseline',result:'passed',samples:[{name:'persist_ms',ms:NaN}]},
    {arm:'baseline',result:'passed',samples:[{name:'persist_ms',ms:3,chars:-1}]},
    {arm:'baseline',result:'passed',samples:{name:'persist_ms',ms:3}},
    {arm:'baseline',result:'passed',renders:{secret:1}},
    {arm:'baseline',result:'passed',renders:{chat_screen:1.5}},
  ]) assert.throws(()=>summarize([input]));
});
