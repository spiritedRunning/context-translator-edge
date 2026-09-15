// Options page (POP-006): endpoint/model, thinking, general prompt, and selection-output prompt.
// Reads/writes chrome.storage.local via the config module (shared schema with the popup).
// Saves all persistent translation settings, including the default target language.
import { DEFAULTS, loadSettings, saveSettings, type Settings } from '../config';

const form = document.getElementById('settings') as HTMLFormElement | null;
const status = document.getElementById('status');

function field(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return form!.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}

async function populate(): Promise<void> {
  const s = await loadSettings();
  (field('baseUrl') as HTMLInputElement).value = s.baseUrl;
  (field('apiKey') as HTMLInputElement).value = s.apiKey;
  (field('model') as HTMLInputElement).value = s.model;
  (field('targetLang') as HTMLSelectElement).value = s.targetLang;
  // Trigger key is a single-select (Alt/Shift/Control); fall back to Alt if a legacy free-text
  // value is stored, so the content-script key matcher (e.key) always has a valid choice.
  const triggerRadios = form!.elements.namedItem('triggerKey') as RadioNodeList;
  triggerRadios.value = ['Alt', 'Shift', 'Control'].includes(s.triggerKey) ? s.triggerKey : 'Alt';
  // Thinking toggle + effort single-select (DS-005). Effort is greyed/disabled when thinking is off.
  (field('thinking') as HTMLInputElement).checked = s.thinking;
  const effortRadios = form!.elements.namedItem('effort') as RadioNodeList;
  effortRadios.value = ['low', 'medium', 'high', 'max'].includes(s.effort) ? s.effort : 'low';
  syncEffortDisabled();
  (field('customPrompt') as HTMLTextAreaElement).value = s.customPrompt;
  (field('selectionPrompt') as HTMLTextAreaElement).value = s.selectionPrompt;
  (field('bidirectionalLangA') as HTMLSelectElement).value = s.bidirectionalLangA;
  (field('bidirectionalLangB') as HTMLSelectElement).value = s.bidirectionalLangB;
  (field('maxContextK') as HTMLInputElement).value = String(s.maxContextK);
}

/** Disable the effort fieldset (greyed) when thinking is off; enable when on. */
function syncEffortDisabled(): void {
  const thinkingBox = field('thinking') as HTMLInputElement;
  const effortFieldset = document.querySelector('fieldset.effort') as HTMLFieldSetElement | null;
  if (effortFieldset) effortFieldset.disabled = !thinkingBox.checked;
}

// Toggle effort availability as the thinking switch changes; warn when thinking is turned on.
field('thinking')?.addEventListener('change', () => {
  syncEffortDisabled();
  if ((field('thinking') as HTMLInputElement).checked) showThinkingNotice();
});

/** Show the thinking-mode notice toast (auto-hides after 8s, or via the close button). */
let toastTimer: number | null = null;
function showThinkingNotice(): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.hidden = false;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; toastTimer = null; }, 8000);
}

document.querySelector('#toast .close')?.addEventListener('click', () => {
  const toast = document.getElementById('toast');
  if (toast) toast.hidden = true;
  if (toastTimer !== null) { window.clearTimeout(toastTimer); toastTimer = null; }
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const effortVal = String(fd.get('effort') ?? 'low');
  const maxCtxRaw = Number(fd.get('maxContextK'));
  const bidirectionalLangA = String(fd.get('bidirectionalLangA') ?? 'en');
  const bidirectionalLangB = String(fd.get('bidirectionalLangB') ?? 'zh-CN');
  if (bidirectionalLangA === bidirectionalLangB) {
    if (status) status.textContent = '双向翻译请选择两种不同语言';
    return;
  }
  const patch: Pick<Settings, 'baseUrl' | 'apiKey' | 'model' | 'thinking' | 'effort' | 'targetLang' | 'triggerKey' | 'customPrompt' | 'selectionPrompt' | 'bidirectionalLangA' | 'bidirectionalLangB' | 'maxContextK'> = {
    baseUrl: String(fd.get('baseUrl') ?? '').trim(),
    apiKey: String(fd.get('apiKey') ?? ''),
    model: String(fd.get('model') ?? '').trim(),
    targetLang: String(fd.get('targetLang') ?? 'zh-CN'),
    thinking: fd.get('thinking') === 'on',
    effort: ['low', 'medium', 'high', 'max'].includes(effortVal) ? effortVal : 'low',
    triggerKey: String(fd.get('triggerKey') ?? 'Alt') || 'Alt',
    customPrompt: String(fd.get('customPrompt') ?? '').trim(),
    selectionPrompt: String(fd.get('selectionPrompt') ?? '').trim(),
    bidirectionalLangA,
    bidirectionalLangB,
    maxContextK: Number.isFinite(maxCtxRaw) && maxCtxRaw > 0 ? Math.floor(maxCtxRaw) : DEFAULTS.maxContextK,
  };
  await saveSettings(patch);
  if (status) {
    status.textContent = '已保存';
    setTimeout(() => { if (status) status.textContent = ''; }, 1500);
  }
});

void populate();
