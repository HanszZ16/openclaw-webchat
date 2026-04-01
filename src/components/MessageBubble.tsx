import { useMemo, useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check, Star, User, RefreshCw, AlertCircle, RotateCw, Brain, ChevronDown, ChevronRight } from 'lucide-react';
import type { ChatMessage, ContentBlock } from '../lib/types';
import { ToolCard } from './ToolCard';

type Props = {
  message: ChatMessage;
  assistantName?: string;
  /** Called when user clicks "regenerate" on an assistant message */
  onRetry?: () => void;
  /** Called when user clicks "resend" on a failed user message */
  onResend?: () => void;
};

function extractText(content: ContentBlock[] | string): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function extractImages(content: ContentBlock[] | string): string[] {
  if (typeof content === 'string') return [];
  return content
    .filter((b): b is ContentBlock & { type: 'image' } => b.type === 'image')
    .map((b) => {
      if ('source' in b && b.source) {
        const src = b.source as { type: string; media_type: string; data: string };
        if (src.data.startsWith('data:')) return src.data;
        return `data:${src.media_type};base64,${src.data}`;
      }
      return '';
    })
    .filter(Boolean);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback for non-HTTPS contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100"
      title="复制"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-500" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-gray-400" />
      )}
    </button>
  );
}

/** Copy button that appears on code blocks inside markdown */
function CodeBlockCopy({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="code-copy-btn"
      title="复制代码"
    >
      {copied ? (
        <><Check className="w-3 h-3" /> 已复制</>
      ) : (
        <><Copy className="w-3 h-3" /> 复制</>
      )}
    </button>
  );
}

/** Extract text content from code block children */
function extractCodeText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractCodeText).join('');
  if (children && typeof children === 'object' && 'props' in (children as ReactElement)) {
    return extractCodeText((children as ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return String(children ?? '');
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Custom markdown components with code block copy */
const markdownComponents = {
  pre({ children, ...props }: React.ComponentPropsWithoutRef<'pre'> & { children?: React.ReactNode }) {
    const code = extractCodeText(children);
    return (
      <div className="code-block-wrapper">
        <CodeBlockCopy code={code.replace(/\n$/, '')} />
        <pre {...props}>{children}</pre>
      </div>
    );
  },
};

function ThinkingBlock({ text, loading }: { text: string; loading?: boolean }) {
  const [expanded, setExpanded] = useState(loading ?? false);
  const preview = text.length > 100 ? text.slice(0, 100) + '...' : text;

  return (
    <div className="thinking-card mb-2">
      <div className="thinking-card-header" onClick={() => setExpanded(!expanded)}>
        {loading ? (
          <div className="w-4 h-4 border-2 border-purple-200 border-t-purple-500 rounded-full animate-spin shrink-0" />
        ) : (
          <Brain className="w-4 h-4 text-purple-500 shrink-0" />
        )}
        <span className="thinking-card-title">{loading ? '思考中...' : '思考过程'}</span>
        <span className="ml-auto">
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-purple-400" />
            : <ChevronRight className="w-3.5 h-3.5 text-purple-400" />
          }
        </span>
      </div>
      {expanded ? (
        <div className={`thinking-card-body open`}>
          <div className="thinking-card-content">{text}</div>
        </div>
      ) : (
        <div className="thinking-card-preview" onClick={() => setExpanded(true)}>
          {preview}
        </div>
      )}
    </div>
  );
}

export function MessageBubble({ message, assistantName, onRetry, onResend }: Props) {
  const isUser = message.role === 'user';
  const text = useMemo(() => extractText(message.content), [message.content]);
  const images = useMemo(() => extractImages(message.content), [message.content]);

  if (isUser) {
    return (
      <div className="flex justify-end gap-3 group">
        <div className="max-w-[70%] min-w-0 flex flex-col items-end gap-1">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-end">
              {images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt="附件"
                  className="max-w-[300px] max-h-[300px] rounded-lg object-cover cursor-pointer hover:opacity-90"
                  onClick={() => window.open(src, '_blank')}
                />
              ))}
            </div>
          )}
          {text && (
            <div className={`rounded-2xl rounded-br-sm px-4 py-2.5 shadow-sm ${
              message.sendFailed
                ? 'bg-red-50 border border-red-200 text-red-700'
                : 'bg-gradient-to-br from-emerald-600 to-emerald-700 text-white shadow-emerald-200/50'
            }`}>
              <p className="whitespace-pre-wrap break-words text-[15px]">{text}</p>
            </div>
          )}
          <div className="flex items-center gap-2 text-[11px] text-gray-400 px-1">
            {message.sendFailed && (
              <>
                <span className="flex items-center gap-1 text-red-500">
                  <AlertCircle className="w-3 h-3" /> 发送失败
                </span>
                {onResend && (
                  <button
                    onClick={onResend}
                    className="flex items-center gap-0.5 text-blue-500 hover:text-blue-600 transition-colors"
                  >
                    <RotateCw className="w-3 h-3" /> 重发
                  </button>
                )}
              </>
            )}
            <span>我</span>
            {message.timestamp && <span>{formatTime(message.timestamp)}</span>}
          </div>
        </div>
        <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-sm shadow-emerald-200/50">
          <User className="w-4 h-4 text-white" />
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex gap-3 group ml-2">
      {/* Content */}
      <div className="min-w-0 max-w-[85%]">
        {/* Thinking block */}
        {message.thinking && <ThinkingBlock text={message.thinking} />}

        {/* Tool calls */}
        {message.tools && message.tools.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {message.tools.map((tool) => (
              <ToolCard key={tool.toolCallId} tool={tool} defaultCollapsed />
            ))}
          </div>
        )}

        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt="附件"
                className="max-w-[300px] max-h-[300px] rounded-lg object-cover cursor-pointer hover:opacity-90"
                onClick={() => window.open(src, '_blank')}
              />
            ))}
          </div>
        )}

        {text && (
          <div className="markdown-body text-[15px] text-gray-800 bg-white rounded-2xl rounded-bl-sm px-5 py-3.5 border border-gray-100/80 shadow-sm inline-block">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
              {text}
            </ReactMarkdown>
          </div>
        )}

        {/* Footer: metadata + action buttons */}
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">
          <span className="text-gray-500 font-medium">{assistantName || '助手'}</span>
          {message.timestamp && <span>{formatTime(message.timestamp)}</span>}
          {message.usage && (
            <>
              <span>↑{message.usage.input_tokens ?? 0}</span>
              <span>↓{message.usage.output_tokens ?? 0}</span>
            </>
          )}
          {message.model && (
            <span className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-[10px] text-gray-500 font-medium">
              {message.model}
            </span>
          )}
          {/* Action buttons - show on hover */}
          {text && <CopyButton text={text} />}
          {onRetry && (
            <button
              onClick={onRetry}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100 text-gray-300 hover:text-emerald-600"
              title="重新生成"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100 text-gray-300 hover:text-yellow-500" title="收藏">
            <Star className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
