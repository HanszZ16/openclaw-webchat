import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

const PRESET_MODELS = [
  { label: 'GLM-4-Plus', value: 'glm-4-plus' },
  { label: 'GLM-4-Flash', value: 'glm-4-flash' },
  { label: 'GLM-5-Turbo', value: 'glm-5-turbo' },
  { label: 'GPT-4o', value: 'gpt-4o' },
  { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
  { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
  { label: 'Claude 3 Haiku', value: 'claude-3-haiku-20240307' },
  { label: 'DeepSeek Chat', value: 'deepseek-chat' },
  { label: 'DeepSeek Reasoner', value: 'deepseek-reasoner' },
  { label: 'Qwen Max', value: 'qwen-max' },
  { label: 'Qwen Plus', value: 'qwen-plus' },
  { label: 'Qwen Turbo', value: 'qwen-turbo' },
];

type Props = {
  onSelect: (model: string) => void;
  onClose: () => void;
  currentModel?: string;
};

export function ModelSelector({ onSelect, onClose, currentModel }: Props) {
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const filtered = PRESET_MODELS.filter(
    (m) => m.label.toLowerCase().includes(search.toLowerCase()) || m.value.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div ref={ref} className="absolute left-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
      <div className="p-2 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search.trim()) onSelect(search.trim());
              if (e.key === 'Escape') onClose();
            }}
            placeholder="搜索或输入模型名称..."
            className="w-full pl-8 pr-8 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
            </button>
          )}
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto py-1">
        {filtered.map((model) => (
          <button
            key={model.value}
            onClick={() => onSelect(model.value)}
            className={`w-full text-left px-4 py-2 text-sm hover:bg-blue-50 transition-colors ${
              currentModel === model.value ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
            }`}
          >
            <div className="font-medium">{model.label}</div>
            <div className="text-xs text-gray-400">{model.value}</div>
          </button>
        ))}

        {search.trim() && !filtered.some((m) => m.value === search.trim()) && (
          <button
            onClick={() => onSelect(search.trim())}
            className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 transition-colors border-t border-gray-100"
          >
            使用自定义模型：<span className="font-mono">{search.trim()}</span>
          </button>
        )}
      </div>
    </div>
  );
}
