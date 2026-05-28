// Kill the proxy + Vite dev servers spawned (detached) by global-setup.
// Each pid is a detached process-group leader, so -pid kills its whole tree
// (pnpm -> vite -> esbuild children).

import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVERS_FILE = join(__dirname, ".servers.json");

async function globalTeardown() {
  if (!existsSync(SERVERS_FILE)) return;
  let pids: number[] = [];
  try {
    pids = (JSON.parse(readFileSync(SERVERS_FILE, "utf8")) as { pids: number[] })
      .pids;
  } catch {
    pids = [];
  }
  for (const pid of pids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  try {
    rmSync(SERVERS_FILE);
  } catch {
    /* ignore */
  }
}

export default globalTeardown;
