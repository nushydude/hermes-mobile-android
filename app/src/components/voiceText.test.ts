import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { speechParts, speechText } from './voiceText';
describe('assistant speech',()=>{
 it('initializes the shared Markdown renderer',()=>expect(new MarkdownIt().render('Hello **Hermes**')).toContain('<strong>Hermes</strong>'));
 it('reads Markdown labels and identifiers while replacing code and images',()=>{const text='Hello **world** &amp; [nested *label*](https://example.com/a) `thing.id` ![alt](image.png)\n\n```js\nsecret()\n```\n\n    indented()';expect(speechText(text)).toBe('Hello world & nested label thing.id Image in chat. The code is in chat. The code is in chat.');});
 it('keeps code-only content readable without exposing code',()=>expect(speechText('```\nsecret\n```')).toBe('The code is in chat.'));
 it('splits all prose without breaking emoji or dropping content',()=>{const text=('Hello 😀 world. ').repeat(500);const parts=speechParts(text);expect(parts.every(p=>p.length<=2000&&!/[\uD800-\uDBFF]$/.test(p))).toBe(true);expect(parts.join(' ').replace(/\s+/g,' ').trim()).toBe(text.trim());});
 it('removes bare URLs and HTML markup without falling back to raw text',()=>{expect(speechText('Visit https://example.com/a and www.example.com 😀')).toBe('Visit and 😀');expect(speechText('<div>private markup</div>')).toBe('');expect(speechText('https://example.com')).toBe('');});
 it('rejects invalid part limits and never splits a surrogate pair at the smallest limit',()=>{for(const limit of [0,1,4001,2.5,NaN])expect(()=>speechParts('😀',limit)).toThrow(RangeError);expect(speechParts('😀😀',2)).toEqual(['😀','😀']);});
});
