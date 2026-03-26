import { useState, useCallback, useEffect, type MutableRefObject } from 'react';
import { MessageSquare, LayoutDashboard, Zap, Plus, ChevronLeft, Loader2 } from 'lucide-react';
import type { GatewayClient, SessionRow } from '../lib/gateway';

export type TabId = 'chat' | 'admin' | 'skills';

type Props = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  clientRef: MutableRefObject<GatewayClient | null>;
  connected: boolean;
  currentSessionKey?: string;
  onSwitchSession?: (key: string) => void;
  onNewSession?: () => void;
};

const tabs: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: '对话', icon: MessageSquare },
  { id: 'admin', label: '管理面板', icon: LayoutDashboard },
  { id: 'skills', label: '技能', icon: Zap },
];

function formatRelative(ts?: number | null): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

export function Sidebar({ activeTab, onTabChange, clientRef, connected, currentSessionKey, onSwitchSession, onNewSession }: Props) {
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch sessions on demand when flyout opens
  const fetchSessions = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !connected) return;
    setLoading(true);
    try {
      const res = await client.getSessionsList({ limit: 50, activeMinutes: 1440 });
      setSessions(res.sessions ?? []);
    } catch {
      // silently fail — panel will show empty
    } finally {
      setLoading(false);
    }
  }, [clientRef, connected]);

  // When flyout opens, immediately fetch
  useEffect(() => {
    if (sessionPanelOpen) {
      fetchSessions();
    }
  }, [sessionPanelOpen, fetchSessions]);

  const handleTabClick = (tabId: TabId) => {
    if (tabId === 'chat' && activeTab === 'chat') {
      setSessionPanelOpen(!sessionPanelOpen);
    } else {
      onTabChange(tabId);
      setSessionPanelOpen(false);
    }
  };

  const handleSwitchSession = (key: string) => {
    onSwitchSession?.(key);
    setSessionPanelOpen(false);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-logo">iC</span>
      </div>
      <nav className="sidebar-nav">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`sidebar-tab ${isActive ? 'sidebar-tab-active' : ''}`}
              title={tab.label}
            >
              <Icon className="w-5 h-5" />
              <span className="sidebar-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Session flyout panel */}
      {sessionPanelOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setSessionPanelOpen(false)}
          />
          <div className="session-flyout">
            <div className="session-flyout-header">
              <span className="text-xs font-semibold text-gray-700">会话记录</span>
              <div className="flex items-center gap-1">
                {onNewSession && (
                  <button
                    onClick={() => { onNewSession(); setSessionPanelOpen(false); }}
                    className="p-1 rounded hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition-colors"
                    title="新建会话"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setSessionPanelOpen(false)}
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="session-flyout-list">
              {loading && sessions.length === 0 && (
                <div className="flex items-center justify-center py-6 text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              )}
              {!loading && sessions.length === 0 && (
                <div className="text-center py-6 text-xs text-gray-400">暂无会话记录</div>
              )}
              {sessions.map((s) => {
                const name = s.displayName || s.derivedTitle || s.label || s.key;
                const isActive = s.key === currentSessionKey;
                return (
                  <button
                    key={s.key}
                    onClick={() => handleSwitchSession(s.key)}
                    className={`session-flyout-item ${isActive ? 'session-flyout-item-active' : ''}`}
                    title={name}
                  >
                    <div className="truncate text-[12px] font-medium">{name}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                      {s.model && <span className="truncate max-w-[100px]">{s.model}</span>}
                      {s.updatedAt && <span className="shrink-0">{formatRelative(s.updatedAt)}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
