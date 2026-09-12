// Stateless service worker: the sole LLM HTTP caller (keeps the API key out of the
// page context), streaming chat completions over a Port, plus the selection menu.
// See design/background.md (BG-001 .. BG-004).

import { loadSettings } from '../config';
import type { ChatMessage, RuntimeRequest, StreamEvent, Usage } from '../shared/messages';

const PORT_NAME = 'llm-stream';

/** A request sent from the content script over the streaming Port. */
interface StreamRequestMessage {
  kind: 'translate' | 'compress';
  requestId: string;
  messages: ChatMessage[];
}

chrome.runtime.onInstalled.addListener(async () => {
  // Context-dependent menu (BG-003): a SINGLE item whose title adapts to the selection state —
  // "Add to context" when a selection exists, "Add instruction" when none — so exactly one item
  // is ever visible (Chrome collapses 2+ extension items into an extension-name submenu; one
  // stays flat at the top level). The menu offers no translate action; selection translation is
  // via the trigger key (CT-017). removeAll first so a dev reload doesn't error on a duplicate id.
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'ctx', title: 'Add instruction', contexts: ['all'] });
});

// The content script reports selection-state transitions (selectionchange, debounced + deduped to
// empty↔non-empty) so the single item's title tracks the selection. chrome.contextMenus has no
// onShown/refresh event, so the title is updated here on each transition. The click ACTION is
// decided from info.selectionText (ground truth at click time), not the title — a momentarily-
// stale title never causes a wrong action.
chrome.runtime.onMessage.addListener((req: RuntimeRequest, _sender, sendResponse) => {
  if (req.kind === 'selectionState') {
    void chrome.contextMenus.update('ctx', { title: req.has ? 'Add to context' : 'Add instruction' });
  }
  sendResponse(true);
  return false;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || info.menuItemId !== 'ctx') return;
  const sel = info.selectionText ? info.selectionText.trim() : '';
  if (sel) {
    // right-clicked on a selection → Add to context (the former "理解", session.addContext)
    const req: RuntimeRequest = { kind: 'contextMenu', action: 'understand', selection: sel };
    chrome.tabs.sendMessage(tab.id, req).catch(() => { /* content may be absent */ });
  } else {
    // no selection → Add instruction (content shows the input panel, POP-002)
    const req: RuntimeRequest = { kind: 'contextMenu', action: 'addInstruction' };
    chrome.tabs.sendMessage(tab.id, req).catch(() => { /* content may be absent */ });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  port.onMessage.addListener((msg: StreamRequestMessage) => {
    void streamCompletion(port, msg);
  });
});

