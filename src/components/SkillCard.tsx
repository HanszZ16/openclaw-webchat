import { Download, Trash2, Eye, Tag } from 'lucide-react';
import type { SkillMeta } from '../lib/marketApi';
import { downloadSkillUrl } from '../lib/marketApi';

type Props = {
  skill: SkillMeta;
  onView: (skill: SkillMeta) => void;
  onDelete: (skill: SkillMeta) => void;
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

export function SkillCard({ skill, onView, onDelete }: Props) {
  return (
    <div className="market-card">
      <div className="market-card-header">
        <span className="market-card-emoji">{skill.emoji || '🧩'}</span>
        <div className="min-w-0 flex-1">
          <div className="market-card-name">{skill.name}</div>
          <div className="market-card-meta">
            v{skill.version} · {skill.author}
          </div>
        </div>
      </div>

      {skill.description && (
        <p className="market-card-desc">{skill.description}</p>
      )}

      {skill.tags.length > 0 && (
        <div className="market-card-tags">
          {skill.tags.map((tag) => (
            <span key={tag} className="market-tag">
              <Tag className="w-2.5 h-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="market-card-footer">
        <span className="text-[11px] text-gray-400">
          {skill.updatedAt ? timeAgo(skill.updatedAt) : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onView(skill)}
            className="market-card-btn market-card-btn-view"
            title="查看详情"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
          <a
            href={downloadSkillUrl(skill.key)}
            download
            className="market-card-btn market-card-btn-download"
            title="下载"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={() => onDelete(skill)}
            className="market-card-btn market-card-btn-delete"
            title="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
