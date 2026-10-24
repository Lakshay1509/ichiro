// Checks the packaged-app test host:install runs on Windows. Run: npm test
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appDataRedirected } from './packaged-app.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const root = mkdtempSync(join(tmpdir(), 'ichiro-appdata-'));
try {
  // Plain AppData (no Packages folder, then an unrelated one): not redirected, and the probe is cleaned up.
  if (appDataRedirected(root, 'probe-1')) fail('plain AppData counted as redirected');
  mkdirSync(join(root, 'Packages', 'Other_app', 'LocalCache', 'Local', 'something-else'), { recursive: true });
  if (appDataRedirected(root, 'probe-2')) fail('an unrelated package counted as redirected');
  if (existsSync(join(root, 'probe-1')) || existsSync(join(root, 'probe-2'))) fail('probe left behind');
  // The probe showing up in a package's private copy (what Windows does inside a packaged app): redirected.
  mkdirSync(join(root, 'Packages', 'Claude_x', 'LocalCache', 'Local', 'probe-3'), { recursive: true });
  if (!appDataRedirected(root, 'probe-3')) fail('private copy not seen');
} finally {
  rmSync(root, { recursive: true, force: true });
}
