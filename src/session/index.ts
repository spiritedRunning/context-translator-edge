// Per-page translation session: message array, pending-context folding,
// compress-to-summary, and cumulative token usage.
// See design/session.md (SES-001 .. SES-005).

import type { ChatMessage, Usage, UsageSnapshot } from '../shared/messages';
import { COMPRESS_PROMPT, DEFAULT_SELECTION_PROMPT, DEFAULT_SYSTEM_PROMPT, SELECTION_ANALYSIS_PROMPT, langLabel } from '../config';

type OutputMode = 'translation' | 'selection-analysis';

/** A buffered context item not yet sent to the LLM. */
export interface PendingItem {
  /** 'context' = selected text added via 理解; 'instruction' = user-typed via popup. */
  kind: 'context' | 'instruction';
  text: string;
}

/**
 * Per-page translation session. The content script owns one instance per page load
 * (ARCH-002). The service worker is stateless; the content script assembles the full
 * message array here and sends it (ARCH-003).
 */
export class Session {
  private turns: ChatMessage[] = [];
  private pending: PendingItem[] = [];
  private cumulativeUsage: Usage = { promptTokens: 0, completionTokens: 0 };
  /** Snapshot of the most recent translation response's usage (for the popup's context
   *  gauge and Last cache rate, POP-003). Compress responses do NOT replace this. */
  private lastUsage: Usage | null = null;
  /** The user message of the most recent in-flight request, awaiting commit. With CT-018
   *  serialization only one request is ever in flight, so this single slot cannot be clobbered. */
  private pendingUserContent: string | null = null;

  constructor(
    private readonly targetLang: string,
    private readonly customPrompt: string,
    private readonly selectionPrompt: string = DEFAULT_SELECTION_PROMPT,
  ) {}

  /** Reset to a fresh session (clear action / new page). */
  reset(): void {
    this.turns = [];
    this.pending = [];
    this.cumulativeUsage = { promptTokens: 0, completionTokens: 0 };
    this.lastUsage = null;
    this.pendingUserContent = null;
  }

  /** Add 理解-selected background (not translated, used for context). */
  addContext(text: string): void {
    if (text) this.pending.push({ kind: 'context', text });
  }

  /** Add user-typed explanatory instruction (from popup). */
  addInstruction(text: string): void {
    if (text) this.pending.push({ kind: 'instruction', text });
  }

  /** Build the full message array for a translation request (pending folded, not yet committed).
   *  The custom prompt (CFG-005) is folded into the <user-instruction> block only on the first
   *  user message of a session-segment (no committed user turns yet — also re-added after a
   *  compress or clear), so it appears once per segment rather than every turn. `marker` (used by
   *  re-translate, CT-016/SES-006) leads the <user-instruction> block as a re-translate signal; the
   *  custom prompt is NOT re-folded for a re-translate (already in the segment's first user message). */
  buildTranslateRequest(text: string, marker?: string): ChatMessage[] {
    return this.buildRequest(text, 'translation', marker);
  }

  /** Build an explicit selection request with translation, explanation, and collocations.
   *  A single English word is tagged explicitly so local models reliably choose the richer
   *  dictionary output. `surroundingContext` is page text near the selection, not a command. */
  buildSelectionRequest(text: string, surroundingContext = ''): ChatMessage[] {
    // Repeat the general prompt on every explicit selection: terminology preservation must not
    // fade into distant conversation history after the first translation on a long-lived page.
    const folded = this.foldPending(text, false);
    const outputInstruction = this.selectionPrompt.trim() || DEFAULT_SELECTION_PROMPT;
    const terminologyInstruction = this.customPrompt.trim()
      ? `<user-instruction>\n${this.customPrompt.trim()}\n</user-instruction>\n`
      : '';
    const selectionKind = /^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/.test(text.trim())
      ? 'single-english-word'
      : 'phrase-or-sentence';
    const context = surroundingContext.trim();
    const contextBlock = context && context !== text.trim()
      ? `<selection-context>\n${context}\n</selection-context>\n`
      : '';
    const userContent = `<selection-output-instruction>\n${outputInstruction}\n</selection-output-instruction>\n` +
      `<selection-kind>${selectionKind}</selection-kind>\n${contextBlock}${terminologyInstruction}${folded}`;
    this.pendingUserContent = userContent;
    return [this.systemMessage('selection-analysis'), ...this.turns, { role: 'user', content: userContent }];
  }

