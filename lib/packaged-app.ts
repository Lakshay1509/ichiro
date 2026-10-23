// Windows: tells whether this process runs inside a packaged app (like the Claude desktop app) that hides its writes.
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// True when a new folder made in AppData lands in a packaged app's private copy (Packages\<app>\LocalCache\Local).
// Then this process's registry writes are private to that app too, and no browser would ever find the host.
// Source: https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization
export function appDataRedirected(localAppData: string, probe: string): boolean {
  mkdirSync(join(localAppData, probe));
  try {
    const packages = join(localAppData, 'Packages');
    return existsSync(packages) && readdirSync(packages).some((p) => existsSync(join(packages, p, 'LocalCache', 'Local', probe)));
  } finally {
    rmSync(join(localAppData, probe), { recursive: true, force: true });
  }
}
