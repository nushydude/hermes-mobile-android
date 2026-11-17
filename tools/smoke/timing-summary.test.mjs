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
