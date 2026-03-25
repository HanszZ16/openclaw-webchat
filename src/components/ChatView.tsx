import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Plus,
  LogOut,
  Wifi,
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
  /** iframe embed mode: hide disconnect/new session, show username */
  embedMode?: boolean;
  /** Current user name (from URL param) */
  userName?: string | null;
};

export function ChatView({
  connected,
  messages,
  stream,
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
  }, [messages, stream, streamTools, autoScroll]);

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header - 国家电网绿色风格 */}
      <header className="shrink-0 border-b border-emerald-100">
        {/* Top bar with brand */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-bold text-white tracking-wide">iClaw</span>
            </div>
            <div className="h-4 w-px bg-white/30" />
            <span className="text-xs text-emerald-100">智能对话助手</span>
          </div>

          <div className="flex items-center gap-2">
            {/* User name in embed mode */}
            {userName && (
              <span className="text-[11px] text-emerald-100 bg-white/10 px-2 py-0.5 rounded">
                {userName}
              </span>
            )}

            {/* Connection status */}
            <div className="flex items-center gap-1.5 px-2 py-1 bg-white/10 rounded-md">
              {connected ? (
                <Wifi className="w-3 h-3 text-emerald-200" />
              ) : (
                <WifiOff className="w-3 h-3 text-red-300" />
              )}
              <span className={`text-[11px] ${connected ? 'text-emerald-100' : 'text-red-300'}`}>
                {connected ? '已连接' : '未连接'}
              </span>
            </div>

            {serverVersion && (
              <span className="text-[11px] text-emerald-200 bg-white/10 px-1.5 py-0.5 rounded">
                v{serverVersion}
              </span>
            )}

            {!embedMode && (
              <button
                onClick={onDisconnect}
                className="p-1.5 text-emerald-200 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                title="断开连接"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Toolbar row */}
        <div className="flex items-center justify-between px-4 py-2 bg-emerald-50/50">
          <div className="flex items-center gap-2">
            {!embedMode && (
              <span className="text-xs text-emerald-600/60 font-mono truncate max-w-[240px]">{_sessionKey}</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onClearHistory}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
              title="清除所有记录"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清除
            </button>
            {!embedMode && (
              <button
                onClick={onNewSession}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5 bg-white">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="flex items-center gap-2 text-gray-400">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
              加载历史记录...
            </div>
          </div>
        )}

        {!loading && messages.length === 0 && !stream && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <MessageSquare className="w-12 h-12 mb-4 text-gray-300" />
            <p className="text-lg font-medium text-gray-500">开始对话</p>
            <p className="text-sm mt-1">发送一条消息开始聊天</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} assistantName={assistantName} />
        ))}

        {/* Streaming tools */}
        {streamTools.length > 0 && (
          <div className="flex gap-3 ml-6">
            <div className="space-y-1.5 flex-1 min-w-0">
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
              <div className="markdown-body text-[15px] text-gray-800 bg-gray-50 rounded-2xl rounded-bl-sm px-4 py-3 border border-gray-100 typing-cursor">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {stream}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {/* Sending indicator */}
        {sending && !stream && streamTools.length === 0 && (
          <div className="flex gap-3 ml-6">
            <div className="flex gap-1.5 py-3 px-4 bg-gray-50 rounded-2xl border border-gray-100">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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
            className="flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-gray-600 text-sm hover:bg-gray-50 transition-colors shadow-md"
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
