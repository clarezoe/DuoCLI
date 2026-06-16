import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { cleanGeneratedTitle, requestTitleFromConfiguredAI, TitleAIConfig } from './title-ai';

const WINDSURF_PROXY_HOST = '127.0.0.1';
const WINDSURF_PROXY_PORT = 42100;

export interface ChatSession {
  id: string;
  title: string;
  titleLocked: boolean;
  titleUpdateCount: number;
  titleGenerationInFlight: boolean;
  model: string;
  workspace: string;
  createdAt: number;
  messages: ChatMessage[];
  proxySessionId: string | null; // Windsurf proxy's session ID
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ChatSessionEvents {
  onDelta: (sessionId: string, text: string) => void;
  onDone: (sessionId: string, content: string) => void;
  onError: (sessionId: string, error: string) => void;
  onTitleUpdate: (sessionId: string, title: string) => void;
}

export type TitleAIConfigProvider = () => TitleAIConfig | null;

export class ChatSessionManager extends EventEmitter {
  private sessions: Map<string, ChatSession> = new Map();
  private nextId = 1;
  private events: ChatSessionEvents;
  private activeStreams: Map<string, http.ClientRequest> = new Map();
  private getTitleAIConfig?: TitleAIConfigProvider;

  constructor(events: ChatSessionEvents, getTitleAIConfig?: TitleAIConfigProvider) {
    super();
    this.events = events;
    this.getTitleAIConfig = getTitleAIConfig;
    // Bridge: invoke callbacks synchronously when events are emitted
    this.on('onDelta', (sessionId: string, text: string) => events.onDelta(sessionId, text));
    this.on('onDone', (sessionId: string, content: string) => events.onDone(sessionId, content));
    this.on('onError', (sessionId: string, error: string) => events.onError(sessionId, error));
    this.on('onTitleUpdate', (sessionId: string, title: string) => events.onTitleUpdate(sessionId, title));
  }

  /** Check whether the Windsurf proxy is available */
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

