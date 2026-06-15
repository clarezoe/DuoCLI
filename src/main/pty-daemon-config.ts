import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface PtyDaemonConfig {
  port: number;
  token: string;
  pid?: number;
}

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.duocli');
const CONFIG_FILE = process.env.DUOCLI_PTY_DAEMON_CONFIG || path.join(DEFAULT_CONFIG_DIR, 'pty-daemon.json');
const CONFIG_DIR = path.dirname(CONFIG_FILE);
const DEFAULT_PORT = Number(process.env.DUOCLI_PTY_DAEMON_PORT || '9811');

export function getPtyDaemonConfigPath(): string {
  return CONFIG_FILE;
}

export function loadOrCreatePtyDaemonConfig(): PtyDaemonConfig {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as Partial<PtyDaemonConfig>;
      const config: PtyDaemonConfig = {
        port: Number(raw.port) || DEFAULT_PORT,
        token: typeof raw.token === 'string' && raw.token ? raw.token : crypto.randomBytes(24).toString('hex'),
        pid: typeof raw.pid === 'number' ? raw.pid : undefined,
      };
      savePtyDaemonConfig(config);
      return config;
    } catch {
      // Recreate below.
    }
  }
  const config: PtyDaemonConfig = {
    port: DEFAULT_PORT,
    token: crypto.randomBytes(24).toString('hex'),
  };
  savePtyDaemonConfig(config);
  return config;
}

export function savePtyDaemonConfig(config: PtyDaemonConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}
