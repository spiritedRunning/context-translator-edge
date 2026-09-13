// Shared type contracts for cross-module messaging.
// Infrastructure only — types, no behavior. Consumed by background / content / popup.
// See design/background.md, design/content.md, design/popup.md.

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

// Token usage reported by the OpenAI-compatible endpoint.
// promptCacheHitTokens / promptCacheMissTokens are DeepSeek-specific and
// present only when the endpoint returns them.
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  /** User-observed delay from request dispatch until the first visible output chunk. */
  firstTokenMs?: number;
  /** User-observed time from the first visible output chunk until the response completes. */
  generationMs?: number;
}

// Aggregate usage for the popup display (POP-003): cumulative across all committed
// responses + the most recent translation response (compress responses update the
// cumulative total but do not replace `last`; see SES-005).
export interface UsageSnapshot {
  cumulative: Usage;
  last: Usage | null;
}

export type StreamErrorCode = 'not_configured';

// Runtime request messages (chrome.runtime / chrome.tabs messaging).
// translate / compress: content -> background (carries the assembled messages array,
// since the service worker is stateless and the content script owns the session).
// contextMenu: background -> content — "understand" carries the selection (Add to context,
// shown only when a selection exists); "addInstruction" asks the content script to show its
// instruction input panel (Add instruction, shown only when no selection exists). See BG-003.
// selectionState: content -> background — reports an empty↔non-empty selection transition so the
// single menu item's title tracks the selection ("Add to context" vs "Add instruction"). See BG-003.
// clear / getUsage: popup -> content.
export type RuntimeRequest =
  | { kind: 'translate'; requestId: string; messages: ChatMessage[] }
  | { kind: 'compress'; requestId: string; messages: ChatMessage[] }
  | { kind: 'contextMenu'; action: 'understand'; selection: string }
  | { kind: 'contextMenu'; action: 'addInstruction' }
  | { kind: 'selectionState'; has: boolean }
  | { kind: 'openOptions' }
  | { kind: 'clear' }
  | { kind: 'getUsage' };

export type RuntimeResponse =
  | { kind: 'ok' }
  | { kind: 'usage'; usage: UsageSnapshot }
  | { kind: 'error'; message: string };

// Streaming events pushed over a Port (background -> content), one per token chunk.
// 'reasoning' is a presence signal only (no text payload): reasoning-model chain-of-thought
// tokens are never shown to the user, but their arrival drives a "Thinking…" placeholder while
// the model has not yet started streaming its visible `content` (CT-021).
export type StreamEvent =
  | { kind: 'chunk'; requestId: string; delta: string }
  | { kind: 'reasoning'; requestId: string }
  | { kind: 'done'; requestId: string; fullText: string; usage: Usage }
  | { kind: 'error'; requestId: string; message: string; code?: StreamErrorCode };
