import { ChildProcess, execFileSync, execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface CloudflaredStatus {
  installed: boolean;
  running: boolean;
  url: string;
  configPath: string;
  message?: string;
}

const TEMPLATE_MARKERS = [
  'YOUR_TUNNEL_NAME',
  'YOUR_TUNNEL_ID',
  '/ABSOLUTE/PATH/TO/',
  'duocli.example.com',
];

export class CloudflaredManager {
  private child: ChildProcess | null = null;
  private readonly configPath: string;
  private readonly logPath: string;

  constructor(projectRoot: string) {
    this.configPath = this.resolveConfigPath(projectRoot);
    this.logPath = path.join(path.dirname(this.configPath), 'cloudflared.log');
  }

  getStatus(): CloudflaredStatus {
    const installed = Boolean(this.resolveBinary());
    const running = this.isRunning();
    const config = this.readConfig();
    const publicUrl = config.hostname ? `https://${config.hostname}` : '';
    const configReady = this.isConfigReady(config.raw);
    const message = this.getStatusMessage(installed, configReady, config);
    return {
      installed,
      running,
      url: publicUrl,
      configPath: this.configPath,
      message,
    };
  }

  start(): CloudflaredStatus {
    // Cleanup before start: kill cloudflared processes left over from old instances
    // Note: port 9800 is cleaned up by remote-server before it starts; do not touch it here, or it would kill the current Electron process
    this.killStaleCloudflared();

    const bin = this.resolveBinary();
    if (!bin) return this.getStatus();
    const config = this.readConfig();
    const publicUrl = config.hostname ? `https://${config.hostname}` : '';
    if (!config.exists) {
      return {
        installed: true,
        running: false,
        url: publicUrl,
        configPath: this.configPath,
        message: `cloudflared config not found: ${this.configPath}`,
      };
    }
    if (!this.isConfigReady(config.raw)) {
      return {
        installed: true,
        running: false,
        url: publicUrl,
        configPath: this.configPath,
        message: `Cloudflare config incomplete; please fill in your local private config: ${this.configPath}`,
      };
    }
    if (this.isRunning()) return this.getStatus();

    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    const out = fs.openSync(this.logPath, 'a');
    const child = spawn(bin, ['tunnel', '--config', this.configPath, 'run'], {
      detached: true,
      stdio: ['ignore', out, out],
    });
    this.child = child;
    child.unref();
    child.on('exit', () => {
      this.child = null;
    });
    return {
      installed: true,
      running: true,
      url: publicUrl,
      configPath: this.configPath,
    };
  }

  stopOwnedProcess(): void {
    if (!this.child || this.child.killed) return;
    // Kill the entire process group (cloudflared may spawn child processes)
    if (this.child.pid) {
      try { process.kill(-this.child.pid, 'SIGKILL'); } catch { /* ignore */ }
      try { process.kill(this.child.pid, 'SIGKILL'); } catch { /* ignore */ }
    }
    try { this.child.kill('SIGKILL'); } catch { /* ignore */ }
    this.child = null;
    // Ensure any leftover cloudflared processes are cleaned up too
    this.killStaleCloudflared();
  }

  /** Kill cloudflared processes left over from old Posse instances */
  private killStaleCloudflared(): void {
    try {
      // Match cloudflared tunnel processes related to this config
      const out = execSync(
        `pgrep -f 'cloudflared.*cloudflared-config' 2>/dev/null || true`,
        { encoding: 'utf-8', timeout: 5000 },
      );
      const pids = out.trim().split('\n').filter(Boolean).map(Number).filter(n => !isNaN(n));
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL');
          console.log(`[Cloudflared] Killed stale cloudflared PID ${pid}`);
        } catch {
          // Process may no longer exist
        }
      }
    } catch {
      // pgrep failed, ignore
    }
  }

  /** Kill the process occupying the given port */
  private killPortOccupants(port: number): void {
    try {
      const out = execSync(`lsof -i :${port} -t -sTCP:LISTEN 2>/dev/null || true`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const pids = out.trim().split('\n').filter(Boolean).map(Number).filter(n => !isNaN(n));
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL');
          console.log(`[Cloudflared] Killed port ${port} occupant PID ${pid}`);
        } catch {
          // Process may no longer exist
        }
      }
    } catch {
      // lsof failed, ignore
    }
  }

  private resolveConfigPath(projectRoot: string): string {
    const candidates = [
      path.join(projectRoot, 'frp', 'cloudflared-config.local.yml'),
      path.join(projectRoot, 'frp', 'cloudflared-config.private.yml'),
      process.resourcesPath ? path.join(process.resourcesPath, 'frp', 'cloudflared-config.local.yml') : '',
      process.resourcesPath ? path.join(process.resourcesPath, 'frp', 'cloudflared-config.private.yml') : '',
      process.resourcesPath ? path.join(process.resourcesPath, 'frp', 'cloudflared-config.yml') : '',
      path.join(projectRoot, 'frp', 'cloudflared-config.yml'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    return path.join(projectRoot, 'frp', 'cloudflared-config.local.yml');
  }

  private resolveBinary(): string | null {
    const candidates = [
      process.env.POSSE_CLOUDFLARED_BIN || '',
      '/opt/homebrew/bin/cloudflared',
      '/usr/local/bin/cloudflared',
      'cloudflared',
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (candidate.includes('/')) {
        if (fs.existsSync(candidate)) return candidate;
        continue;
      }
      try {
        execFileSync('/usr/bin/which', [candidate], { stdio: 'ignore' });
        return candidate;
      } catch { /* try next */ }
    }
    return null;
  }

  private isRunning(): boolean {
    if (this.child && !this.child.killed) return true;
    try {
      execFileSync('/usr/bin/pgrep', ['-f', 'cloudflared.*cloudflared-config'], { stdio: 'ignore' });
      return true;
    } catch { /* not running */ }
    return false;
  }

  private readConfig(): { exists: boolean; raw: string; hostname: string | null } {
    if (!fs.existsSync(this.configPath)) {
      return { exists: false, raw: '', hostname: null };
    }
    const raw = fs.readFileSync(this.configPath, 'utf-8');
    const hostnameMatch = raw.match(/^\s*-\s*hostname:\s*([^\s#]+)\s*$/m);
    return {
      exists: true,
      raw,
      hostname: hostnameMatch ? hostnameMatch[1].trim() : null,
    };
  }

  private isConfigReady(raw: string): boolean {
    if (!raw.trim()) return false;
    return !TEMPLATE_MARKERS.some(marker => raw.includes(marker));
  }

  private getStatusMessage(
    installed: boolean,
    configReady: boolean,
    config: { exists: boolean; hostname: string | null },
  ): string | undefined {
    if (!installed) return 'cloudflared is not installed; run: brew install cloudflared';
    if (!config.exists) return `cloudflared config not found: ${this.configPath}`;
    if (!configReady) return `Cloudflare config incomplete; please fill in your local private config: ${this.configPath}`;
    if (!config.hostname) return `Cloudflare config is missing hostname: ${this.configPath}`;
    return undefined;
  }
}