/** Stream a chat completion: POST with stream:true, parse SSE, forward chunks/done/error over the Port. */
async function streamCompletion(port: chrome.runtime.Port, msg: StreamRequestMessage): Promise<void> {
  const settings = await loadSettings();
  if (!settings.baseUrl || !settings.model) {
    postEvent(port, { kind: 'error', requestId: msg.requestId, message: 'API 未配置：请在扩展设置中填写 Base URL 和 Model。' });
    return;
  }
  if (!settings.apiKey && !isLocalEndpoint(settings.baseUrl)) {
    postEvent(port, { kind: 'error', requestId: msg.requestId, message: 'API 未配置：远程服务需要填写 API Key；Ollama 等本地服务可留空。' });
    return;
  }

  const url = completionUrl(settings.baseUrl);
  let fullText = '';
  let usage: Usage = { promptTokens: 0, completionTokens: 0 };

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

    const requestBody: Record<string, unknown> = {
      model: settings.model,
      messages: msg.messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (isOllamaEndpoint(settings.baseUrl)) {
      // Ollama's OpenAI endpoint uses reasoning_effort rather than DeepSeek's thinking object.
      requestBody.reasoning_effort = settings.thinking
        ? (settings.effort === 'max' ? 'high' : settings.effort)
        : 'none';
    } else {
      // DeepSeek (and the DeepSeek-compatible relays/mirrors this project targets by default)
      // defaults thinking to ENABLED when the field is omitted, so disabling it must be sent
      // explicitly — matching on the literal "deepseek.com" hostname missed any custom/relay
      // base URL and silently left thinking on even with the toggle off. Sending this field to
      // an unrelated OpenAI-compatible API is harmless (unknown JSON fields are ignored), so it
      // is safe to send unconditionally here.
      requestBody.thinking = { type: settings.thinking ? 'enabled' : 'disabled' };
      if (settings.thinking) requestBody.reasoning_effort = settings.effort === 'max' ? 'high' : settings.effort;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    if (!res.ok || !res.body) {
      const errorBody = await res.text().catch(() => '');
      const unsupportedThinking = res.status === 400 && /does not support thinking/i.test(errorBody);
      const message = unsupportedThinking
        ? `当前模型 ${settings.model} 不支持思考模式。请关闭思考模式，或改用 Qwen 3、DeepSeek R1 等支持 thinking 的模型。`
        : `HTTP ${res.status}: ${errorBody.slice(0, 500)}`;
      postEvent(port, { kind: 'error', requestId: msg.requestId, message });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json: any;
        try {
          json = JSON.parse(data);
        } catch {
          continue; // ignore malformed keepalives
        }
        const choiceDelta = json?.choices?.[0]?.delta;
        // Reasoning-model chain-of-thought tokens: Ollama streams them as `delta.reasoning`,
        // DeepSeek as `delta.reasoning_content`. Only used as a presence signal (CT-021) — the
        // actual reasoning text is never sent to the content script.
        if (choiceDelta?.reasoning || choiceDelta?.reasoning_content) {
          postEvent(port, { kind: 'reasoning', requestId: msg.requestId });
        }
        const delta: string | undefined = choiceDelta?.content;
        if (delta) {
          fullText += delta;
          postEvent(port, { kind: 'chunk', requestId: msg.requestId, delta });
        }
        if (json?.usage) usage = normalizeUsage(json.usage);
      }
    }
    postEvent(port, { kind: 'done', requestId: msg.requestId, fullText, usage });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    postEvent(port, { kind: 'error', requestId: msg.requestId, message });
  }
}

function postEvent(port: chrome.runtime.Port, evt: StreamEvent): void {
  port.postMessage(evt);
}

/** Normalize an OpenAI-compatible usage object, capturing DeepSeek cache fields when present. */
function normalizeUsage(u: any): Usage {
  const usage: Usage = {
    promptTokens: u?.prompt_tokens ?? 0,
    completionTokens: u?.completion_tokens ?? 0,
  };
  if (typeof u?.prompt_cache_hit_tokens === 'number') usage.promptCacheHitTokens = u.prompt_cache_hit_tokens;
  if (typeof u?.prompt_cache_miss_tokens === 'number') usage.promptCacheMissTokens = u.prompt_cache_miss_tokens;
  return usage;
}

/** Join a base URL and a path, tolerating trailing slashes on the base. */
function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

/** Local OpenAI-compatible servers commonly do not require bearer authentication. */
function isLocalEndpoint(base: string): boolean {
  try {
    const hostname = new URL(base).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' ||
      hostname === '0.0.0.0' || hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  } catch {
    return false;
  }
}

/**
 * Resolve the OpenAI-compatible endpoint. Ollama's default server exposes it below /v1,
 * while DeepSeek's documented base URL expects /chat/completions directly.
 */
function completionUrl(base: string): string {
  const clean = base.replace(/\/+$/, '');
  try {
    const url = new URL(clean);
    if (url.pathname.endsWith('/chat/completions')) return clean;
    if (url.pathname.endsWith('/v1')) return joinUrl(clean, '/chat/completions');
    if (isLocalEndpoint(clean) && url.port === '11434' && (url.pathname === '' || url.pathname === '/')) {
      return joinUrl(clean, '/v1/chat/completions');
    }
  } catch {
    // The request below will surface an actionable URL/fetch error.
  }
  return joinUrl(clean, '/chat/completions');
}

function isOllamaEndpoint(base: string): boolean {
  try {
    const url = new URL(base);
    return isLocalEndpoint(base) && url.port === '11434';
  } catch {
    return false;
  }
}
