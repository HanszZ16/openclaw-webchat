import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Plus,
  LogOut,
  WifiOff,
  ArrowDown,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MessageBubble } from './MessageBubble';
import { ToolCard } from './ToolCard';
import { ChatInput } from './ChatInput';
import type { ChatMessage, Attachment, ToolEntry } from '../lib/types';

type Props = {
  connected: boolean;
  messages: ChatMessage[];
  stream: string | null;
  streamThinking: string | null;
  streamTools: ToolEntry[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  sessionKey: string;
  serverVersion?: string;
  assistantName?: string;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onAbort: () => void;
  onNewSession: () => void;
  onDisconnect: () => void;
  onClearError: () => void;
  onClearHistory: () => void;
  onRetry: () => void;
  onResend: (msgIndex: number) => void;
  /** iframe embed mode: hide disconnect/new session, show username */
  embedMode?: boolean;
  /** Current user name (from URL param) */
  userName?: string | null;
};

export function ChatView({
  connected,
  messages,
  stream,
  streamThinking,
  streamTools,
  loading,
  sending,
  error,
  sessionKey: _sessionKey,
  serverVersion,
  assistantName,
  onSend,
  onAbort,
  onNewSession,
  onDisconnect,
  onClearError,
  onClearHistory,
  onRetry,
  onResend,
  embedMode,
  userName,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAutoScroll(true);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atBottom = scrollHeight - scrollTop - clientHeight < 80;
      setShowScrollBtn(!atBottom);
      setAutoScroll(atBottom);
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, stream, streamThinking, streamTools, autoScroll]);

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <header className="shrink-0">
        {/* Top bar with brand */}
        <div className="flex items-center justify-between px-5 py-2.5" style={{ background: 'linear-gradient(135deg, #047857, #059669 40%, #0d9488)' }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="iClaw" className="w-8 h-8 rounded-xl object-cover" />
              <span className="text-lg font-bold text-white tracking-wide">iClaw</span>
            </div>
            <div className="h-4 w-px bg-white/20" />
            <span className="text-xs text-white/60 font-medium">智能对话助手</span>
          </div>

          <div className="flex items-center gap-2">
            {userName && (
              <span className="text-[11px] text-white/70 bg-white/10 px-2.5 py-1 rounded-lg backdrop-blur-sm">
                {userName}
              </span>
            )}

            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/10 rounded-lg backdrop-blur-sm">
              {connected ? (
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-300 shadow-[0_0_4px_rgba(52,211,153,0.6)]" />
              ) : (
                <WifiOff className="w-3 h-3 text-red-300" />
              )}
              <span className={`text-[11px] font-medium ${connected ? 'text-white/70' : 'text-red-300'}`}>
                {connected ? '已连接' : '未连接'}
              </span>
            </div>

            {serverVersion && (
              <span className="text-[11px] text-white/50 bg-white/8 px-2 py-0.5 rounded-md font-mono">
                v{serverVersion}
              </span>
            )}

            {!embedMode && (
              <button
                onClick={onDisconnect}
                className="p-1.5 text-white/50 hover:text-white rounded-lg hover:bg-white/10 transition-all"
                title="断开连接"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Toolbar row */}
        <div className="flex items-center justify-between px-5 py-2 bg-gradient-to-r from-emerald-50/80 to-teal-50/40 border-b border-emerald-100/60">
          <div className="flex items-center gap-2">
            {!embedMode && (
              <span className="text-[11px] text-emerald-600/50 font-mono truncate max-w-[240px]">{_sessionKey}</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onClearHistory}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200/80 rounded-lg hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all shadow-sm"
              title="清除所有记录"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清除
            </button>
            {!embedMode && (
              <button
                onClick={onNewSession}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-all shadow-sm shadow-emerald-200"
                title="新建会话"
              >
                <Plus className="w-3.5 h-3.5" />
                新建会话
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5 bg-gradient-to-b from-white to-gray-50/30">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="flex items-center gap-2.5 text-gray-400 text-sm">
              <div className="w-4 h-4 border-2 border-emerald-200 border-t-emerald-500 rounded-full animate-spin" />
              加载历史记录...
            </div>
          </div>
        )}

        {!loading && messages.length === 0 && !stream && (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center mb-5 shadow-sm">
              <MessageSquare className="w-9 h-9 text-emerald-400" />
            </div>
            <p className="text-lg font-semibold text-gray-600">开始对话</p>
            <p className="text-sm mt-1.5 text-gray-400">发送一条消息开始与 {assistantName || '助手'} 聊天</p>
          </div>
        )}

        {messages.map((msg, i) => {
          // Show retry button on the last assistant message when not currently sending
          const isLastAssistant = !sending && msg.role === 'assistant' && i === messages.length - 1;
          const msgKey = msg.timestamp ? `${msg.role}-${msg.timestamp}-${i}` : `${msg.role}-${i}`;
          return (
            <MessageBubble
              key={msgKey}
              message={msg}
              assistantName={assistantName}
              onRetry={isLastAssistant ? onRetry : undefined}
              onResend={msg.sendFailed ? () => onResend(i) : undefined}
            />
          );
        })}

        {/* Streaming thinking */}
        {streamThinking && (
          <div className="flex gap-3 ml-6">
            <div className="min-w-0 flex-1 max-w-[85%]">
              <div className="thinking-card">
                <div className="thinking-card-header">
                  <div className="w-4 h-4 border-2 border-purple-200 border-t-purple-500 rounded-full animate-spin shrink-0" />
                  <span className="thinking-card-title">思考中...</span>
                </div>
                <div className="thinking-card-body open">
                  <div className="thinking-card-content">{streamThinking}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Streaming tools */}
        {streamTools.length > 0 && (
          <div className="flex gap-3 ml-6">
            <div className="space-y-1.5 flex-1 min-w-0 max-w-[85%]">
              {streamTools.map((tool) => (
                <ToolCard key={tool.toolCallId} tool={tool} />
              ))}
            </div>
          </div>
        )}

        {/* Streaming text */}
        {stream && (
          <div className="flex gap-3 ml-6">
            <div className="min-w-0 flex-1 max-w-[85%]">
              <div className="markdown-body text-[15px] text-gray-800 bg-white rounded-2xl rounded-bl-sm px-5 py-3.5 border border-gray-100/80 shadow-sm typing-cursor">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {stream}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {/* Sending indicator */}
        {sending && !stream && !streamThinking && streamTools.length === 0 && (
          <div className="flex gap-3 ml-6">
            <div className="flex gap-1.5 py-3 px-5 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-100">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-auto max-w-lg p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={onClearError} className="text-red-400 hover:text-red-600 text-xs">
              关闭
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom */}
      {showScrollBtn && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
          <button
            onClick={scrollToBottom}
            className="flex items-center gap-1.5 px-4 py-2 bg-white/90 backdrop-blur-sm border border-gray-200/60 rounded-full text-emerald-600 text-sm font-medium hover:bg-white hover:shadow-lg transition-all shadow-md"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            新消息
          </button>
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={onSend}
        onAbort={onAbort}
        sending={sending}
        disabled={!connected}
        disabledReason={!connected ? '未连接到 Gateway' : null}
        assistantName={assistantName}
      />
    </div>
  );
}
