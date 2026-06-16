import { ChildProcess, execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as os from 'os';

const WINDSURF_PROXY_HOST = '127.0.0.1';
const WINDSURF_PROXY_PORT = 42100;
const PROXY_READY_TIMEOUT_MS = 30000;
const HEALTH_RETRY_INTERVAL_MS = 800;

/** Kill the process occupying the given port */
function killPortOccupants(port: number): number[] {
  try {
    const out = execSync(`lsof -i :${port} -t -sTCP:LISTEN 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const pids = out.trim().split('\n').filter(Boolean).map(Number).filter(n => !isNaN(n));
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`[WindsurfProxy] Killed port ${port} occupant PID ${pid}`);
      } catch {
        console.warn(`[WindsurfProxy] Failed to kill PID ${pid} (may already be gone)`);
      }
    }
    return pids;
  } catch {
    // lsof found no occupant; return normally
    return [];
  }
}

function resolveProxyDir(): string | null {
  const candidates = [
    path.join(os.homedir(), 'Documents', 'myDev', 'windsurf反代'),
    path.join(os.homedir(), 'windsurf反代'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'server', 'package.json'))) {
      return path.join(dir, 'server');
    }
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
  }
  return null;
}

function isRunning(): boolean {
  try {
    const req = http.request({
      hostname: WINDSURF_PROXY_HOST,
      port: WINDSURF_PROXY_PORT,
      path: '/health',
      method: 'GET',
      timeout: 2000,
    }, (res) => {
      res.resume();
    });
    req.on('error', () => {});
    req.end();
    // Do not block waiting for the result; just probe
    return true;
  } catch { return false; }
}

export class WindsurfProxyManager {
  private child: ChildProcess | null = null;
  private proxyDir: string | null = null;
  private onStatusChange?: (running: boolean, error?: string) => void;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  // Restart backoff: progressively longer delays on repeated failures, to avoid a restart storm on EADDRINUSE / startup-script errors
  private restartAttempts = 0;
  private static readonly MAX_RESTART_ATTEMPTS = 6;

  constructor(onStatusChange?: (running: boolean, error?: string) => void) {
    this.proxyDir = resolveProxyDir();
    this.onStatusChange = onStatusChange;
  }

  getProxyDir(): string | null {
    return this.proxyDir;
  }

  isAvailable(): boolean {
    return this.proxyDir !== null;
  }

  /** Health check (Promise version) */
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: WINDSURF_PROXY_HOST,
        port: WINDSURF_PROXY_PORT,
        path: '/health',
        method: 'GET',
        timeout: 3000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ ok: parsed.ok === true });
          } catch {
            resolve({ ok: false, error: 'Invalid response' });
          }
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
      req.end();
    });
  }

  /** Start the proxy process (if not already running) */
  async start(): Promise<{ ok: boolean; error?: string }> {
    if (this.started && this.child && !this.child.killed) {
      // Already started; check whether it is alive
      const health = await this.healthCheck();
      if (health.ok) return health;
      // Process exists but is unresponsive; kill and retry
      this.killChild();
    }

    if (!this.proxyDir) {
      const err = 'Windsurf reverse-proxy directory not found';
      this.onStatusChange?.(false, err);
      return { ok: false, error: err };
    }

    // First check whether a process is already running
    const preCheck = await this.healthCheck();
    if (preCheck.ok) {
      this.started = true;
      this.onStatusChange?.(true);
      return { ok: true };
    }

    // Health check failed -> the port may be occupied by an unhealthy old process; kill it then start
    const killed = killPortOccupants(WINDSURF_PROXY_PORT);
    if (killed.length > 0) {
      console.log(`[WindsurfProxy] Cleared ${killed.length} stale process(es) on port ${WINDSURF_PROXY_PORT}`);
      // Wait for the port to be released (the OS needs a moment to reclaim it after killing)
      await new Promise(r => setTimeout(r, 2000));
    }

    return this.startProcess();
  }

  private startProcess(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const cwd = this.proxyDir!;
      const distPath = path.join(cwd, 'dist', 'index.js');

      if (!fs.existsSync(distPath)) {
        const err = 'Windsurf reverse-proxy is not built; run in the proxy directory: npm run build';
        this.onStatusChange?.(false, err);
        resolve({ ok: false, error: err });
        return;
      }

      console.log('[WindsurfProxy] Starting:', distPath);

      // Try pnpm start, or run node directly
      const useNpm = fs.existsSync(path.join(cwd, 'node_modules', '.pnpm'));
      let child: ChildProcess;

      if (useNpm) {
        const pm = fs.existsSync(path.join(cwd, '..', 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
        child = spawn(pm, ['run', 'start'], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NODE_ENV: 'production' },
        });
      } else {
        child = spawn(process.execPath, [distPath, 'serve'], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NODE_ENV: 'production' },
        });
      }

      this.child = child;
      this.started = true;

      child.stdout?.on('data', (data) => {
        console.log(`[WindsurfProxy] ${data.toString().trim()}`);
      });
      child.stderr?.on('data', (data) => {
        console.error(`[WindsurfProxy] ${data.toString().trim()}`);
      });

      child.on('exit', (code) => {
        console.log(`[WindsurfProxy] Exited with code ${code}`);
        const wasRunning = this.child !== null;
        this.child = null;
        if (wasRunning && this.started) {
          this.onStatusChange?.(false, `Process exited (code ${code})`);
          // Restart after a delay
          this.scheduleRestart();
        }
      });

      child.on('error', (err) => {
        console.error(`[WindsurfProxy] Error:`, err.message);
        this.child = null;
        this.onStatusChange?.(false, err.message);
        this.scheduleRestart();
      });

      // Wait for the proxy to be ready
      this.waitForReady().then((result) => {
        if (result) {
          this.onStatusChange?.(true);
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: 'Proxy startup timed out' });
        }
      });
    });
  }

  private async waitForReady(): Promise<boolean> {
    const deadline = Date.now() + PROXY_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const health = await this.healthCheck();
      if (health.ok) {
        console.log('[WindsurfProxy] Ready');
        this.resetRestartBackoff();
        return true;
      }
      await new Promise((r) => setTimeout(r, HEALTH_RETRY_INTERVAL_MS));
    }
    return false;
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return;
    if (this.restartAttempts >= WindsurfProxyManager.MAX_RESTART_ATTEMPTS) {
      console.warn('[WindsurfProxy] Restart attempts exhausted, giving up');
      this.onStatusChange?.(false, 'Reverse-proxy restart attempts exhausted; please check the logs');
      return;
    }
    // 5s, 15s, 60s, 120s, 300s, 600s
    const backoff = [5_000, 15_000, 60_000, 120_000, 300_000, 600_000];
    const delay = backoff[Math.min(this.restartAttempts, backoff.length - 1)];
    this.restartAttempts++;
    console.log(`[WindsurfProxy] Restarting in ${delay}ms (attempt ${this.restartAttempts}/${WindsurfProxyManager.MAX_RESTART_ATTEMPTS})...`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      // Clear port occupancy before restarting to prevent an EADDRINUSE loop
      killPortOccupants(WINDSURF_PROXY_PORT);
      this.start().catch(() => {});
    }, delay);
  }

  /** Called after a successful start to reset the backoff counter */
  private resetRestartBackoff(): void {
    this.restartAttempts = 0;
  }

  private killChild(): void {
    if (this.child && !this.child.killed) {
      try {
        if (this.child.pid) process.kill(-this.child.pid, 'SIGTERM');
      } catch {
        try { this.child.kill('SIGTERM'); } catch { /* ignore */ }
      }
    }
    this.child = null;
  }

  /** Cleanup on app exit */
  destroy(): void {
    this.started = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.killChild();
  }
}
