import { useState } from 'react';
import { Server, Lock, LogIn, AlertCircle, Key } from 'lucide-react';
import type { ConnectionConfig } from '../lib/types';

type Props = {
  onConnect: (config: ConnectionConfig) => void;
  error?: string | null;
};

type AuthMode = 'password' | 'token';

export function LoginPage({ onConnect, error }: Props) {
  const [wsUrl, setWsUrl] = useState(() => {
    return sessionStorage.getItem('oc-ws-url') || 'ws://127.0.0.1:18789';
  });
  const [authMode, setAuthMode] = useState<AuthMode>(() => {
    return (sessionStorage.getItem('oc-auth-mode') as AuthMode) || 'password';
  });
  const [password, setPassword] = useState(() => {
    return sessionStorage.getItem('oc-password') || '';
  });
  const [token, setToken] = useState(() => {
    return sessionStorage.getItem('oc-token') || '';
  });
  const [connecting, setConnecting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wsUrl.trim()) return;
    sessionStorage.setItem('oc-ws-url', wsUrl);
    sessionStorage.setItem('oc-auth-mode', authMode);
    if (authMode === 'password') {
      sessionStorage.setItem('oc-password', password);
      sessionStorage.removeItem('oc-token');
    } else {
      sessionStorage.setItem('oc-token', token);
      sessionStorage.removeItem('oc-password');
    }
    setConnecting(true);
    onConnect({
      wsUrl: wsUrl.trim(),
      password: authMode === 'password' ? password : '',
      token: authMode === 'token' ? token : undefined,
    });
  };

  const inputClass = "w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-emerald-50/30 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-18 h-18 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 mb-5 shadow-lg shadow-emerald-200/50" style={{ width: 72, height: 72 }}>
            <Server className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">iClaw 智能对话</h1>
          <p className="text-gray-400 mt-2 text-sm">连接到 OpenClaw Gateway</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-gray-200/60 shadow-lg shadow-gray-100/50 p-7 space-y-5"
        >
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Gateway WebSocket 地址
            </label>
            <div className="relative">
              <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={wsUrl}
                onChange={(e) => setWsUrl(e.target.value)}
                placeholder="ws://127.0.0.1:18789"
                className={inputClass}
              />
            </div>
          </div>

          {/* Auth mode toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              认证方式
            </label>
            <div className="flex rounded-xl border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setAuthMode('password')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
                  authMode === 'password'
                    ? 'bg-emerald-50 text-emerald-700 border-r border-gray-200'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border-r border-gray-200'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                密码
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('token')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
                  authMode === 'token'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                <Key className="w-3.5 h-3.5" />
                Token
              </button>
            </div>
          </div>

          {/* Auth input */}
          {authMode === 'password' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                密码
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入 Gateway 密码"
                  className={inputClass}
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Device Token
              </label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="请输入 Device Token"
                  className={inputClass}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                首次使用密码连接后，Gateway 会返回 Device Token 用于后续认证
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={connecting || !wsUrl.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-emerald-300 disabled:to-teal-300 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all shadow-sm shadow-emerald-200/50 hover:shadow-md hover:shadow-emerald-200/50"
          >
            {connecting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                连接中...
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                连接
              </>
            )}
          </button>
        </form>

        <p className="text-center text-gray-400 text-xs mt-4">
          请确保 OpenClaw Gateway 已启动且可访问
        </p>
      </div>
    </div>
  );
}
