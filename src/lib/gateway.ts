// OpenClaw Gateway WebSocket Client
// Implements the v3 protocol for connecting to OpenClaw Gateway

export type GatewayEventFrame = {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
};

export type GatewayResponseFrame = {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
};

export type HelloOk = {
  type: 'hello-ok';
  protocol: number;
  server?: { version?: string; connId?: string };
  features?: { methods?: string[]; events?: string[] };
  snapshot?: unknown;
  auth?: { deviceToken?: string; role?: string; scopes?: string[] };
  policy?: { tickIntervalMs?: number };
};

export type ToolEventData = {
  toolCallId: string;
  name: string;
  phase: 'start' | 'update' | 'result';
  args?: unknown;
  partialResult?: string;
  result?: string;
};

export type ChatRunPayload = {
  runId: string;
  sessionKey: string;
  state: 'delta' | 'final' | 'aborted' | 'error';
  message?: unknown;
  errorMessage?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

export type GatewayClientOptions = {
  url: string;
  password?: string;
  token?: string;
  onHello?: (hello: HelloOk) => void;
  onEvent?: (evt: GatewayEventFrame) => void;
  onClose?: (info: { code: number; reason: string }) => void;
  onConnectedChange?: (connected: boolean) => void;
};

let counter = 0;
function nextId(): string {
  return `req-${Date.now()}-${++counter}`;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private connectSent = false;
  private backoffMs = 800;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private opts: GatewayClientOptions;

  constructor(opts: GatewayClientOptions) {
    this.opts = opts;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.connectSent;
  }

  start() {
    this.closed = false;
    this.doConnect();
  }

  stop() {
    this.closed = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.flushPending(new Error('client stopped'));
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('not connected');
    }
    const id = nextId();
    const frame = { type: 'req', id, method, params: params ?? {} };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  private resolveWsUrl(targetUrl: string): string {
    // If the target is already a relative path (e.g., /gw), use it directly
    if (targetUrl.startsWith('/') || targetUrl.startsWith('ws://localhost') || targetUrl.startsWith('ws://127.0.0.1')) {
      return targetUrl;
    }
    // For remote gateways, route through the proxy to avoid origin issues
    const loc = window.location;
    const wsProtocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const proxyBase = `${wsProtocol}//${loc.host}/ws-proxy`;
    return `${proxyBase}?target=${encodeURIComponent(targetUrl)}`;
  }

  private doConnect() {
    if (this.closed) return;
    this.connectSent = false;

    // Route through proxy to avoid CORS/origin issues
    // In dev: Vite proxy at /gw; In prod: server.mjs proxy at /ws-proxy
    const wsUrl = this.resolveWsUrl(this.opts.url);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.addEventListener('open', () => {
      // Wait briefly for connect.challenge, then send connect anyway
      this.connectTimer = setTimeout(() => this.sendConnect(), 750);
    });

    ws.addEventListener('message', (ev) => {
      this.handleMessage(String(ev.data ?? ''));
    });

    ws.addEventListener('close', (ev) => {
      this.ws = null;
      this.connectSent = false;
      this.flushPending(new Error(`closed (${ev.code}): ${ev.reason}`));
      this.opts.onConnectedChange?.(false);
      this.opts.onClose?.({ code: ev.code, reason: ev.reason });
      this.scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // close handler will fire
    });
  }

  private scheduleReconnect() {
    if (this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }

  private async sendConnect() {
    if (this.connectSent) return;
    this.connectSent = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'openclaw-control-ui',
        version: '1.0.0',
        platform: 'web',
        mode: 'ui',
      },
      role: 'operator',
      scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'],
      caps: ['tool-events', 'thinking-events'],
      auth: {} as Record<string, string>,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    };

    if (this.opts.token) {
      (params.auth as Record<string, string>).deviceToken = this.opts.token;
    } else if (this.opts.password) {
      (params.auth as Record<string, string>).password = this.opts.password;
    }

    try {
      const res = await this.request<HelloOk>('connect', params);
      this.backoffMs = 800; // reset backoff on success
      this.opts.onConnectedChange?.(true);
      this.opts.onHello?.(res);
    } catch (err) {
      console.error('Connect failed:', err);
      this.ws?.close();
    }
  }

  private handleMessage(raw: string) {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    const type = frame.type as string;

    if (type === 'event') {
      const evt = frame as unknown as GatewayEventFrame;
      // Handle connect.challenge
      if (evt.event === 'connect.challenge') {
        // nonce received from server (not used in password-only auth)
        // Send connect immediately when challenge is received
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        this.sendConnect();
        return;
      }
      this.opts.onEvent?.(evt);
      return;
    }

    if (type === 'res' || type === 'hello-ok') {
      const res = frame as unknown as GatewayResponseFrame;
      const id = res.id;
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        if (res.ok !== false) {
          p.resolve(res.payload ?? res);
        } else {
          p.reject(new Error(res.error?.message ?? 'request failed'));
        }
      }
      // hello-ok might also come as a response to connect
      if (type === 'hello-ok') {
        this.backoffMs = 800;
        this.opts.onConnectedChange?.(true);
        this.opts.onHello?.(frame as unknown as HelloOk);
      }
      return;
    }
  }

  // ── Admin Panel API methods ──

  async getStatus(): Promise<StatusResult> {
    return this.request('status');
  }

  async getHealth(): Promise<HealthResult> {
    return this.request('health');
  }

  async getAgentsList(): Promise<AgentsListResult> {
    return this.request('agents.list');
  }

  async getSessionsList(params?: { limit?: number; activeMinutes?: number; includeGlobal?: boolean }): Promise<SessionsListResult> {
    return this.request('sessions.list', {
      limit: 50,
      activeMinutes: 1440,
      includeGlobal: true,
      includeUnknown: true,
      ...params,
    });
  }

  async getSkillsStatus(agentId?: string): Promise<SkillsStatusResult> {
    return this.request('skills.status', { agentId });
  }

  async getLogsTail(cursor?: number, limit = 200): Promise<LogsTailResult> {
    return this.request('logs.tail', { cursor, limit, maxBytes: 512000 });
  }

  async getCronStatus(): Promise<CronStatusResult> {
    return this.request('cron.status');
  }

  async getCronList(params?: { limit?: number; offset?: number; includeDisabled?: boolean }): Promise<CronListResult> {
    return this.request('cron.list', {
      includeDisabled: true,
      limit: 50,
      offset: 0,
      sortBy: 'nextRunAtMs',
      sortDir: 'asc',
      ...params,
    });
  }

  async getCronRuns(params?: { limit?: number; offset?: number; scope?: string }): Promise<CronRunsResult> {
    return this.request('cron.runs', {
      scope: 'all',
      limit: 20,
      offset: 0,
      sortDir: 'desc',
      ...params,
    });
  }

  private flushPending(err: Error) {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }
}

