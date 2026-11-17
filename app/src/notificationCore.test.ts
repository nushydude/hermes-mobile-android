import { describe, expect, it } from 'vitest';
import { eventKey, safeChoices, sessionFromUrl, sessionUrl, validAction } from './notificationCore';
describe('notification safety', () => {
  it('round trips opaque session IDs and rejects unrelated or credential-bearing URLs', () => {
    expect(sessionFromUrl(sessionUrl('a/b ?'))).toBe('a/b ?');
    for (const url of ['https://session/a','hermesmobile://session/a?token=x','hermesmobile://user@session/a','hermesmobile://session/a/b','hermesmobile://session/%00']) expect(sessionFromUrl(url)).toBeNull();
  });
  it('keys event replay by endpoint, session, epoch and sequence', () => {
    const event = {session_id:'s',replay_epoch:'e',seq:3};
    expect(eventKey('https://one',event)).toBe(eventKey('https://one',{...event}));
    expect(eventKey('https://two',event)).not.toBe(eventKey('https://one',event));
    expect(eventKey('https://one',{...event,seq:undefined})).toBeNull();
  });
  it('permits only freshly offered safe actions for the same origin and generation', () => {
    const data = {origin:'https://one',session:'s',prompt:'p',generation:'4'};
    const snap = {session_id:'s',execution_generation:4,prompts:[{prompt_id:'p',choices:['once','deny','always']}]};
    expect(safeChoices(snap.prompts[0].choices)).toEqual(['once','deny']);
    expect(validAction(data,'https://one',snap,'once')).toBe(true);
    expect(validAction(data,'https://two',snap,'once')).toBe(false);
    expect(validAction(data,'https://one',{...snap,execution_generation:5},'once')).toBe(false);
    expect(validAction(data,'https://one',{...snap,prompts:[]},'deny')).toBe(false);
    expect(validAction(data,'https://one',snap,'always')).toBe(false);
    expect(validAction(data,'https://one',{...snap,prompts:[{prompt_id:'p',question:'?',choices:['once']}]},'once')).toBe(false);
  });
});
