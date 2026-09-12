import { defineManifest } from '@crxjs/vite-plugin';

export const manifest = defineManifest({
  manifest_version: 3,
  name: 'Context Translator',
  version: '0.1.5',
  description: 'AI-powered hover/selection translation with a per-page context session.',
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
  options_ui: {
    page: 'src/options/page.html',
    open_in_tab: true,
  },
  background: {
    service_worker: 'src/background/sw.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/inject.ts'],
    },
  ],
  permissions: ['contextMenus', 'storage'],
  host_permissions: ['<all_urls>'],
});
