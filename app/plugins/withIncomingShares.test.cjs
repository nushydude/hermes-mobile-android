const test = require('node:test');
const assert = require('node:assert/strict');
const { addIncomingShareFilters } = require('./withIncomingShares');

test('adds only scoped share targets and preserves existing activity settings', () => {
  const launcher = {action:[{$:{'android:name':'android.intent.action.MAIN'}}],category:[{$:{'android:name':'android.intent.category.LAUNCHER'}}]};
  const link = {action:[{$:{'android:name':'android.intent.action.VIEW'}}],data:[{$:{'android:scheme':'hermesmobile'}}]};
  const activity = {$:{'android:exported':'true','android:launchMode':'singleTask'},'intent-filter':[launcher,link]};
  addIncomingShareFilters(activity);
  assert.equal(activity.$['android:launchMode'],'singleTask');
  assert.strictEqual(activity['intent-filter'][0],launcher);
  assert.strictEqual(activity['intent-filter'][1],link);
  const shares = activity['intent-filter'].slice(2);
  assert.deepEqual(shares.map(f=>[f.action[0].$['android:name'],f.data[0].$['android:mimeType']]),[
    ['android.intent.action.SEND','text/plain'],
    ['android.intent.action.SEND','image/*'],
    ['android.intent.action.SEND_MULTIPLE','image/*'],
  ]);
  assert.ok(shares.every(f=>f.category[0].$['android:name']==='android.intent.category.DEFAULT'));
  addIncomingShareFilters(activity);
  assert.equal(activity['intent-filter'].length,5);
});

test('keeps an existing compatible filter and adds missing types only', () => {
  const existing={action:[{$:{'android:name':'android.intent.action.SEND'}}],category:[{$:{'android:name':'android.intent.category.DEFAULT'}}],data:[{$:{'android:mimeType':'text/plain'}}]};
  const activity={'intent-filter':[existing]};
  addIncomingShareFilters(activity);
  assert.strictEqual(activity['intent-filter'][0],existing);
  assert.equal(activity['intent-filter'].length,3);
});
