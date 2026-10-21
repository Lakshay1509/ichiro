// WXT build config: manifest settings for the extension.
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

export default defineConfig({
  // P2: pdf.js decodes scanned images (CCITT fax, JBIG2, JPEG 2000) with wasm, which the extension's CSP blocks, so it
  // imports these plain-JS decoders from `${wasmUrl}<name>` instead (no eval in them). Fixed names, so copied, not
  // bundled. Sources: node_modules/pdfjs-dist/build/pdf.worker.mjs (WasmImage), https://wxt.dev/api/reference/wxt/interfaces/WxtHooks
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const name of ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']) {
        files.push({ absoluteSrc: resolve(import.meta.dirname, 'node_modules/pdfjs-dist/wasm', name), relativeDest: `pdfjs/${name}` });
      }
    },
  },
  manifest: {
    name: 'Browser Agent',
    // Toolbar icon. Chrome needs this key so clicking the icon can open the side panel.
    // Source: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
    action: { default_title: 'Open Browser Agent' },
    // Source: https://developer.chrome.com/docs/extensions/reference/permissions-list
    // webNavigation: list a tab's frames (iframes). Source: https://developer.chrome.com/docs/extensions/reference/api/webNavigation
    // webRequest: see which requests a page still has running, so settle waits for slow connections.
    // Source: https://developer.chrome.com/docs/extensions/reference/api/webRequest
    // nativeMessaging: talk to the local host that holds the API key (host/host.ts).
    // Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
    // publicSuffix: a page's site (in.bookmyshow.com → bookmyshow.com) for the plan's Sites (S1). No install warning.
    // Source: https://developer.chrome.com/docs/extensions/reference/api/publicSuffix
    // downloads: tell the model what a run downloaded, and pause any you haven't allowed (D1, D2). Install warning:
    // "Manage your downloads". Source: https://developer.chrome.com/docs/extensions/reference/api/downloads
    // debugger: real mouse input (I1) through the DevTools Protocol's Input domain only, on the command's tab, only while
    // a command or run goes; Chrome shows its "debugging this browser" bar then. Stronger install warning.
    // Source: https://developer.chrome.com/docs/extensions/reference/api/debugger
    permissions: ['sidePanel', 'tabs', 'scripting', 'storage', 'webNavigation', 'webRequest', 'nativeMessaging', 'publicSuffix', 'downloads', 'debugger'],
    // chrome.publicSuffix arrived in Chrome 153; older Chrome can't install the extension.
    // Source: https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version
    minimum_chrome_version: '153',
    // The agent must read and act on any site.
    // Source: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
    host_permissions: ['<all_urls>'],
  },
});
