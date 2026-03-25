import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check, Star, User } from 'lucide-react';
import { useState } from 'react';
import type { ChatMessage, ContentBlock } from '../lib/types';

type Props = {
  message: ChatMessage;
  assistantName?: string;
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

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function MessageBubble({ message, assistantName }: Props) {
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
            <div className="bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 shadow-sm">
              <p className="whitespace-pre-wrap break-words text-[15px]">{text}</p>
            </div>
          )}
          {message.timestamp && (
            <div className="flex items-center gap-2 text-[11px] text-gray-400 px-1">
              <span>我</span>
              <span>{formatTime(message.timestamp)}</span>
            </div>
          )}
        </div>
        <div className="shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shadow-sm">
          <User className="w-4 h-4 text-white" />
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex gap-3 group ml-2">
      {/* Content - inline-block so width fits content */}
      <div className="min-w-0 max-w-[85%]">
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
          <div className="markdown-body text-[15px] text-gray-800 bg-gray-50 rounded-2xl rounded-bl-sm px-4 py-3 border border-gray-100 inline-block">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
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
          <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100 text-gray-300 hover:text-yellow-500" title="收藏">
            <Star className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
