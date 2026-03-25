import { useRef, useState, useCallback, useEffect } from 'react';
import { Send, Square, Paperclip, X, Mic, MicOff, FileText, FileSpreadsheet, File as FileIcon, Loader2, Upload, AlertCircle } from 'lucide-react';
import type { Attachment } from '../lib/types';
import { isImageFile, getFileCategory, parseFile, shouldUploadToServer, uploadFileToServer } from '../lib/fileParser';
import { useVoiceInput } from '../lib/useVoiceInput';

type Props = {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onAbort: () => void;
  sending: boolean;
  disabled: boolean;
  disabledReason?: string | null;
  assistantName?: string;
};

let attachmentCounter = 0;

const MAX_FILE_SIZE = 50_000_000; // 50MB

function FileTypeIcon({ category, uploaded }: { category: string; uploaded?: boolean }) {
  if (uploaded) return <Upload className="w-5 h-5 text-emerald-500" />;
  switch (category) {
    case 'pdf':
      return <FileText className="w-5 h-5 text-red-400" />;
    case 'docx':
      return <FileText className="w-5 h-5 text-blue-400" />;
    case 'xlsx':
      return <FileSpreadsheet className="w-5 h-5 text-green-500" />;
    case 'text':
      return <FileIcon className="w-5 h-5 text-gray-400" />;
    default:
      return <FileIcon className="w-5 h-5 text-gray-400" />;
  }
}

export function ChatInput({ onSend, onAbort, sending, disabled, disabledReason, assistantName }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [processing, setProcessing] = useState(0); // count of files being processed
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Voice input with 2pass online/offline accumulation
  const { state: voiceState, toggle: toggleVoice } = useVoiceInput({
    asrUrl: '/ws-asr',
    onDisplayUpdate: (displayText) => {
      setText(displayText);
    },
    onError: (msg) => {
      setVoiceError(msg);
      setTimeout(() => setVoiceError(null), 5000);
    },
  });

  const handleVoiceToggle = useCallback(() => {
    toggleVoice(text);
  }, [text, toggleVoice]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [text]);

  const handleSend = useCallback(() => {
    if (sending) { onAbort(); return; }
    if (processing > 0) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setText('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [text, attachments, sending, processing, onSend, onAbort]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const addFile = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      alert(`文件过大：${file.name}（最大 50MB）`);
      return;
    }

    const id = `att-${++attachmentCounter}`;
    const category = getFileCategory(file);

    if (isImageFile(file)) {
      // Images: read as data URL for preview and sending via gateway
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setAttachments((prev) => [...prev, {
          id, file, dataUrl, mimeType: file.type, previewUrl: dataUrl, category,
        }]);
      };
      reader.readAsDataURL(file);
      return;
    }

    // Add placeholder immediately
    const useServerUpload = shouldUploadToServer(file);
    setAttachments((prev) => [...prev, {
      id, file, dataUrl: '', mimeType: file.type, previewUrl: '', category,
      uploadStatus: useServerUpload ? 'uploading' : undefined,
    }]);
    setProcessing((n) => n + 1);

    if (useServerUpload) {
      // Large/binary files: upload to server
      const result = await uploadFileToServer(file);
      setAttachments((prev) => prev.map((att) =>
        att.id === id
          ? {
              ...att,
              uploaded: result.success,
              serverPath: result.serverPath,
              uploadStatus: result.success ? 'done' : 'error',
              parseError: result.error,
            }
          : att,
      ));
    } else {
      // Small text/document files: front-end parsing
      const result = await parseFile(file);
      setAttachments((prev) => prev.map((att) =>
        att.id === id
          ? { ...att, textContent: result.text, parseError: result.error }
          : att,
      ));
    }

    setProcessing((n) => n - 1);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    for (const file of Array.from(e.target.files)) {
      addFile(file);
    }
    e.target.value = '';
  }, [addFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addFile(file);
      }
    }
  }, [addFile]);

  const [dragOver, setDragOver] = useState(false);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    for (const file of Array.from(e.dataTransfer.files)) {
      addFile(file);
    }
  }, [addFile]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div
      className={`bg-white px-4 pb-4 pt-2 ${dragOver ? 'ring-2 ring-blue-400/50 ring-inset' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {attachments.map((att) => (
            <div key={att.id} className="relative group/att">
              {att.category === 'image' ? (
                <img src={att.previewUrl} alt={att.file.name}
                  className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
              ) : (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border max-w-[220px] ${
                  att.parseError || att.uploadStatus === 'error'
                    ? 'border-red-200 bg-red-50'
                    : att.uploaded
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-gray-200 bg-gray-50'
                }`} title={att.parseError || att.serverPath || att.file.name}>
                  <FileTypeIcon category={att.category || 'unknown'} uploaded={att.uploaded} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-gray-700 truncate">{att.file.name}</div>
                    <div className="text-[10px] text-gray-400">
                      {att.uploadStatus === 'uploading' ? (
                        <span className="flex items-center gap-1 text-blue-500">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> 上传中...
                        </span>
                      ) : att.uploadStatus === 'error' ? (
                        <span className="flex items-center gap-1 text-red-400">
                          <AlertCircle className="w-2.5 h-2.5" /> 上传失败
                        </span>
                      ) : att.uploaded ? (
                        <span className="text-emerald-600">已上传 {formatSize(att.file.size)}</span>
                      ) : att.textContent === undefined && !att.parseError ? (
                        <span className="flex items-center gap-1">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> 解析中...
                        </span>
                      ) : att.parseError ? (
                        <span className="text-red-400">解析失败</span>
                      ) : (
                        `${(att.textContent?.length ?? 0).toLocaleString()} 字符`
                      )}
                    </div>
                  </div>
                </div>
              )}
              <button onClick={() => setAttachments((p) => p.filter((a) => a.id !== att.id))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity">
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Voice input status */}
      {voiceError && (
        <div className="mb-2 px-3 py-1.5 text-xs text-red-600 bg-red-50 rounded-lg">{voiceError}</div>
      )}
      {voiceState === 'recording' && (
        <div className="mb-2 flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 bg-red-50/50 rounded-lg">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          正在录音，点击麦克风按钮停止...
        </div>
      )}

      {/* Main input container */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={disabledReason || `给 ${assistantName || '助手'} 发消息（回车发送）`}
          disabled={disabled}
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-[15px] text-gray-900 placeholder-gray-400 focus:outline-none disabled:opacity-50"
          style={{ maxHeight: 200 }}
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-1">
            <button onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="添加附件">
              <Paperclip className="w-4 h-4" />
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
            <button
              onClick={handleVoiceToggle}
              disabled={disabled || voiceState === 'connecting' || voiceState === 'stopping'}
              className={`p-1.5 rounded-lg transition-colors ${
                voiceState === 'recording'
                  ? 'text-red-500 bg-red-50 hover:bg-red-100'
                  : voiceState === 'connecting' || voiceState === 'stopping'
                    ? 'text-amber-500 animate-pulse'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title={
                voiceState === 'recording' ? '停止语音输入'
                  : voiceState === 'connecting' ? '连接中...'
                    : voiceState === 'stopping' ? '识别中...'
                      : '语音输入'
              }
            >
              {voiceState === 'recording' ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>
          <button onClick={handleSend} disabled={(disabled && !sending) || processing > 0}
            className={`p-2 rounded-full transition-colors ${
              sending
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed'
            }`}
            title={sending ? '停止' : '发送'}>
            {sending ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
