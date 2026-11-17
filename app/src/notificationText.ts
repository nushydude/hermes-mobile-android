import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({html:true});
function compact(value: string, limit: number) {
  const characters = Array.from(value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/gu, ' ').trim());
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : characters.join('');
}
function preview(value: unknown): string {
  if (typeof value !== 'string') return '';
  const words: string[] = [];
  for (const token of markdown.parse(value.slice(0, 16000), {})) {
    if (token.type === 'fence' || token.type === 'code_block') words.push(' [Code in chat] ');
    if (token.type !== 'inline') continue;
    for (const child of token.children ?? []) {
      if (child.type === 'text' || child.type === 'code_inline') words.push(child.content);
      else if (child.type === 'image') words.push(' [Image] ');
      else if (child.type === 'softbreak' || child.type === 'hardbreak') words.push(' ');
    }
    words.push(' ');
  }
  return compact(words.join(''), 600);
}
/** Only final reply text and clarification questions become previews; never reasoning or commands. */
export function notificationText(type: string, payload: Record<string, unknown>, sessionTitle: unknown) {
  const session = typeof sessionTitle === 'string' ? compact(sessionTitle.slice(0, 1000), 80) : '';
  let status: string, detail: string;
  if (type === 'approval.request') {
    status = 'Approval needed'; detail = 'Hermes needs your permission before continuing. Open this chat to review.';
  } else if (type === 'clarify.request') {
    status = 'Your answer is needed'; detail = preview(payload.question) || 'Hermes has a question for you. Open this chat to answer.';
  } else if (payload.status === 'interrupted') {
    status = 'Task stopped'; detail = 'This turn was stopped. Open the chat to continue.';
  } else if (payload.status && payload.status !== 'complete') {
    status = 'Couldn’t finish'; detail = 'Hermes couldn’t finish this turn. Open the chat for details.';
  } else {
    status = 'Reply ready'; detail = preview(payload.text) || 'Hermes has finished. Open this chat to see the result.';
  }
  return {title: `${session || 'Your chat'} · ${status}`, body: compact(detail, 180), expanded: detail};
}

/** Notifee interprets Android title/body HTML. Display model and session text literally. */
export function notificationLiteral(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
