// WXT build config: manifest settings for the extension.
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    // name and description are the Web Store title and summary (75 and 132 characters max); keep them in step with
    // README.md's heading and the welcome. Source: https://developer.chrome.com/docs/extensions/reference/manifest/name
    name: 'Ichiro: Open Source Browser MCP for Coding Agents',
    description: 'Open source browser MCP for Claude Code, Codex and any coding agent. It works in your own Chrome and asks before risky steps.',
    // Extension icons: WXT adds public/icon-16|32|48|128.png on its own (art/logo/icons). Source: https://wxt.dev/guide/essentials/config/manifest
    // Toolbar icon. Chrome needs this key so clicking the icon can open the side panel.
    // Source: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
    // default_icon set too, as Chrome's docs advise: https://developer.chrome.com/docs/extensions/reference/api/action
    action: { default_title: 'Open Ichiro', default_icon: { 16: 'icon-16.png', 32: 'icon-32.png' } },
    // Source: https://developer.chrome.com/docs/extensions/reference/permissions-list
    // webNavigation: list a tab's frames (iframes). Source: https://developer.chrome.com/docs/extensions/reference/api/webNavigation
    // webRequest: see which requests a page still has running, so settle waits for slow connections.
    // Source: https://developer.chrome.com/docs/extensions/reference/api/webRequest
    // nativeMessaging: talk to the local host that bridges a coding agent's commands (/mcp on, host/host.ts).
    // Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
    // publicSuffix: a page's site (in.bookmyshow.com → bookmyshow.com) for the plan's Sites (S1). No install warning.
    // Source: https://developer.chrome.com/docs/extensions/reference/api/publicSuffix
    // downloads: tell the model what a run downloaded, and pause any you haven't allowed (D1, D2). Install warning:
    // "Manage your downloads". Source: https://developer.chrome.com/docs/extensions/reference/api/downloads
    // debugger: real mouse input (I1) through the DevTools Protocol's Input domain only, on the command's tab, only while
    // a command or run goes; Chrome shows its "debugging this browser" bar then. Stronger install warning.
    // Source: https://developer.chrome.com/docs/extensions/reference/api/debugger
    // offscreen: the hidden page that reads PDFs with pdf.js (BG2, lib/files/offscreen.ts). No install warning.
    // Source: https://developer.chrome.com/docs/extensions/reference/api/offscreen
    // tabGroups: name and color the agent's tab group "Ichiro" (OT2, lib/tabs/tab-group.ts). Install warning: "View and
    // manage your tab groups". Source: https://developer.chrome.com/docs/extensions/reference/api/tabGroups
    // declarativeNetRequestWithHostAccess: while the agent's goto loads, its tab can't be redirected to a site off your
    // Sites (lib/tabs/navigation.ts, gotoRule). No install warning with access to all sites.
    // Source: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
    permissions: ['sidePanel', 'tabs', 'scripting', 'storage', 'webNavigation', 'webRequest', 'nativeMessaging', 'publicSuffix', 'downloads', 'debugger', 'offscreen', 'tabGroups', 'declarativeNetRequestWithHostAccess'],
    // chrome.publicSuffix arrived in Chrome 153; older Chrome can't install the extension.
    // Source: https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version
    minimum_chrome_version: '153',
    // The agent must read and act on any site.
    // Source: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
    host_permissions: ['<all_urls>'],
  },
});
