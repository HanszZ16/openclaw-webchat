import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Zap, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import type { MutableRefObject } from 'react';
import type { GatewayClient, SkillEntry } from '../lib/gateway';

type Props = {
  clientRef: MutableRefObject<GatewayClient | null>;
  connected: boolean;
};

const SOURCE_LABELS: Record<string, string> = {
  'openclaw-managed': '用户安装',
  'openclaw-workspace': '工作区',
  'agents-skills-project': '项目技能',
  'agents-skills-personal': '个人技能',
  'openclaw-extra': '额外目录',
};

function isUserInstalled(skill: SkillEntry): boolean {
  if (skill.bundled) return false;
  if (skill.source === 'openclaw-bundled') return false;
  return true;
}

function sourceLabel(source?: string): string {
  if (!source) return '未知';
  return SOURCE_LABELS[source] || source;
}

export function SkillsPanel({ clientRef, connected }: Props) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [managedDir, setManagedDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSkills = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !connected) return;

    setLoading(true);
    setError(null);

    try {
      // Don't pass agentId — let gateway use the default agent
      const result = await client.getSkillsStatus();
      const allSkills = result.skills ?? [];
      setSkills(allSkills.filter(isUserInstalled));
      setWorkspaceDir(result.workspaceDir ?? null);
      setManagedDir(result.managedSkillsDir ?? null);
    } catch (err) {
      setError('Agent 离线，无法获取技能列表');
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [clientRef, connected]);

  useEffect(() => {
    if (!connected) return;
    fetchSkills();
    intervalRef.current = setInterval(fetchSkills, 30000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [connected, fetchSkills]);

  const enabledSkills = skills.filter((s) => s.enabled !== false && !s.disabled);
  const disabledSkills = skills.filter((s) => s.enabled === false || s.disabled);

  return (
    <div className="admin-panel">
      {/* Header */}
      <div className="admin-header">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-white/80" />
          <h2 className="text-lg font-bold">已安装技能</h2>
        </div>
        <div className="flex items-center gap-2">
          {loading && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          <button onClick={fetchSkills} className="p-1.5 rounded-lg transition-colors" title="刷新">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="admin-content">
        {/* Paths info */}
        {(workspaceDir || managedDir) && (
          <div className="text-xs text-gray-400 px-1 space-y-0.5">
            {managedDir && <div>托管目录: <span className="font-mono text-gray-500">{managedDir}</span></div>}
            {workspaceDir && <div>工作区: <span className="font-mono text-gray-500">{workspaceDir}</span></div>}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!connected && !error && (
          <div className="text-sm text-gray-400 py-8 text-center">未连接到 Gateway</div>
        )}

        {/* Skills list */}
        {connected && !error && skills.length === 0 && !loading && (
          <div className="text-sm text-gray-400 py-8 text-center">暂无用户安装的技能</div>
        )}

        {enabledSkills.length > 0 && (
          <div className="admin-section">
            <h3 className="admin-section-title">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              已启用
              <span className="ml-auto text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {enabledSkills.length}
              </span>
            </h3>
            <div className="admin-section-body space-y-0.5">
              {enabledSkills.map((skill) => (
                <SkillRow key={skill.key || skill.name} skill={skill} />
              ))}
            </div>
          </div>
        )}

        {disabledSkills.length > 0 && (
          <div className="admin-section">
            <h3 className="admin-section-title">
              <XCircle className="w-4 h-4 text-gray-400" />
              已停用
              <span className="ml-auto text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {disabledSkills.length}
              </span>
            </h3>
            <div className="admin-section-body space-y-0.5">
              {disabledSkills.map((skill) => (
                <SkillRow key={skill.key || skill.name} skill={skill} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillRow({ skill }: { skill: SkillEntry }) {
  const enabled = skill.enabled !== false && !skill.disabled;
  const emoji = skill.emoji;

  return (
    <div className="admin-list-row !py-2.5">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {emoji ? (
          <span className="text-base shrink-0 w-6 text-center">{emoji}</span>
        ) : enabled ? (
          <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-gray-300 shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800">{skill.name || skill.key}</div>
          {skill.description && (
            <div className="text-xs text-gray-400 truncate max-w-[500px]">{skill.description}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded border bg-gray-50 text-gray-500 border-gray-200">
          {sourceLabel(skill.source)}
        </span>
        {skill.requiresAuth && (
          <span className={`inline-flex items-center text-[11px] px-1.5 py-0.5 rounded border ${
            skill.hasApiKey
              ? 'bg-blue-50 text-blue-600 border-blue-200'
              : 'bg-yellow-50 text-yellow-600 border-yellow-200'
          }`}>
            {skill.hasApiKey ? '已授权' : '需授权'}
          </span>
        )}
        {skill.homepage && (
          <a
            href={skill.homepage as string}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-emerald-600 hover:underline"
          >
            文档
          </a>
        )}
      </div>
    </div>
  );
}
