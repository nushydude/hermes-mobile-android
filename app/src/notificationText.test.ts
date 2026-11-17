import { describe, expect, it } from 'vitest';
import { notificationLiteral, notificationText } from './notificationText';

describe('notification copy', () => {
  it('uses final reply content, removes Markdown decoration and bounds both previews', () => {
    const copy = notificationText('message.complete', {text:'# Result\n\n**Good news**: [read this](https://example.test).\n\n' + 'Useful detail. '.repeat(1000)}, 'PC upgrade');
    expect(copy.title).toBe('PC upgrade · Reply ready');
    expect(copy.body).toMatch(/^Result Good news: read this\./);
    expect(Array.from(copy.body)).toHaveLength(180);
    expect(Array.from(copy.expanded)).toHaveLength(600);
  });
  it('keeps interrupted, failed and empty replies distinct without exposing raw errors', () => {
    expect(notificationText('message.complete', {status:'interrupted',text:'partial'}, null).title).toBe('Your chat · Task stopped');
    const failed = notificationText('message.complete', {status:'error',error:'credential',text:'partial'}, 'Chat');
    expect(failed.title).toBe('Chat · Couldn’t finish');
    expect(failed.body).not.toContain('credential');
    expect(failed.body).not.toContain('partial');
    expect(notificationText('message.complete', {text:{unknown:'value'}}, '').body).toContain('Open this chat');
  });
  it('previews questions but keeps approval commands and reasoning out of alerts', () => {
    const payload = {question:'**Which drive?**',command:'secret command',reasoning:'private thought'};
    expect(notificationText('clarify.request',payload,'Hardware').body).toBe('Which drive?');
    const approval = notificationText('approval.request',payload,'Hardware');
    expect(approval.title).toBe('Hardware · Approval needed');
    expect(approval.body).not.toMatch(/secret|private|Which/);
  });
  it('omits code blocks and renders text literally without splitting emoji', () => {
    const copy = notificationText('message.complete', {text:'Done\n```sh\nlarge output\n```\nA & B < C'}, 'a\n\u202eb');
    expect(copy.title).toBe('a b · Reply ready');
    expect(copy.body).toContain('[Code in chat]');
    expect(copy.body).not.toContain('large output');
    expect(notificationLiteral(copy.body)).toContain('A &amp; B &lt; C');
    const emoji = notificationText('message.complete',{text:'😀'.repeat(700)},'Chat');
    expect(emoji.expanded).toBe('😀'.repeat(599)+'…');
  });
});