// ── Admin Panel types ──

// ── Status (from "status" method) ──
export type StatusResult = {
  heartbeat?: {
    defaultAgentId?: string;
    agents?: {
      agentId: string;
      enabled: boolean;
      every: string;
      everyMs: number | null;
    }[];
  };
  sessions?: {
    paths?: string[];
    count?: number;
    defaults?: {
      model?: string | null;
      contextTokens?: number | null;
    };
    recent?: SessionStatusEntry[];
    byAgent?: {
      agentId: string;
      path: string;
      count: number;
      recent: SessionStatusEntry[];
    }[];
  };
  channelSummary?: string[];
  [key: string]: unknown;
};

export type SessionStatusEntry = {
  key: string;
  kind?: string;
  agentId?: string;
  updatedAt?: number | null;
  age?: number | null;
  model?: string | null;
  contextTokens?: number | null;
  thinkingLevel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number | null;
  remainingTokens?: number | null;
  percentUsed?: number | null;
  flags?: string[];
  [key: string]: unknown;
};

// ── Health (from "health" method) ──
export type HealthResult = {
  ok?: boolean;
  ts?: number;
  durationMs?: number;
  heartbeatSeconds?: number;
  defaultAgentId?: string;
  agents?: HealthAgent[];
  sessions?: {
    path?: string;
    count?: number;
    recent?: { key: string; updatedAt?: number | null; age?: number | null }[];
  };
  channels?: Record<string, unknown>;
  channelOrder?: string[];
  channelLabels?: Record<string, string>;
  [key: string]: unknown;
};

