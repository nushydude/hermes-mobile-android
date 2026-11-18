/** The send action appears only when the composer has content. Voice stays available. */
export function composerActions(text: string, attachmentCount: number) {
  return { showSend: !!text.trim() || attachmentCount > 0, showVoice: true };
}
