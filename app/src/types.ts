import type { ConnectionState, GatewayEvent, PendingSubmission, Snapshot } from '@hermes-mobile/protocol';

export type SessionRow = Record<string, unknown> & { id: string; title?: string | null; running?: boolean; pinned?: boolean | null; preview?: string | null; model?: string | null; cwd?: string | null; last_active_at?: string | number | null };
export interface ChatState {
  draftAttachments?: Array<{uri:string;path:string;mime:string}>;
  importedShareIds?: string[];
  snapshot: Snapshot | null; messages: unknown[]; liveText: string; blocks: GatewayEvent[];
  prompts: unknown[]; pending: unknown[]; usage: unknown; running: boolean;
  localMessages: Array<{submission_id: string; text: string; attachments?: Array<{path:string; mime:string}>; admission_id?:string; status: 'pending' | 'accepted' | 'completed' | 'failed'; enqueue_order: number; row_ids?:number[]}>;
  partialUnavailable: boolean; cursor: string | null;
  draftAlternatives?: string[]; sessionUnavailable?: boolean;
}
export interface QueuedEdit { session_id: string; admission_id: string; submission_id: string; text: string; enqueue_order: number; error?: string }
export interface AppState {
  historyTruncated: boolean; credentialsConfigured: boolean; connection: ConnectionState; error: string | null;
  sessions: SessionRow[]; activeSessionId: string | null; chats: Record<string, ChatState>;
  drafts: Record<string, string>; outbox: Array<PendingSubmission & { enqueue_order: number; error?: string }>; queuedEdits: QueuedEdit[];
  secureRequest: { method: 'sudo' | 'secret'; params: Record<string, unknown> } | null;
}