  private buildRequest(text: string, mode: OutputMode, marker?: string): ChatMessage[] {
    const includeCustom = !this.turns.some((t) => t.role === 'user');
    const userContent = this.foldPending(text, includeCustom, marker);
    this.pendingUserContent = userContent;
    return [this.systemMessage(mode), ...this.turns, { role: 'user', content: userContent }];
  }

  /**
   * Commit a completed translation: append the user turn (pending-folded) and the
   * assistant turn, clear pending, and accumulate usage. Pending clears on successful
   * commit so a failed request can be retried with the same context re-folded.
   */
  commitResponse(assistantText: string, usage: Usage): void {
    if (this.pendingUserContent == null) return;
    this.turns.push({ role: 'user', content: this.pendingUserContent });
    this.turns.push({ role: 'assistant', content: assistantText });
    this.pending = [];
    this.pendingUserContent = null;
    this.lastUsage = { ...usage };
    this.accumulateUsage(usage);
  }

  /** Drop the in-flight request without committing (e.g. on error); pending is retained for a retry. */
  abortRequest(): void {
    this.pendingUserContent = null;
  }

  /** Build a compress request: system + history + a user message asking for a summary. Pending is preserved. */
  buildCompressRequest(): ChatMessage[] {
    return [this.systemMessage(), ...this.turns, { role: 'user', content: COMPRESS_PROMPT }];
  }

  /** Commit a compress result: replace committed history with the summary (assistant). Pending is preserved (SES-004). */
  commitCompress(summary: string, usage: Usage): void {
    this.turns = [{ role: 'assistant', content: summary }];
    this.pendingUserContent = null;
    this.accumulateUsage(usage);
  }

  /** Cumulative usage across all committed responses plus the last translation response's
   *  usage, for the popup display (POP-003). */
  getUsage(): UsageSnapshot {
    return {
      cumulative: { ...this.cumulativeUsage },
      last: this.lastUsage ? { ...this.lastUsage } : null,
    };
  }

  private systemMessage(mode: OutputMode = 'translation'): ChatMessage {
    const prompt = mode === 'selection-analysis' ? SELECTION_ANALYSIS_PROMPT : DEFAULT_SYSTEM_PROMPT;
    return { role: 'system', content: `${prompt}\n\nTarget language: ${langLabel(this.targetLang)}.` };
  }

  /** Fold pending context into the translation user message with the XML tags (SES-002).
   *  When includeCustom is set (first user message of a segment), the page-snapshotted custom
   *  prompt leads the <user-instruction> block — reusing the existing tag, not a new one (CFG-005).
   *  `marker` (re-translate, CT-016/SES-006) is prepended to the <user-instruction> block so the
   *  block is always present for a re-translate even with no pending instruction. */
  private foldPending(text: string, includeCustom: boolean, marker?: string): string {
    const contextText = this.pending.filter((p) => p.kind === 'context').map((p) => p.text).join('\n\n');
    const instrParts: string[] = [];
    if (marker) instrParts.push(marker);
    if (includeCustom && this.customPrompt.trim()) instrParts.push(this.customPrompt.trim());
    for (const p of this.pending) if (p.kind === 'instruction') instrParts.push(p.text);
    const instructionText = instrParts.join('\n\n');
    let content = '';
    if (contextText) content += `<context>\n${contextText}\n</context>\n`;
    if (instructionText) content += `<user-instruction>\n${instructionText}\n</user-instruction>\n`;
    content += `<translate>\n${text}\n</translate>`;
    return content;
  }

  private accumulateUsage(u: Usage): void {
    this.cumulativeUsage.promptTokens += u.promptTokens;
    this.cumulativeUsage.completionTokens += u.completionTokens;
    if (u.promptCacheHitTokens != null) {
      this.cumulativeUsage.promptCacheHitTokens = (this.cumulativeUsage.promptCacheHitTokens ?? 0) + u.promptCacheHitTokens;
    }
    if (u.promptCacheMissTokens != null) {
      this.cumulativeUsage.promptCacheMissTokens = (this.cumulativeUsage.promptCacheMissTokens ?? 0) + u.promptCacheMissTokens;
    }
  }
}
