import { useState, useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { LoginPage } from './components/LoginPage';
import { ChatView } from './components/ChatView';
import { Sidebar, type TabId } from './components/Sidebar';
import { AdminPanel } from './components/AdminPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { SkillMarketPanel } from './components/SkillMarketPanel';
import { useGateway } from './lib/useGateway';
import { useAdminData } from './lib/useAdminData';
import { getEmbedParams } from './lib/embedParams';
import type { ConnectionConfig } from './lib/types';

const embedParams = getEmbedParams();

const isEmbedMode = embedParams.embedUi;
const MOBILE_SIDEBAR_BREAKPOINT = 768;
const MOBILE_SIDEBAR_DRAG_THRESHOLD = 24;

function isMobileWidth() {
  return typeof window !== 'undefined' && window.innerWidth <= MOBILE_SIDEBAR_BREAKPOINT;
}

function App() {
  const [config, setConfig] = useState<ConnectionConfig | null>(() => {
    // iframe mode: use URL params directly
    if (embedParams.wsUrl) {
      return { wsUrl: embedParams.wsUrl, password: embedParams.password || '', token: embedParams.token || undefined };
    }
    // Normal mode: check sessionStorage
    const url = sessionStorage.getItem('oc-ws-url');
    const pwd = sessionStorage.getItem('oc-password');
    const token = sessionStorage.getItem('oc-token');
    if (url) {
      return { wsUrl: url, password: pwd || '', token: token || undefined };
    }
    return null;
  });

  const [loginError, setLoginError] = useState<string | null>(null);

  const gatewayOptions = useMemo(() => ({
    fixedSessionKey: embedParams.user || null,
  }), []);

  const gateway = useGateway(config, gatewayOptions);

  useEffect(() => {
    if (config && !gateway.connected && gateway.error) {
      setLoginError(gateway.error);
    }
    if (gateway.connected) {
      setLoginError(null);
    }
  }, [config, gateway.connected, gateway.error]);

  const handleConnect = useCallback((cfg: ConnectionConfig) => {
    setLoginError(null);
    setConfig(cfg);
  }, []);

  const handleDisconnect = useCallback(() => {
    sessionStorage.removeItem('oc-ws-url');
    sessionStorage.removeItem('oc-password');
    sessionStorage.removeItem('oc-token');
    setConfig(null);
    setLoginError(null);
  }, []);

  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [isMobileViewport, setIsMobileViewport] = useState(isMobileWidth);
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobileWidth());
  const dragStartXRef = useRef<number | null>(null);
  const draggedRef = useRef(false);
  const adminData = useAdminData(gateway.client, gateway.hello, gateway.connected);

  const [showLogin, setShowLogin] = useState(!config);

  useEffect(() => {
    if (!config) {
      setShowLogin(true);
      return;
    }
    if (gateway.connected) {
      setShowLogin(false);
      return;
    }
    if (gateway.hello) {
      setShowLogin(false);
      return;
    }
    const timer = setTimeout(() => {
      if (!gateway.connected && !gateway.hello) {
        setShowLogin(true);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [config, gateway.connected, gateway.hello]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileViewport(isMobileWidth());
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setSidebarOpen(!isMobileViewport);
  }, [isMobileViewport]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    if (isMobileViewport) {
      setSidebarOpen(false);
    }
  }, [isMobileViewport]);

  const handleHandlerPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    dragStartXRef.current = event.clientX;
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleHandlerPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStartXRef.current === null) return;
    const deltaX = event.clientX - dragStartXRef.current;
    if (Math.abs(deltaX) > 3) {
      draggedRef.current = true;
    }
    if (!sidebarOpen && deltaX > MOBILE_SIDEBAR_DRAG_THRESHOLD) {
      setSidebarOpen(true);
      dragStartXRef.current = event.clientX;
    } else if (sidebarOpen && deltaX < -MOBILE_SIDEBAR_DRAG_THRESHOLD) {
      setSidebarOpen(false);
      dragStartXRef.current = event.clientX;
    }
  }, [sidebarOpen]);

  const handleHandlerPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!draggedRef.current) {
      setSidebarOpen((open) => !open);
    }
    dragStartXRef.current = null;
    draggedRef.current = false;
  }, []);

  const handleHandlerPointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStartXRef.current = null;
    draggedRef.current = false;
  }, []);

  // In embed mode with URL params, skip login page (auto-connect)
  if (showLogin && !gateway.connected && !embedParams.wsUrl) {
    return <LoginPage onConnect={handleConnect} error={loginError} />;
  }

  const chatView = (
    <ChatView
      connected={gateway.connected}
      messages={gateway.messages}
      stream={gateway.stream}
      streamThinking={gateway.streamThinking}
      streamTools={gateway.streamTools}
      loading={gateway.loading}
      sending={gateway.sending}
      error={gateway.error}
      sessionKey={gateway.sessionKey}
      serverVersion={gateway.hello?.server?.version}
      assistantName={(gateway.hello?.snapshot as Record<string, unknown> | undefined)?.assistantName as string | undefined}
      onSend={gateway.sendMessage}
      onAbort={gateway.abort}
      onNewSession={gateway.newSession}
      onDisconnect={handleDisconnect}
      onClearError={() => gateway.setError(null)}
      onClearHistory={gateway.clearHistory}
      onRetry={gateway.retryLastMessage}
      onResend={gateway.resendMessage}
      embedMode={embedParams.embedUi}
      userName={embedParams.user}
    />
  );

  // Embed mode: no sidebar, just chat
  if (isEmbedMode) {
    return chatView;
  }

  // Standalone mode: sidebar + content
  return (
    <div className={`app-layout ${isMobileViewport ? 'app-layout-mobile' : ''}`}>
      <div className={`sidebar-shell ${sidebarOpen ? 'sidebar-shell-open' : 'sidebar-shell-closed'}`}>
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          clientRef={gateway.client}
          connected={gateway.connected}
          currentSessionKey={gateway.sessionKey}
          onSwitchSession={gateway.switchSession}
          onNewSession={gateway.newSession}
        />
      </div>
      {isMobileViewport && sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      {isMobileViewport && (
        <button
          type="button"
          className={`sidebar-handler ${sidebarOpen ? 'sidebar-handler-open' : ''}`}
          onPointerDown={handleHandlerPointerDown}
          onPointerMove={handleHandlerPointerMove}
          onPointerUp={handleHandlerPointerUp}
          onPointerCancel={handleHandlerPointerCancel}
          aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
        >
          <span className="sidebar-handler-grip" />
        </button>
      )}
      <main className="app-content">
        {activeTab === 'chat' && chatView}
        {activeTab === 'admin' && <AdminPanel data={adminData} connected={gateway.connected} />}
        {activeTab === 'skills' && (
          <SkillsPanel
            clientRef={gateway.client}
            connected={gateway.connected}
          />
        )}
        {activeTab === 'market' && <SkillMarketPanel />}
      </main>
    </div>
  );
}

export default App;
