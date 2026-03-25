import { MessageSquare, LayoutDashboard, Zap } from 'lucide-react';

export type TabId = 'chat' | 'admin' | 'skills';

type Props = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
};

const tabs: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: '对话', icon: MessageSquare },
  { id: 'admin', label: '管理面板', icon: LayoutDashboard },
  { id: 'skills', label: '技能', icon: Zap },
];

export function Sidebar({ activeTab, onTabChange }: Props) {
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
              onClick={() => onTabChange(tab.id)}
              className={`sidebar-tab ${isActive ? 'sidebar-tab-active' : ''}`}
              title={tab.label}
            >
              <Icon className="w-5 h-5" />
              <span className="sidebar-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
