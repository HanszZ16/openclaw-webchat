import { useCallback, useEffect, useState } from 'react';
import { Store, RefreshCw, Search, Upload, X, ArrowLeft, Tag } from 'lucide-react';
import { SkillCard } from './SkillCard';
import { SkillUploadDialog } from './SkillUploadDialog';
import { listMarketSkills, getSkillDetail, deleteSkill } from '../lib/marketApi';
import type { SkillMeta, SkillDetail } from '../lib/marketApi';

export function SkillMarketPanel() {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMarketSkills();
      setSkills(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleView = async (skill: SkillMeta) => {
    setDetailLoading(true);
    try {
      const d = await getSkillDetail(skill.key);
      setDetail(d);
    } catch {
      setDetail({ skill, files: [], readme: '' });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelete = async (skill: SkillMeta) => {
    if (!confirm(`确定要删除技能「${skill.name}」吗？`)) return;
    try {
      await deleteSkill(skill.key);
      fetchSkills();
      if (detail?.skill.key === skill.key) setDetail(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  // Collect all tags
  const allTags = Array.from(new Set(skills.flatMap((s) => s.tags))).filter(Boolean);

  // Filter
  const filtered = skills.filter((s) => {
    const q = search.toLowerCase();
    const matchSearch = !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.key.toLowerCase().includes(q);
    const matchTag = !selectedTag || s.tags.includes(selectedTag);
    return matchSearch && matchTag;
  });

  // Detail view
  if (detail) {
    return (
      <div className="admin-panel">
        <div className="admin-header">
          <div className="flex items-center gap-2">
            <button onClick={() => setDetail(null)} className="p-1 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <span className="text-lg">{detail.skill.emoji || '🧩'}</span>
            <h2 className="text-lg font-bold">{detail.skill.name}</h2>
          </div>
        </div>
        <div className="admin-content">
          <div className="admin-section">
            <h3 className="admin-section-title">基本信息</h3>
            <div className="admin-section-body">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-400">Key:</span> <span className="font-mono">{detail.skill.key}</span></div>
                <div><span className="text-gray-400">版本:</span> v{detail.skill.version}</div>
                <div><span className="text-gray-400">作者:</span> {detail.skill.author}</div>
                <div><span className="text-gray-400">需要授权:</span> {detail.skill.requiresAuth ? '是' : '否'}</div>
              </div>
              {detail.skill.description && (
                <p className="text-sm text-gray-600 mt-3">{detail.skill.description}</p>
              )}
              {detail.skill.tags.length > 0 && (
                <div className="flex gap-1.5 mt-3 flex-wrap">
                  {detail.skill.tags.map((tag) => (
                    <span key={tag} className="market-tag">
                      <Tag className="w-2.5 h-2.5" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {detail.skill.homepage && (
                <a href={detail.skill.homepage} target="_blank" rel="noopener noreferrer" className="text-sm text-emerald-600 hover:underline mt-2 inline-block">
                  访问主页
                </a>
              )}
            </div>
          </div>

          {detail.files.length > 0 && (
            <div className="admin-section">
              <h3 className="admin-section-title">包含文件</h3>
              <div className="admin-section-body space-y-1">
                {detail.files.map((f) => (
                  <div key={f} className="text-sm font-mono text-gray-600 px-2 py-1 bg-gray-50 rounded">{f}</div>
                ))}
              </div>
            </div>
          )}

          {detail.readme && (
            <div className="admin-section">
              <h3 className="admin-section-title">README</h3>
              <div className="admin-section-body">
                <pre className="text-sm whitespace-pre-wrap text-gray-700 leading-relaxed">{detail.readme}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-panel">
      {/* Header */}
      <div className="admin-header">
        <div className="flex items-center gap-2">
          <Store className="w-5 h-5 text-white/80" />
          <h2 className="text-lg font-bold">技能市场</h2>
          <span className="text-xs text-white/60 font-normal">{skills.length} 个技能</span>
        </div>
        <div className="flex items-center gap-2">
          {loading && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          <button onClick={fetchSkills} className="p-1.5 rounded-lg transition-colors" title="刷新">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setUploadOpen(true)} className="market-upload-btn" title="上传技能">
            <Upload className="w-4 h-4" />
            <span className="text-xs font-medium">上传</span>
          </button>
        </div>
      </div>

      <div className="admin-content">
        {/* Search bar */}
        <div className="market-search-bar">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索技能名称、描述..."
            className="market-search-input"
          />
          {search && (
            <button onClick={() => setSearch('')} className="p-0.5 rounded hover:bg-gray-100 text-gray-400">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Tags filter */}
        {allTags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setSelectedTag(null)}
              className={`market-filter-tag ${!selectedTag ? 'market-filter-tag-active' : ''}`}
            >
              全部
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={`market-filter-tag ${selectedTag === tag ? 'market-filter-tag-active' : ''}`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{error}</div>
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Store className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">{skills.length === 0 ? '技能市场暂无技能' : '没有匹配的技能'}</p>
            <button onClick={() => setUploadOpen(true)} className="mt-3 text-sm text-emerald-600 hover:underline">
              上传第一个技能
            </button>
          </div>
        )}

        {/* Skills grid */}
        {filtered.length > 0 && (
          <div className="market-grid">
            {filtered.map((skill) => (
              <SkillCard
                key={skill.key}
                skill={skill}
                onView={handleView}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && skills.length === 0 && (
          <div className="market-grid">
            {[1, 2, 3].map((i) => (
              <div key={i} className="market-card">
                <div className="flex gap-3 items-center">
                  <div className="skeleton w-10 h-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-4 w-24" />
                    <div className="skeleton h-3 w-16" />
                  </div>
                </div>
                <div className="skeleton h-3 w-full mt-3" />
                <div className="skeleton h-3 w-2/3 mt-1" />
              </div>
            ))}
          </div>
        )}

        {detailLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
          </div>
        )}
      </div>

      <SkillUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={fetchSkills}
      />
    </div>
  );
}
