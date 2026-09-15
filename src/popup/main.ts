// Popup manual translator, settings-page entry, and current-page usage display.
import { DEFAULTS, langLabel, loadSettings, manualTranslationPrompt } from '../config';
import type { ChatMessage, RuntimeResponse, StreamEvent, Usage, UsageSnapshot } from '../shared/messages';

const openBtn = document.getElementById('openOptions');
const manualInput = document.getElementById('manualInput') as HTMLTextAreaElement | null;
const manualButton = document.getElementById('manualTranslate') as HTMLButtonElement | null;
const manualStatus = document.getElementById('manualStatus');
const manualResult = document.getElementById('manualResult');
const languagePair = document.getElementById('languagePair');

const UI_LANGUAGE_LABELS: Record<string, string> = {
  'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語', ko: '한국어',
  fr: 'Français', de: 'Deutsch', es: 'Español', ru: 'Русский',
};

async function populate(): Promise<void> {
  const s = await loadSettings();
  if (languagePair) {
    const a = UI_LANGUAGE_LABELS[s.bidirectionalLangA] ?? langLabel(s.bidirectionalLangA);
    const b = UI_LANGUAGE_LABELS[s.bidirectionalLangB] ?? langLabel(s.bidirectionalLangB);
    languagePair.textContent = `${a} ⇄ ${b}`;
  }
}

openBtn?.addEventListener('click', () => chrome.runtime.openOptionsPage());

let manualRequestCounter = 0;
let manualInFlight = false;

function syncManualButton(): void {
  if (manualButton) manualButton.disabled = manualInFlight || !manualInput?.value.trim();
}

manualInput?.addEventListener('input', syncManualButton);
manualInput?.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !manualButton?.disabled) {
    e.preventDefault();
    manualButton?.click();
  }
});

manualButton?.addEventListener('click', async () => {
  const source = manualInput?.value.trim();
  if (!source || manualInFlight) return;
  const settings = await loadSettings();
  if (settings.bidirectionalLangA === settings.bidirectionalLangB) {
    showManualError('请在设置中选择两种不同的双向翻译语言。');
    return;
  }

  manualInFlight = true;
  syncManualButton();
  if (manualStatus) manualStatus.textContent = 'Working...';
  if (manualResult) {
    manualResult.hidden = false;
    manualResult.classList.remove('error');
    manualResult.textContent = '';
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: manualTranslationPrompt(settings.bidirectionalLangA, settings.bidirectionalLangB) },
    { role: 'user', content: source },
  ];
  streamManualTranslation(messages);
});

function streamManualTranslation(messages: ChatMessage[]): void {
  const port = chrome.runtime.connect({ name: 'llm-stream' });
  const requestId = `popup-${++manualRequestCounter}`;
  let buffer = '';
  let settled = false;
  const finish = () => {
    manualInFlight = false;
    syncManualButton();
    try { port.disconnect(); } catch { /* already disconnected */ }
  };
  port.onMessage.addListener((evt: StreamEvent) => {
    if (evt.requestId !== requestId || settled) return;
    if (evt.kind === 'chunk') {
      buffer += evt.delta;
      if (manualResult) manualResult.textContent = buffer;
      if (manualStatus) manualStatus.textContent = 'Translating...';
    } else if (evt.kind === 'reasoning') {
      if (!buffer && manualStatus) manualStatus.textContent = 'Working...';
    } else if (evt.kind === 'done') {
      settled = true;
      const result = (evt.fullText || buffer).trim();
      if (manualResult) manualResult.textContent = result;
      if (manualStatus) manualStatus.textContent = 'Done';
      finish();
    } else if (evt.kind === 'error') {
      settled = true;
      showManualError(evt.message);
      finish();
    }
  });
  port.onDisconnect.addListener(() => {
    if (settled) return;
    settled = true;
    showManualError('与服务端的连接中断');
    manualInFlight = false;
    syncManualButton();
  });
  port.postMessage({ kind: 'translate', requestId, messages });
}

function showManualError(message: string): void {
  if (manualStatus) manualStatus.textContent = '翻译失败';
  if (manualResult) {
    manualResult.hidden = false;
    manualResult.classList.add('error');
    manualResult.textContent = message;
  }
}

