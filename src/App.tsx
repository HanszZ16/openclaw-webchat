import { useState, useCallback, useEffect, useMemo } from 'react';
import { LoginPage } from './components/LoginPage';
import { ChatView } from './components/ChatView';
import { Sidebar, type TabId } from './components/Sidebar';
import { AdminPanel } from './components/AdminPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { useGateway } from './lib/useGateway';
import { useAdminData } from './lib/useAdminData';
import { getEmbedParams } from './lib/embedParams';
import type { ConnectionConfig } from './lib/types';

const embedParams = getEmbedParams();

const isEmbedMode = embedParams.embedUi;

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

  // In embed mode with URL params, skip login page (auto-connect)
  if (showLogin && !gateway.connected && !embedParams.wsUrl) {
    return <LoginPage onConnect={handleConnect} error={loginError} />;
  }

  const chatView = (
    <ChatView
      connected={gateway.connected}
      messages={gateway.messages}
      stream={gateway.stream}
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
    <div className="app-layout">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        clientRef={gateway.client}
        connected={gateway.connected}
        currentSessionKey={gateway.sessionKey}
        onSwitchSession={gateway.switchSession}
        onNewSession={gateway.newSession}
      />
      <main className="app-content">
        {activeTab === 'chat' && chatView}
        {activeTab === 'admin' && <AdminPanel data={adminData} connected={gateway.connected} />}
        {activeTab === 'skills' && (
          <SkillsPanel
            clientRef={gateway.client}
            connected={gateway.connected}
          />
        )}
      </main>
    </div>
  );
}

export default App;
