import { useState } from 'react';
import { Wrench, ChevronDown, ChevronRight, Loader2, CheckCircle2 } from 'lucide-react';
import type { ToolEntry } from '../lib/types';

type Props = {
  tool: ToolEntry;
};

export function ToolCard({ tool }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isDone = tool.phase === 'result';

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors"
      >
        {isDone ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
        )}
        <Wrench className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="text-gray-700 font-medium truncate">{tool.name}</span>
        <span className="ml-auto">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-3 py-2 text-xs space-y-2">
          {tool.args != null && (
            <div>
              <span className="text-gray-500 font-medium">参数：</span>
              <pre className="mt-1 p-2 bg-gray-50 rounded text-gray-600 overflow-x-auto max-h-[200px] overflow-y-auto border border-gray-100">
                {typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args as object, null, 2)}
              </pre>
            </div>
          )}
          {tool.output && (
            <div>
              <span className="text-gray-500 font-medium">输出：</span>
              <pre className="mt-1 p-2 bg-gray-50 rounded text-gray-600 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap border border-gray-100">
                {tool.output.length > 2000 ? tool.output.slice(0, 2000) + '\n...（已截断）' : tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
