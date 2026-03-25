import { useState } from 'react';
import { Server, Lock, LogIn, AlertCircle } from 'lucide-react';
import type { ConnectionConfig } from '../lib/types';

type Props = {
  onConnect: (config: ConnectionConfig) => void;
  error?: string | null;
};

export function LoginPage({ onConnect, error }: Props) {
  const [wsUrl, setWsUrl] = useState(() => {
    return localStorage.getItem('oc-ws-url') || 'ws://127.0.0.1:18789';
  });
  const [password, setPassword] = useState(() => {
    return localStorage.getItem('oc-password') || '';
  });
  const [connecting, setConnecting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wsUrl.trim()) return;
    localStorage.setItem('oc-ws-url', wsUrl);
    localStorage.setItem('oc-password', password);
    setConnecting(true);
    onConnect({ wsUrl: wsUrl.trim(), password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-50 mb-4">
            <Server className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">iClaw 智能对话</h1>
          <p className="text-gray-500 mt-2">连接到 OpenClaw Gateway</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5"
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
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>
          </div>

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
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={connecting || !wsUrl.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
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
