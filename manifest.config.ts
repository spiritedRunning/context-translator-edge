import { defineManifest } from '@crxjs/vite-plugin';

export type BrowserTarget = 'edge' | 'chrome' | 'firefox';

export const VERSION = '1.0';

const icons = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};

/** Build a browser-specific MV3 manifest. Chromium uses a service worker; Firefox still uses
 * an event-page background script and requires Gecko metadata for signing/distribution. */
export function createManifest(target: BrowserTarget) {
  const isFirefox = target === 'firefox';
  return defineManifest({
    manifest_version: 3,
    name: 'Context Translator',
    version: VERSION,
    description: 'AI-powered contextual translation with hover, selection, and local Ollama support.',
    icons,
    action: {
      default_popup: 'src/popup/index.html',
      default_icon: icons,
    },
    options_ui: {
      page: 'src/options/page.html',
      open_in_tab: true,
    },
    background: isFirefox
      ? {
          scripts: ['src/background/sw.ts'],
          type: 'module',
        }
      : {
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
    ...(isFirefox
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'context-translator-edge@spiritedrunning',
              strict_min_version: '142.0',
              // Selected website text is sent to the user-configured LLM endpoint; an API key
              // may be sent as its Authorization credential. Firefox 142+ exposes this consent.
              data_collection_permissions: {
                required: ['authenticationInfo', 'websiteContent'],
              },
            },
          },
        }
      : {}),
  });
}

// Default development build remains Edge-compatible and continues to output to dist/.
export const manifest = createManifest('edge');
