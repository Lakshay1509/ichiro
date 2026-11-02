// Update checks: the local helper older than the extension (it says its version when it starts), or, for a copy loaded
// unpacked, a newer release on GitHub. Each gives a card with the prompt to paste into your coding agent.
import { isObject } from './host-request.ts';
import { REPO, updatePrompt } from './host-install.ts';

type Card = { kind: 'prompt'; head: string; text: string };

// GitHub's newest release that isn't a draft or prerelease. Source: https://docs.github.com/en/rest/releases/releases#get-the-latest-release
export const RELEASES_API = `${REPO.replace('https://github.com/', 'https://api.github.com/repos/')}/releases/latest`;

// a is a later release than b, compared as numbers (0.10.0 after 0.9.0). Only plain x.y.z: anything else is never newer.
export function newer(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number));
  if (!x || !y) return false;
  const i = x.findIndex((n, j) => n !== y[j]);
  return i >= 0 && x[i]! > y[i]!;
}

// Chrome updated the extension (Web Store), but the local copy behind your agent's MCP server is older. helper: the
// version its host said at start, '' from a host older than this check (0.2.1 and before). manifest: the extension's;
// version_name is the tag's name, as in /update.
export function helperCard(helper: string, id: string, manifest: { version: string; version_name?: string }): Card | null {
  if (helper && !newer(manifest.version, helper)) return null;
  const tag = manifest.version_name ?? manifest.version;
  return {
    kind: 'prompt',
    head: `Update available\nIchiro is now v${tag}, but its helper on your computer is ${helper ? `still v${helper}` : 'older'}. Copy this prompt into your coding agent.`,
    text: updatePrompt(id, tag),
  };
}

// A copy loaded unpacked (no Web Store to update it): GitHub's latest release (RELEASES_API's reply), if newer than the
// extension. Its tag goes into a prompt your agent runs, so only a plain vX.Y.Z counts.
export function releaseCard(release: unknown, id: string, version: string): Card | null {
  const latest = /^v(\d+\.\d+\.\d+)$/.exec(isObject(release) && typeof release.tag_name === 'string' ? release.tag_name : '')?.[1];
  if (!latest || !newer(latest, version)) return null;
  return {
    kind: 'prompt',
    head: `Update available\nIchiro v${latest} is out, and you have v${version}. Copy this prompt into your coding agent.`,
    text: updatePrompt(id, latest, true),
  };
}