// Current-page token usage (POP-003): query the active tab's content for its session
// usage (cumulative + last translation) and render the context gauge + cache hit rates.
async function loadPageInfo(): Promise<void> {
  const s = await loadSettings();
  const maxContextK = s.maxContextK > 0 ? s.maxContextK : DEFAULTS.maxContextK;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let snap: UsageSnapshot | null = null;
  if (tab?.id != null) {
    snap = await new Promise<UsageSnapshot | null>((resolve) => {
      chrome.tabs.sendMessage(tab.id!, { kind: 'getUsage' }, (resp: unknown) => {
        const r = resp as RuntimeResponse | undefined;
        if (chrome.runtime.lastError || !r || r.kind !== 'usage') {
          resolve(null);
          return;
        }
        resolve(r.usage);
      });
    });
  }
  renderPageInfo(snap, maxContextK, isOllamaEndpoint(s.baseUrl));
}

function renderPageInfo(snap: UsageSnapshot | null, maxContextK: number, ollama: boolean): void {
  const ctxText = document.getElementById('ctxText');
  const ctxFill = document.getElementById('ctxFill');
  const lastRate = document.getElementById('lastRate');
  const totalRate = document.getElementById('totalRate');
  const cacheStats = document.getElementById('cacheStats');
  const ollamaStats = document.getElementById('ollamaStats');
  const inputTokens = document.getElementById('inputTokens');
  const generationSpeed = document.getElementById('generationSpeed');
  const firstTokenLatency = document.getElementById('firstTokenLatency');
  if (!ctxText || !ctxFill || !lastRate || !totalRate || !cacheStats || !ollamaStats ||
      !inputTokens || !generationSpeed || !firstTokenLatency) return;

  cacheStats.hidden = ollama;
  ollamaStats.hidden = !ollama;

  const maxLabel = formatMaxLabel(maxContextK);
  const maxContext = maxContextK * 1000;
  const last = snap?.last ?? null;

  // Context usage = latest translation response's prompt_tokens vs maxContext (POP-003/CFG-006).
  if (snap && last) {
    const used = last.promptTokens;
    const usedK = formatK(used);
    const pct = maxContext > 0 ? Math.round((used / maxContext) * 100) : 0;
    ctxText.textContent = `${usedK}/${maxLabel} (${pct}%)`;
    const fillPct = used > 0 ? Math.max(pct, 3) : 0; // min sliver when >0 but pct rounds to 0
    ctxFill.style.width = `${Math.min(fillPct, 100)}%`;
  } else if (snap) {
    // content present but no translations yet on this page
    ctxText.textContent = `0K/${maxLabel} (0%)`;
    ctxFill.style.width = '0%';
  } else {
    // no content script (restricted page) or query failed
    ctxText.textContent = '—';
    ctxFill.style.width = '0%';
  }

  lastRate.textContent = formatCacheRate(last);
  totalRate.textContent = formatCacheRate(snap?.cumulative ?? null);
  inputTokens.textContent = last ? last.promptTokens.toLocaleString() : '—';
  generationSpeed.textContent = formatGenerationSpeed(last);
  firstTokenLatency.textContent = formatLatency(last?.firstTokenMs);
}

/** Integer K, rounded; `<1K` when nonzero but under 0.5K; `0K` when zero. */
function formatK(tokens: number): string {
  if (tokens <= 0) return '0K';
  const k = Math.round(tokens / 1000);
  return k === 0 ? '<1K' : `${k}K`;
}

/** `M` when maxContextK≥1000 (1000→1M, 1500→1.5M), else `K`. */
function formatMaxLabel(maxContextK: number): string {
  if (maxContextK >= 1000) {
    const m = maxContextK / 1000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  return `${maxContextK}K`;
}

/** `hit/(hit+miss)` as a one-decimal percent; `—` when cache fields absent or zero denominator. */
function formatCacheRate(u: Usage | null): string {
  if (!u) return '—';
  const hit = u.promptCacheHitTokens;
  const miss = u.promptCacheMissTokens;
  if (hit == null || miss == null) return '—';
  const sum = hit + miss;
  if (sum <= 0) return '—';
  return `${((hit / sum) * 100).toFixed(1)}%`;
}

function formatGenerationSpeed(u: Usage | null): string {
  if (!u || u.completionTokens <= 0 || u.generationMs == null || u.generationMs <= 0) return '—';
  const rate = u.completionTokens / (u.generationMs / 1000);
  return `${rate < 100 ? rate.toFixed(1) : Math.round(rate)} tok/s`;
}

function formatLatency(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function isOllamaEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '0.0.0.0' ||
      host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    return local && url.port === '11434';
  } catch {
    return false;
  }
}

void populate();
void loadPageInfo();
