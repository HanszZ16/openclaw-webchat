import { RefreshCw, Activity, Users, Brain, ScrollText, Clock, Server } from 'lucide-react';
import type { AdminData, LogEntry } from '../lib/useAdminData';
import type { AgentEntry, HealthAgent, CronJob, CronRunLogEntry, SessionRow } from '../lib/gateway';

type Props = {
  data: AdminData;
  connected: boolean;
};

// ── Formatters ──

function formatUptime(ms: number | null): string {
  if (ms == null) return '--';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m ${sec}s`;
}

function formatTime(ts?: number | string | null): string {
  if (!ts) return '--';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function formatRelativeTime(ts?: number | null): string {
  if (!ts) return '--';
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

function formatTokens(n?: number | null): string {
  if (n == null) return '--';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatSchedule(job: CronJob): string {
  const s = job.schedule;
  if (s.kind === 'cron' && s.expr) return `cron: ${s.expr}${s.tz ? ` (${s.tz})` : ''}`;
  if (s.kind === 'every' && s.everyMs) {
    const mins = s.everyMs / 60000;
    if (mins >= 60) return `每 ${(mins / 60).toFixed(0)} 小时`;
    return `每 ${mins.toFixed(0)} 分钟`;
  }
  if (s.kind === 'at' && s.at) return `定时: ${formatTime(s.at)}`;
  return '--';
}

function levelColor(level?: string | null): string {
  switch (level) {
    case 'error': case 'fatal': return 'text-red-600';
    case 'warn': return 'text-yellow-600';
    case 'info': return 'text-emerald-600';
    case 'debug': case 'trace': return 'text-gray-400';
    default: return 'text-gray-500';
  }
}

function statusColor(status?: string): string {
  switch (status) {
    case 'ok': case 'success': return 'text-emerald-600';
    case 'error': case 'failed': return 'text-red-600';
    case 'skipped': return 'text-yellow-600';
    case 'running': return 'text-blue-600';
    default: return 'text-gray-500';
  }
}

// ── Reusable components ──

function Section({ title, icon: Icon, badge, children }: {
  title: string;
  icon: typeof Activity;
  badge?: string | number | null;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-section">
      <h3 className="admin-section-title">
        <Icon className="w-4 h-4 text-emerald-600" />
        {title}
        {badge != null && (
          <span className="ml-auto text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{badge}</span>
        )}
      </h3>
      <div className="admin-section-body">{children}</div>
    </div>
  );
}

function StatusCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="admin-card">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-sm font-medium text-gray-800 truncate">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function Chip({ children, color = 'gray' }: { children: React.ReactNode; color?: 'green' | 'red' | 'gray' | 'blue' | 'yellow' }) {
  const cls = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  }[color];
  return <span className={`inline-flex items-center text-[11px] px-1.5 py-0.5 rounded border ${cls}`}>{children}</span>;
}

// ── System Status ──
function SystemStatusSection({ data, connected }: Props) {
  const { uptimeMs, serverVersion, tickIntervalMs, authMode, status, health } = data;
  const defaultModel = status?.sessions?.defaults?.model || '--';
  const sessionCount = status?.sessions?.count ?? data.sessions?.count ?? '--';
  const agentCount = data.agents?.agents?.length ?? '--';

  return (
    <Section title="系统状态" icon={Activity}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatusCard label="状态" value={connected ? '在线' : '离线'} />
        <StatusCard label="默认模型" value={String(defaultModel)} />
        <StatusCard label="运行时间" value={formatUptime(uptimeMs)} />
        <StatusCard label="Gateway 版本" value={serverVersion || '--'} />
      </div>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatusCard label="认证模式" value={authMode || 'none'} />
        <StatusCard label="Tick 间隔" value={tickIntervalMs ? `${tickIntervalMs}ms` : '--'} />
        <StatusCard label="Agent 数量" value={String(agentCount)} />
        <StatusCard label="会话数量" value={String(sessionCount)} />
      </div>
      {health && health.ok != null && (
        <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
          <span>健康检查: <span className={health.ok ? 'text-emerald-600' : 'text-red-600'}>{health.ok ? 'OK' : '异常'}</span></span>
          {health.durationMs != null && <span>耗时: {health.durationMs}ms</span>}
          {health.heartbeatSeconds != null && <span>心跳: {health.heartbeatSeconds}s</span>}
        </div>
      )}
    </Section>
  );
}

// ── Team / Agents ──
function AgentRow({ agent, healthAgent }: { agent: AgentEntry; healthAgent?: HealthAgent }) {
  const name = agent.identity?.name || agent.name || agent.id;
  const emoji = agent.identity?.emoji;
  const sessionCount = healthAgent?.sessions?.count ?? 0;
  const hb = healthAgent?.heartbeat;

  return (
    <div className="admin-list-row">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {emoji ? (
          <span className="text-lg shrink-0 w-7 text-center">{emoji}</span>
        ) : (
          <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
            <Users className="w-3.5 h-3.5 text-emerald-600" />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800 truncate">{name}</div>
          <div className="text-xs text-gray-400 truncate">{agent.id}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {healthAgent?.isDefault && <Chip color="green">默认</Chip>}
        {hb && <Chip color={hb.enabled ? 'blue' : 'gray'}>{hb.enabled ? `心跳 ${hb.every}` : '心跳关闭'}</Chip>}
        <Chip>{sessionCount} 会话</Chip>
      </div>
    </div>
  );
}

function TeamSection({ data }: { data: AdminData }) {
  const agentList = data.agents?.agents ?? [];
  const healthAgents = data.health?.agents ?? [];
  const healthMap = new Map(healthAgents.map((a) => [a.agentId, a]));

  return (
    <Section title="团队状态" icon={Users} badge={agentList.length || null}>
      {agentList.length === 0 ? (
        <div className="text-sm text-gray-400 py-2">暂无 Agent</div>
      ) : (
        <div className="space-y-1">
          {agentList.map((agent) => (
            <AgentRow key={agent.id} agent={agent} healthAgent={healthMap.get(agent.id)} />
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Sessions / Memory ──
function SessionRowItem({ session }: { session: SessionRow }) {
  const name = session.displayName || session.derivedTitle || session.label || session.key;
  const tokens = session.totalTokens;
  const kind = session.kind || 'unknown';

  return (
    <div className="admin-list-row">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="min-w-0">
          <div className="text-sm text-gray-700 truncate">{name}</div>
          {session.lastMessagePreview && (
            <div className="text-xs text-gray-400 truncate max-w-[300px]">{session.lastMessagePreview}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Chip>{kind}</Chip>
        {session.model && <Chip color="blue">{session.model}</Chip>}
        {tokens != null && <span className="text-xs text-gray-500">{formatTokens(tokens)} tokens</span>}
        <span className="text-xs text-gray-400 w-[70px] text-right">{formatRelativeTime(session.updatedAt)}</span>
      </div>
    </div>
  );
}

function SessionsSection({ data }: { data: AdminData }) {
  const sessionsList = data.sessions?.sessions ?? [];
  const defaultModel = data.sessions?.defaults?.model;
  const contextTokens = data.sessions?.defaults?.contextTokens;

  return (
    <Section title="会话与记忆" icon={Brain} badge={data.sessions?.count ?? null}>
      {defaultModel && (
        <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
          <span>默认模型: <span className="text-gray-700">{defaultModel}</span></span>
          {contextTokens && <span>上下文: <span className="text-gray-700">{formatTokens(contextTokens)}</span></span>}
          <span>存储: <span className="text-gray-700 font-mono">{data.sessions?.path || '--'}</span></span>
        </div>
      )}
      {sessionsList.length === 0 ? (
        <div className="text-sm text-gray-400 py-2">暂无活跃会话</div>
      ) : (
        <div className="space-y-1">
          {sessionsList.slice(0, 20).map((s) => (
            <SessionRowItem key={s.key} session={s} />
          ))}
          {sessionsList.length > 20 && (
            <div className="text-xs text-gray-400 pt-1">还有 {sessionsList.length - 20} 个会话...</div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Logs ──
function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div className="admin-log-row">
      <span className="text-xs text-gray-400 shrink-0 w-[140px]">{formatTime(entry.time)}</span>
      {entry.level && (
        <span className={`text-xs font-mono uppercase shrink-0 w-[44px] ${levelColor(entry.level)}`}>{entry.level}</span>
      )}
      {entry.subsystem && (
        <span className="text-xs text-gray-400 shrink-0 w-[80px] truncate">{entry.subsystem}</span>
      )}
      <span className="text-xs text-gray-700 truncate">{entry.message || entry.raw}</span>
    </div>
  );
}

function LogsSection({ data }: { data: AdminData }) {
  return (
    <Section title="任务日志" icon={ScrollText} badge={data.logs.length || null}>
      {data.logs.length === 0 ? (
        <div className="text-sm text-gray-400 py-2">暂无日志</div>
      ) : (
        <div className="admin-log-list">
          {data.logs.slice(-80).map((log, i) => (
            <LogRow key={i} entry={log} />
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Cron ──
function CronJobRow({ job }: { job: CronJob }) {
  const nextRun = job.state?.nextRunAtMs ? formatRelativeTime(job.state.nextRunAtMs) : '--';
  const lastStatus = job.state?.lastStatus;
  const prompt = job.payload?.message || job.payload?.text || '';

  return (
    <div className="admin-list-row flex-col items-start gap-1 !py-2.5">
      <div className="flex items-center gap-2 w-full">
        <div className={`w-2 h-2 rounded-full shrink-0 ${job.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`} />
        <span className="text-sm font-medium text-gray-800 truncate">{job.name}</span>
        {job.agentId && <Chip>{job.agentId}</Chip>}
        <div className="ml-auto flex items-center gap-2">
          {lastStatus && <Chip color={lastStatus === 'ok' ? 'green' : lastStatus === 'error' ? 'red' : 'yellow'}>{lastStatus}</Chip>}
          <Chip color={job.enabled ? 'green' : 'gray'}>{job.enabled ? '启用' : '停用'}</Chip>
        </div>
      </div>
      <div className="flex items-center gap-3 pl-4 text-xs text-gray-400 w-full">
        <span>{formatSchedule(job)}</span>
        <span>下次: {nextRun}</span>
        {job.state?.lastRunAtMs && <span>上次: {formatRelativeTime(job.state.lastRunAtMs)}</span>}
      </div>
      {prompt && (
        <div className="pl-4 text-xs text-gray-500 truncate max-w-full">{prompt}</div>
      )}
    </div>
  );
}

function CronRunRow({ run }: { run: CronRunLogEntry }) {
  return (
    <div className="admin-log-row">
      <span className="text-xs text-gray-400 shrink-0 w-[140px]">{formatTime(run.ts)}</span>
      <span className={`text-xs font-mono shrink-0 w-[48px] ${statusColor(run.status)}`}>{run.status || '--'}</span>
      <span className="text-xs text-gray-700 truncate flex-1">{run.jobName || run.jobId || '--'}</span>
      {run.summary && <span className="text-xs text-gray-400 truncate max-w-[200px]">{run.summary}</span>}
      {run.durationMs != null && <span className="text-xs text-gray-400 shrink-0">{(run.durationMs / 1000).toFixed(1)}s</span>}
      {run.model && <Chip color="blue">{run.model}</Chip>}
    </div>
  );
}

function CronSection({ data }: { data: AdminData }) {
  const { cronStatus, cronJobs, cronRuns } = data;

  return (
    <Section title="定时任务" icon={Clock} badge={cronStatus?.jobs ?? null}>
      {cronStatus && (
        <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
          <span>状态: <span className={cronStatus.enabled ? 'text-emerald-600' : 'text-red-500'}>{cronStatus.enabled ? '启用' : '停用'}</span></span>
          <span>任务数: {cronStatus.jobs}</span>
          {cronStatus.nextWakeAtMs && <span>下次唤醒: {formatTime(cronStatus.nextWakeAtMs)}</span>}
        </div>
      )}

      {cronJobs.length > 0 && (
        <div className="space-y-0.5 mb-4">
          <div className="text-xs font-medium text-gray-500 mb-1.5">任务列表</div>
          {cronJobs.map((job) => (
            <CronJobRow key={job.id} job={job} />
          ))}
        </div>
      )}

      {cronRuns.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1.5">最近执行记录</div>
          <div className="admin-log-list">
            {cronRuns.map((run, i) => (
              <CronRunRow key={run.ts ? `${run.ts}-${i}` : i} run={run} />
            ))}
          </div>
        </div>
      )}

      {cronJobs.length === 0 && cronRuns.length === 0 && !cronStatus && (
        <div className="text-sm text-gray-400 py-2">暂无定时任务</div>
      )}
    </Section>
  );
}

// ── Main ──
export function AdminPanel({ data, connected }: Props) {
  return (
    <div className="admin-panel">
      <div className="admin-header">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-white/80" />
          <h2 className="text-lg font-bold">管理面板</h2>
        </div>
        <div className="flex items-center gap-2">
          {!connected && <span className="text-xs text-red-200">未连接</span>}
          {data.loading && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          <button
            onClick={data.refresh}
            className="p-1.5 rounded-lg transition-colors"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {data.error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs">
          {data.error}
        </div>
      )}

      <div className="admin-content">
        <SystemStatusSection data={data} connected={connected} />
        <TeamSection data={data} />
        <SessionsSection data={data} />
        <LogsSection data={data} />
        <CronSection data={data} />
      </div>
    </div>
  );
}
