// Popup quick settings (POP-001): target language + open the settings page.
// Reads/writes chrome.storage.local via the config module; saves a partial patch so
// the options-page-owned fields (baseUrl/apiKey/model/triggerKey/customPrompt) stay intact.
import { DEFAULTS, loadSettings, saveSettings } from '../config';
import type { RuntimeResponse, Usage, UsageSnapshot } from '../shared/messages';

const form = document.getElementById('settings') as HTMLFormElement | null;
const status = document.getElementById('status');
const openBtn = document.getElementById('openOptions');

function targetLangField(): HTMLSelectElement {
  return form!.elements.namedItem('targetLang') as HTMLSelectElement;
}

async function populate(): Promise<void> {
  const s = await loadSettings();
  targetLangField().value = s.targetLang;
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveSettings({ targetLang: String(new FormData(form).get('targetLang') ?? 'zh-CN') });
  if (status) {
    status.textContent = '已保存';
    setTimeout(() => { if (status) status.textContent = ''; }, 1500);
  }
});

openBtn?.addEventListener('click', () => chrome.runtime.openOptionsPage());

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