  /** Get the list of available models */
  async listModels(): Promise<Array<{ id: string; credits: string }>> {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: WINDSURF_PROXY_HOST,
        port: WINDSURF_PROXY_PORT,
        path: '/v1/models',
        method: 'GET',
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve((parsed.data || []).map((m: any) => ({ id: m.id, credits: m.credits || '?' })));
          } catch {
            resolve([]);
          }
        });
      });
      req.on('error', () => resolve([]));
      req.on('timeout', () => { req.destroy(); resolve([]); });
      req.end();
    });
  }

  /** Create a chat session */
  create(workspace: string, model?: string): ChatSession {
    const id = `chat-${this.nextId++}`;
    const session: ChatSession = {
      id,
      title: '',
      titleLocked: false,
      titleUpdateCount: 0,
      titleGenerationInFlight: false,
      model: model || 'windsurf-default',
      workspace: workspace || os.homedir(),
      createdAt: Date.now(),
      messages: [],
      proxySessionId: null,
    };
    this.sessions.set(id, session);

    // Asynchronously create the session in the Windsurf proxy
    this.createProxySession(session).catch(() => {});

    return session;
  }

  /** Restore a closed chat session: create a new session and preload its message history */
  restore(workspace: string, model: string, messages: ChatMessage[], title?: string): ChatSession {
    const id = `chat-${this.nextId++}`;
    const session: ChatSession = {
      id,
      title: title || '',
      titleLocked: !!title,
      titleUpdateCount: title ? 1 : 0,
      titleGenerationInFlight: false,
      model: model || 'windsurf-default',
      workspace: workspace || os.homedir(),
      createdAt: Date.now(),
      messages: [...messages],
      proxySessionId: null,
    };
    this.sessions.set(id, session);

    // Asynchronously create the session in the Windsurf proxy
    this.createProxySession(session).catch(() => {});

    return session;
  }

  private async createProxySession(session: ChatSession): Promise<void> {
    const payload = JSON.stringify({
      model: session.model,
      title: session.title || 'New conversation',
      workspace: session.workspace,
    });

    return new Promise((resolve) => {
      const req = http.request({
        hostname: WINDSURF_PROXY_HOST,
        port: WINDSURF_PROXY_PORT,
        path: '/api/chat/sessions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.id) {
              session.proxySessionId = parsed.id;
            }
          } catch {}
          resolve();
        });
      });
      req.on('error', () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.write(payload);
      req.end();
    });
  }

  /** Send a message to the chat session */
  async sendMessage(sessionId: string, content: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    // Check for custom commands
    if (content.startsWith('/')) {
      await this.handleCustomCommand(session, content);
      return;
    }

    // Add the user message
    session.messages.push({ role: 'user', content, timestamp: Date.now() });

    // If there is no proxy session yet, create one first
    if (!session.proxySessionId) {
      await this.createProxySession(session);
    }

    // Send to the Windsurf proxy
    await this.sendToProxy(session, content);
  }

  private sendToProxy(session: ChatSession, content: string): Promise<void> {
    // Prefer the stateful chat-engine path: /api/chat/sessions/{id}/send
    // This reuses cascade_id for multi-turn, avoids <anthropic> tag issues,
    // and doesn't require packing history into each request.
    if (session.proxySessionId) {
      return this.sendViaChatEngine(session, content);
    }

    // Fallback: stateless /v1/chat/completions (only if proxy session not created yet)
    return this.sendViaCompletions(session, content);
  }

  /** Send via chat-engine SSE endpoint — preferred path */
  private sendViaChatEngine(session: ChatSession, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ content });

      const req = http.request({
        hostname: WINDSURF_PROXY_HOST,
        port: WINDSURF_PROXY_PORT,
        path: `/api/chat/sessions/${session.proxySessionId}/send`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 120000,
      }, (res) => {
        if ((res.statusCode || 500) >= 400) {
          let errData = '';
          res.on('data', (chunk) => { errData += chunk; });
          res.on('end', () => {
            this.activeStreams.delete(session.id);
            // If chat-engine fails, fall back to completions
            if (!session.proxySessionId) {
              this.sendViaCompletions(session, content).then(resolve).catch(reject);
              return;
            }
            this.emit('onError', session.id, errData || `HTTP ${res.statusCode}`);
            reject(new Error(errData));
          });
          return;
        }

        let buffer = '';
        let fullText = '';
        let doneEmitted = false;
        const finalize = (text: string) => {
          if (doneEmitted) return;
          doneEmitted = true;
          if (!session.messages.some(m => m.role === 'assistant' && m.content === text)) {
            session.messages.push({ role: 'assistant', content: text, timestamp: Date.now() });
          }
          this.emit('onDone', session.id, text);
          this.maybeGenerateTitle(session);
        };

        res.on('data', (chunk: Buffer) => {
          // Cross-chunk buffering: a single SSE event may be split across two data chunks;
          // splitting directly would push the latter half of the JSON into try/catch and swallow it -> dropped tokens
          buffer += chunk.toString('utf8');
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            try {
              const evt = JSON.parse(raw);
              if (evt.type === 'delta' && evt.text) {
                fullText += evt.text;
                this.emit('onDelta', session.id, evt.text);
              } else if (evt.type === 'done') {
                finalize(fullText || evt.content || '');
              } else if (evt.type === 'error') {
                this.emit('onError', session.id, evt.message || 'Unknown error');
              }
            } catch {}
          }
        });

        res.on('end', () => {
          this.activeStreams.delete(session.id);
          // If upstream never sent done, fall back to the accumulated text
          finalize(fullText);
          resolve();
        });
      });

      req.on('error', (err) => {
        this.activeStreams.delete(session.id);
        this.emit('onError', session.id, err.message);
        reject(err);
      });

      req.on('timeout', () => {
        this.activeStreams.delete(session.id);
        req.destroy();
        this.emit('onError', session.id, 'Request timed out');
        reject(new Error('Timeout'));
      });

      this.activeStreams.set(session.id, req);
      req.write(payload);
      req.end();
    });
  }

  /** Fallback: stateless /v1/chat/completions path */
  private sendViaCompletions(session: ChatSession, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        model: session.model,
        messages: [
          ...session.messages.slice(-20).map(m => ({ role: m.role, content: m.content })),
        ],
        stream: true,
      });

      const req = http.request({
        hostname: WINDSURF_PROXY_HOST,
        port: WINDSURF_PROXY_PORT,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 120000,
      }, (res) => {
        if ((res.statusCode || 500) >= 400) {
          let errData = '';
          res.on('data', (chunk) => { errData += chunk; });
          res.on('end', () => {
            this.emit('onError', session.id, errData || `HTTP ${res.statusCode}`);
            reject(new Error(errData));
          });
          return;
        }

        let buffer = '';
        let fullText = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed?.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullText += delta;
                this.emit('onDelta', session.id, delta);
              }
            } catch {}
          }
        });

        res.on('end', () => {
          this.activeStreams.delete(session.id);
          session.messages.push({ role: 'assistant', content: fullText, timestamp: Date.now() });
          this.emit('onDone', session.id, fullText);

          this.maybeGenerateTitle(session);

          resolve();
        });
      });

      req.on('error', (err) => {
        this.activeStreams.delete(session.id);
        this.emit('onError', session.id, err.message);
        reject(err);
      });

      req.on('timeout', () => {
        this.activeStreams.delete(session.id);
        req.destroy();
        this.emit('onError', session.id, 'Request timed out');
        reject(new Error('Timeout'));
      });

      this.activeStreams.set(session.id, req);
      req.write(payload);
      req.end();
    });
  }

  /** Stop the active stream */
  abortStream(sessionId: string): void {
    const req = this.activeStreams.get(sessionId);
    if (req) {
      req.destroy();
      this.activeStreams.delete(sessionId);
    }
  }

  // ========== Custom commands ==========

  private async handleCustomCommand(session: ChatSession, command: string): Promise<void> {
    const parts = command.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case '/auto-login':
        await this.cmdAutoLogin(session);
        break;
      case '/switch':
        await this.cmdSwitchAccount(session);
        break;
      case '/models':
        await this.cmdListModels(session);
        break;
      case '/health':
        await this.cmdHealthCheck(session);
        break;
      case '/clear':
        this.cmdClear(session);
        break;
      default:
        // Unknown command; send it to the AI
        session.messages.push({ role: 'user', content: command, timestamp: Date.now() });
        await this.sendToProxy(session, command);
        break;
    }
  }

  /** /auto-login - switch to the next account via the proxy server API */
  private async cmdAutoLogin(session: ChatSession): Promise<void> {
    const resultMsg: ChatMessage = {
      role: 'system',
      content: '',
      timestamp: Date.now(),
    };

    try {
      // First check whether the proxy server is running
      const health = await this.healthCheck();
      if (!health.ok) {
        resultMsg.content = '❌ Windsurf proxy server is not running; cannot switch accounts';
        session.messages.push(resultMsg);
        this.emit('onDone', session.id, resultMsg.content);
        return;
      }

      // Call the proxy server's rotate-account API so the server switches accounts correctly internally
      const rotateResult = await this.callProxyApi('/api/admin/rotate-account', 'POST');

      if (!rotateResult.ok) {
        resultMsg.content = `❌ Account switch failed: ${rotateResult.error || rotateResult.message || 'Unknown error'}`;
        session.messages.push(resultMsg);
        this.emit('onDone', session.id, resultMsg.content);
        return;
      }

      // Sync the plugin account-state file
      try {
        const accountsPath = path.join(
          os.homedir(), 'Documents', 'myDev', 'windsurf反代', 'server', 'windsurf-accounts.txt'
        );
        const statePath = path.join(
          os.homedir(), 'Library', 'Application Support', 'Windsurf', 'User', 'globalStorage',
          'session-sync-profiles.json'
        );

        if (fs.existsSync(accountsPath)) {
          const content = fs.readFileSync(accountsPath, 'utf8');
          const accounts = content.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;

          if (fs.existsSync(statePath)) {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            state.currentIndex = (rotateResult.currentIndex ?? 1) - 1;
            fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
          }
        }
      } catch (syncErr: any) {
        console.warn('[ChatSession] Failed to sync plugin state:', syncErr.message);
      }

      const total = rotateResult.total || '?';
      const idx = rotateResult.currentIndex || '?';
      const accounts = rotateResult.accounts || [];
      const currentAcc = accounts.find((a: any) => a.index === (idx as number) - 1);
      const email = currentAcc?.email || '?';

      resultMsg.content = `✅ Switched to account #${idx}/${total} (${email})\nThe proxy server account pool has been updated; subsequent requests will use the new account`;
    } catch (err: any) {
      resultMsg.content = `❌ Account switch failed: ${err.message}`;
    }

    session.messages.push(resultMsg);
    this.emit('onDone', session.id, resultMsg.content);
  }

  /** Call the Windsurf proxy server API */
  private callProxyApi(path: string, method: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const payload = method === 'POST' ? '{}' : undefined;
      const req = http.request({
        hostname: WINDSURF_PROXY_HOST,
        port: WINDSURF_PROXY_PORT,
        path,
        method,
        headers: payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {},
        timeout: 10000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ ok: false, error: data });
          }
        });
      });
      req.on('error', (err) => reject(err));
      req.on('timeout', () => { req.destroy(); reject(new Error('Proxy API timeout')); });
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** /switch - switch to a specific account */
  private async cmdSwitchAccount(session: ChatSession): Promise<void> {
    const resultMsg: ChatMessage = {
      role: 'system',
      content: 'Use /auto-login to automatically switch to the next available account',
      timestamp: Date.now(),
    };
    session.messages.push(resultMsg);
    this.emit('onDone',session.id, resultMsg.content);
  }

  /** /models - list available models */
  private async cmdListModels(session: ChatSession): Promise<void> {
    const models = await this.listModels();
    const resultMsg: ChatMessage = {
      role: 'system',
      content: models.length > 0
        ? 'Available models:\n' + models.map(m => `  • ${m.id} (${m.credits})`).join('\n')
        : '❌ Unable to fetch the model list; check whether Windsurf is running',
      timestamp: Date.now(),
    };
    session.messages.push(resultMsg);
    this.emit('onDone',session.id, resultMsg.content);
  }

  /** /health - health check */
  private async cmdHealthCheck(session: ChatSession): Promise<void> {
    const health = await this.healthCheck();
    const resultMsg: ChatMessage = {
      role: 'system',
      content: health.ok
        ? '✅ Windsurf proxy is running normally'
        : `❌ Windsurf proxy is unavailable: ${health.error || 'Unknown error'}`,
      timestamp: Date.now(),
    };
    session.messages.push(resultMsg);
    this.emit('onDone',session.id, resultMsg.content);
  }

  /** /clear - clear conversation history */
  private cmdClear(session: ChatSession): void {
    session.messages = [];
    const resultMsg: ChatMessage = {
      role: 'system',
      content: '✅ Conversation history cleared',
      timestamp: Date.now(),
    };
    session.messages.push(resultMsg);
    this.emit('onDone',session.id, resultMsg.content);
  }

  // ========== Management methods ==========

  getSession(id: string): ChatSession | undefined {
    return this.sessions.get(id);
  }

  getAllSessions(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  private maybeGenerateTitle(session: ChatSession): void {
    if (session.titleLocked || session.titleGenerationInFlight) return;

    const userMsgs = session.messages.filter(m => m.role === 'user');
    if (userMsgs.length < 1 || userMsgs.length > 5) return;

    this.generateTitle(session).catch(() => {});
  }

  /** Have the AI generate a title from the accumulated conversation history (kept updating across rounds 2-5) */
  private async generateTitle(session: ChatSession): Promise<void> {
    session.titleGenerationInFlight = true;
    console.log('[Chat Title] Generating title for session:', session.id,
      'with', session.messages.length, 'messages');

    try {
      // Use only user messages to build the title (truncate each to 200 chars to avoid token blowup)
      const history = session.messages
        .filter(m => m.role === 'user')
        .map(m => m.content.slice(0, 200))
        .join('\n');

      const prompt = `Generate a short title for the following conversation (no more than 15 characters; output the title directly, without quotes or any explanation):\n\n${history}`;

      const title = await this.requestTitleFromAI(session.model, prompt);
      if (title) {
        console.log('[Chat Title] Generated title:', title);
        if (!session.titleLocked) {
          session.title = title.slice(0, 50);
          session.titleUpdateCount++;
          this.emit('onTitleUpdate', session.id, session.title);
        }
      } else {
        console.log('[Chat Title] No title returned from AI, using fallback');
        const firstUser = session.messages.find(m => m.role === 'user');
        if (!session.titleLocked) {
          session.title = firstUser ? firstUser.content.slice(0, 30) : '';
          session.titleUpdateCount++;
          this.emit('onTitleUpdate', session.id, session.title);
        }
      }
    } catch (error) {
      console.error('[Chat Title] Title generation failed:', error);
      const firstUser = session.messages.find(m => m.role === 'user');
      if (!session.titleLocked) {
        session.title = firstUser ? firstUser.content.slice(0, 30) : '';
        session.titleUpdateCount++;
        this.emit('onTitleUpdate', session.id, session.title);
      }
    } finally {
      session.titleGenerationInFlight = false;
    }
  }

  /** Send a lightweight /v1/chat/completions request to have the AI generate a title */
  private requestTitleFromAI(model: string, prompt: string): Promise<string> {
    const config = this.getTitleAIConfig?.();
    console.log('[Chat Title] AI config available:', !!config);
    
    if (config?.baseUrl && config.apiKey && config.model) {
      console.log('[Chat Title] Using configured AI service:', config.apiFormat, config.model);
      return requestTitleFromConfiguredAI(config, prompt);
    }

    console.log('[Chat Title] Using Windsurf proxy for title generation');
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 64,
        reasoning_effort: 'minimal',
        stream: false,
      });

      const req = http.request({
        hostname: WINDSURF_PROXY_HOST,
        port: WINDSURF_PROXY_PORT,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': 'Bearer posse',
        },
        timeout: 15000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString('utf8'); });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const title = parsed?.choices?.[0]?.message?.content?.trim() || '';
            resolve(cleanGeneratedTitle(title));
          } catch {
            reject(new Error('Failed to parse title response'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Title request timeout')); });
      req.write(payload);
      req.end();
    });
  }

  destroy(id: string): void {
    this.abortStream(id);
    this.sessions.delete(id);
  }

  rename(id: string, title: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.title = title;
      session.titleLocked = true;
    }
  }
}
