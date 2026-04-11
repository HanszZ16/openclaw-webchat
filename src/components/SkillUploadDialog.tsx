import { useState, useRef, type DragEvent } from 'react';
import { X, Upload, Plus, Trash2, FolderOpen, File } from 'lucide-react';
import { uploadSkill } from '../lib/marketApi';

type Props = {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
};

type FileEntry = { path: string; content: string; size: number };

/** Read all files from a DataTransferItem directory entry recursively */
async function readDirectoryEntry(entry: FileSystemDirectoryEntry, prefix = ''): Promise<FileEntry[]> {
  const results: FileEntry[] = [];
  const reader = entry.createReader();

  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  // readEntries may return partial results, loop until empty
  let batch: FileSystemEntry[];
  do {
    batch = await readBatch();
    for (const child of batch) {
      const childPath = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (child as FileSystemFileEntry).file(resolve, reject),
        );
        const text = await file.text();
        results.push({ path: childPath, content: text, size: file.size });
      } else if (child.isDirectory) {
        const nested = await readDirectoryEntry(child as FileSystemDirectoryEntry, childPath);
        results.push(...nested);
      }
    }
  } while (batch.length > 0);

  return results;
}

/** Read files from a webkitdirectory input */
async function readWebkitDirectoryFiles(fileList: FileList): Promise<FileEntry[]> {
  const results: FileEntry[] = [];
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    // webkitRelativePath = "folderName/sub/file.js"
    const relPath = file.webkitRelativePath;
    // Strip the top-level folder name to get relative path within the skill
    const parts = relPath.split('/');
    const innerPath = parts.slice(1).join('/');
    if (!innerPath) continue;
    const text = await file.text();
    results.push({ path: innerPath, content: text, size: file.size });
  }
  return results;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function SkillUploadDialog({ open, onClose, onUploaded }: Props) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [emoji, setEmoji] = useState('');
  const [tagsStr, setTagsStr] = useState('');
  const [homepage, setHomepage] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setKey(''); setName(''); setVersion('1.0.0'); setDescription('');
    setAuthor(''); setEmoji(''); setTagsStr(''); setHomepage('');
    setFiles([]); setError(null); setDragOver(false);
  };

  /** Try to auto-fill form from a skill.json file in the entries */
  const autoFillFromSkillJson = (entries: FileEntry[]) => {
    const skillJson = entries.find((f) => f.path === 'skill.json');
    if (!skillJson) return;
    try {
      const meta = JSON.parse(skillJson.content);
      if (meta.key && !key) setKey(meta.key);
      if (meta.name && !name) setName(meta.name);
      if (meta.version) setVersion(meta.version);
      if (meta.description) setDescription(meta.description);
      if (meta.author) setAuthor(meta.author);
      if (meta.emoji) setEmoji(meta.emoji);
      if (meta.homepage) setHomepage(meta.homepage);
      if (Array.isArray(meta.tags) && meta.tags.length > 0) {
        setTagsStr(meta.tags.join(', '));
      }
    } catch { /* ignore parse errors */ }
  };

  /** Handle folder selected via webkitdirectory input */
  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setError(null);
    try {
      const entries = await readWebkitDirectoryFiles(fileList);
      setFiles(entries);
      autoFillFromSkillJson(entries);
    } catch (err) {
      setError('读取文件夹失败: ' + (err instanceof Error ? err.message : String(err)));
    }
    // Reset input so the same folder can be re-selected
    e.target.value = '';
  };

  /** Handle individual files added */
  const handleFilesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const newFiles: FileEntry[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const text = await file.text();
      newFiles.push({ path: file.name, content: text, size: file.size });
    }
    setFiles((prev) => [...prev, ...newFiles]);
    autoFillFromSkillJson(newFiles);
    e.target.value = '';
  };

  /** Handle drag & drop */
  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    setError(null);

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    const allEntries: FileEntry[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const entry = item.webkitGetAsEntry?.();
      if (!entry) continue;

      if (entry.isDirectory) {
        const dirEntries = await readDirectoryEntry(entry as FileSystemDirectoryEntry);
        allEntries.push(...dirEntries);
      } else if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        const text = await file.text();
        allEntries.push({ path: file.name, content: text, size: file.size });
      }
    }

    if (allEntries.length > 0) {
      setFiles(allEntries);
      autoFillFromSkillJson(allEntries);
    }
  };

  const handleFileRemove = (idx: number) => {
    setFiles(files.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!key.trim() || !name.trim()) {
      setError('技能 Key 和名称为必填项');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const tags = tagsStr.split(/[,，\s]+/).filter(Boolean);
      const fileMap: Record<string, string> = {};
      for (const f of files) {
        if (f.path !== 'skill.json') {
          fileMap[f.path] = f.content;
        }
      }

      await uploadSkill(
        { key: key.trim(), name: name.trim(), version, description, author, emoji, tags, homepage },
        Object.keys(fileMap).length > 0 ? fileMap : undefined,
      );

      reset();
      onUploaded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="market-dialog-overlay" onClick={onClose}>
      <div className="market-dialog market-dialog-lg" onClick={(e) => e.stopPropagation()}>
        <div className="market-dialog-header">
          <h3 className="text-base font-bold text-gray-800">上传技能</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="market-dialog-body">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Drop zone */}
          <div
            className={`market-dropzone ${dragOver ? 'market-dropzone-active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <FolderOpen className="w-8 h-8 text-gray-300" />
            <p className="text-sm text-gray-500">
              拖拽文件夹或文件到这里
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => folderInputRef.current?.click()}
                className="market-btn-secondary !py-1.5 !px-3 !text-xs"
              >
                <FolderOpen className="w-3.5 h-3.5 inline mr-1" />
                选择文件夹
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="market-btn-secondary !py-1.5 !px-3 !text-xs"
              >
                <Plus className="w-3.5 h-3.5 inline mr-1" />
                选择文件
              </button>
            </div>
            {/* Hidden inputs */}
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
              multiple
              onChange={handleFolderSelect}
            />
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={handleFilesSelect}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="market-file-list">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-gray-500">{files.length} 个文件</span>
                <button
                  onClick={() => setFiles([])}
                  className="text-[11px] text-gray-400 hover:text-red-500"
                >
                  清空
                </button>
              </div>
              <div className="market-file-list-body">
                {files.map((f, idx) => (
                  <div key={f.path + idx} className="market-file-item">
                    <File className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="flex-1 truncate text-xs font-mono text-gray-600" title={f.path}>
                      {f.path}
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0">{formatSize(f.size)}</span>
                    <button onClick={() => handleFileRemove(idx)} className="p-0.5 text-gray-300 hover:text-red-500">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metadata form */}
          <div className="market-form-grid">
            <div className="market-form-field">
              <label>Key <span className="text-red-400">*</span></label>
              <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="my-skill" />
            </div>
            <div className="market-form-field">
              <label>名称 <span className="text-red-400">*</span></label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="我的技能" />
            </div>
            <div className="market-form-field">
              <label>版本</label>
              <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
            </div>
            <div className="market-form-field">
              <label>作者</label>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="your name" />
            </div>
            <div className="market-form-field">
              <label>Emoji</label>
              <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🧩" />
            </div>
            <div className="market-form-field">
              <label>主页</label>
              <input value={homepage} onChange={(e) => setHomepage(e.target.value)} placeholder="https://..." />
            </div>
          </div>

          <div className="market-form-field">
            <label>描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个技能可以..."
              rows={2}
            />
          </div>

          <div className="market-form-field">
            <label>标签（逗号分隔）</label>
            <input value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} placeholder="工具, API, 天气" />
          </div>

          {files.some((f) => f.path === 'skill.json') && (
            <div className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              已从 skill.json 自动填充元数据，你可以手动修改上方表单
            </div>
          )}
        </div>

        <div className="market-dialog-footer">
          <button onClick={onClose} className="market-btn-secondary">取消</button>
          <button onClick={handleSubmit} disabled={loading} className="market-btn-primary">
            {loading ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                上传中...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5" />
                上传
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