export type HealthAgent = {
  agentId: string;
  name?: string;
  isDefault?: boolean;
  heartbeat?: {
    enabled: boolean;
    every: string;
    everyMs: number | null;
  };
  sessions?: {
    path?: string;
    count?: number;
    recent?: { key: string; updatedAt?: number | null; age?: number | null }[];
  };
};

// ── Agents (from "agents.list" method) ──
export type AgentsListResult = {
  defaultId?: string;
  mainKey?: string;
  scope?: string;
  agents?: AgentEntry[];
};

export type AgentEntry = {
  id: string;
  name?: string;
  identity?: {
    name?: string;
    theme?: string;
    emoji?: string;
    avatar?: string;
    avatarUrl?: string;
  };
};

// ── Sessions (from "sessions.list" method) ──
export type SessionsListResult = {
  ts?: number;
  path?: string;
  count?: number;
  defaults?: {
    model?: string | null;
    contextTokens?: number | null;
  };
  sessions?: SessionRow[];
};

export type SessionRow = {
  key: string;
  kind?: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  updatedAt?: number | null;
  model?: string | null;
  contextTokens?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  thinkingLevel?: string;
  verboseLevel?: string;
  [key: string]: unknown;
};

// ── Logs ──
export type LogsTailResult = {
  file?: string;
  cursor?: number;
  size?: number;
  lines: string[];
  truncated?: boolean;
  reset?: boolean;
};

// ── Cron ──
export type CronStatusResult = {
  enabled: boolean;
  jobs: number;
  nextWakeAtMs?: number | null;
};

export type CronJob = {
  id: string;
  name: string;
  description?: string;
  agentId?: string;
  enabled: boolean;
  schedule: {
    kind?: string;
    expr?: string;
    tz?: string;
    everyMs?: number;
    at?: string;
    [key: string]: unknown;
  };
  sessionTarget?: string;
  wakeMode?: string;
  payload?: {
    kind?: string;
    text?: string;
    message?: string;
    [key: string]: unknown;
  };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
  };
  [key: string]: unknown;
};

export type CronListResult = {
  jobs?: CronJob[];
  total?: number;
  hasMore?: boolean;
};

export type CronRunLogEntry = {
  ts?: number;
  jobId?: string;
  jobName?: string;
  status?: string;
  summary?: string;
  error?: string;
  durationMs?: number;
  model?: string;
  provider?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  sessionKey?: string;
  delivered?: boolean;
  deliveryStatus?: string;
  nextRunAtMs?: number;
  [key: string]: unknown;
};

export type CronRunsResult = {
  jobs?: CronRunLogEntry[];
  total?: number;
  hasMore?: boolean;
};

// ── Skills ──
export type SkillEntry = {
  key: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  disabled?: boolean;
  bundled?: boolean;
  source?: string;
  pluginId?: string;
  emoji?: string;
  homepage?: string;
  eligible?: boolean;
  requiresAuth?: boolean;
  hasApiKey?: boolean;
  filePath?: string;
  baseDir?: string;
  skillKey?: string;
  [key: string]: unknown;
};

export type SkillsStatusResult = {
  workspaceDir?: string;
  managedSkillsDir?: string;
  skills?: SkillEntry[];
};
