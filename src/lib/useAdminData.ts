import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type {
  GatewayClient,
  HelloOk,
  StatusResult,
  HealthResult,
  AgentsListResult,
  SessionsListResult,
  CronStatusResult,
  CronJob,
  CronRunLogEntry,
} from './gateway';

export type AdminData = {
  // System status (from hello snapshot)
  uptimeMs: number | null;
  serverVersion: string | null;
  tickIntervalMs: number | null;
  authMode: string | null;
  configPath: string | null;
  // Status API
  status: StatusResult | null;
  // Health API
  health: HealthResult | null;
  // Agents
  agents: AgentsListResult | null;
  // Sessions
  sessions: SessionsListResult | null;
  // Logs
  logs: LogEntry[];
  // Cron
  cronStatus: CronStatusResult | null;
  cronJobs: CronJob[];
  cronRuns: CronRunLogEntry[];
  // State
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export type LogEntry = {
  raw: string;
  time?: string | null;
  level?: string | null;
  subsystem?: string | null;
  message?: string | null;
};

function parseLogLine(line: string): LogEntry {
  try {
    const obj = JSON.parse(line);
    return {
      raw: line,
      time: obj.time || obj.ts || obj.timestamp || null,
      level: obj.level || obj.lvl || null,
      subsystem: obj.subsystem || obj.module || null,
      message: obj.msg || obj.message || null,
    };
  } catch {
    return { raw: line, message: line };
  }
}

export function useAdminData(
  clientRef: MutableRefObject<GatewayClient | null>,
  hello: HelloOk | null,
  connected: boolean,
): AdminData {
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [agents, setAgents] = useState<AgentsListResult | null>(null);
  const [sessions, setSessions] = useState<SessionsListResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [cronStatus, setCronStatus] = useState<CronStatusResult | null>(null);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronRuns, setCronRuns] = useState<CronRunLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Extract from hello snapshot
  const snapshot = hello?.snapshot as Record<string, unknown> | undefined;
  const uptimeMs = (snapshot?.uptimeMs as number) ?? null;
  const serverVersion = hello?.server?.version ?? null;
  const tickIntervalMs = hello?.policy?.tickIntervalMs ?? null;
  const authMode = (snapshot?.authMode as string) ?? null;
  const configPath = (snapshot?.configPath as string) ?? null;

  const fetchAll = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !connected) return;

    setLoading(true);
    setError(null);

    const results = await Promise.allSettled([
      client.getStatus(),        // 0
      client.getHealth(),        // 1
      client.getAgentsList(),    // 2
      client.getSessionsList(),  // 3
      client.getLogsTail(),      // 4
      client.getCronStatus(),    // 5
      client.getCronList(),      // 6
      client.getCronRuns(),      // 7
    ]);

    if (results[0].status === 'fulfilled') setStatus(results[0].value);
    if (results[1].status === 'fulfilled') setHealth(results[1].value);
    if (results[2].status === 'fulfilled') setAgents(results[2].value);
    if (results[3].status === 'fulfilled') setSessions(results[3].value);
    if (results[4].status === 'fulfilled') {
      const r = results[4].value;
      setLogs((r.lines ?? []).map(parseLogLine));
    }
    if (results[5].status === 'fulfilled') setCronStatus(results[5].value);
    if (results[6].status === 'fulfilled') setCronJobs(results[6].value.jobs ?? []);
    if (results[7].status === 'fulfilled') setCronRuns(results[7].value.jobs ?? []);

    const errors = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
    if (errors.length > 0 && errors.length === results.length) {
      setError(String(errors[0]));
    }

    setLoading(false);
  }, [clientRef, connected]);

  // Initial fetch + polling
  useEffect(() => {
    if (!connected) return;

    fetchAll();
    intervalRef.current = setInterval(fetchAll, 15000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [connected, fetchAll]);

  return {
    uptimeMs,
    serverVersion,
    tickIntervalMs,
    authMode,
    configPath,
    status,
    health,
    agents,
    sessions,
    logs,
    cronStatus,
    cronJobs,
    cronRuns,
    loading,
    error,
    refresh: fetchAll,
  };
}
