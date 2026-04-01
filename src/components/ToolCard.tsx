import { useState } from 'react';
import { ChevronDown, ChevronRight, Zap, Copy, Check } from 'lucide-react';
import type { ToolEntry } from '../lib/types';

type Props = {
  tool: ToolEntry;
  /** When true, start collapsed (used for persisted tools in message history) */
  defaultCollapsed?: boolean;
};

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="text-gray-300 hover:text-gray-500 transition-colors p-0.5" title="复制">
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function CodeBlock({ title, content }: { title: string; content: string }) {
  if (!content) return null;
  const display = content.length > 3000 ? content.slice(0, 3000) + '\n...（已截断）' : content;
  return (
    <div className="operate-card-block">
      <div className="operate-card-block-title">
        {title}
        <CopyBtn text={content} />
      </div>
      <pre className="operate-card-code">{display}</pre>
    </div>
  );
}

export function ToolCard({ tool, defaultCollapsed }: Props) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const isDone = tool.phase === 'result';

  const argsText = tool.args != null
    ? (typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args as object, null, 2))
    : '';

  return (
    <div className="operate-card">
      <div className="operate-card-header" onClick={() => setExpanded(!expanded)}>
        {/* Status indicator */}
        {isDone ? (
          <div className="status-dot-done" />
        ) : (
          <div className="status-dot-active" />
        )}

        {/* Tool name */}
        <span className="text-[13px] font-semibold text-gray-700">{tool.name}</span>

        {/* Skill badge */}
        {tool.skillHint && (
          <span className="skill-badge">
            <Zap className="w-2.5 h-2.5" />
            {tool.skillHint}
          </span>
        )}

        {/* Status label */}
        <span className={`text-[11px] ml-auto mr-1 ${isDone ? 'text-emerald-500' : 'text-blue-500'}`}>
          {isDone ? '已完成' : '执行中'}
        </span>

        {/* Expand arrow */}
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
        }
      </div>

      <div className={`operate-card-body ${expanded ? 'open' : ''}`}>
        {argsText && <CodeBlock title="Input" content={argsText} />}
        {tool.output && <CodeBlock title="Output" content={tool.output} />}
        {!argsText && !tool.output && (
          <div className="text-xs text-gray-400 py-2">等待执行...</div>
        )}
      </div>
    </div>
  );
}
