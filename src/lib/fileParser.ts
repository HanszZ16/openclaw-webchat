/**
 * Parse file content to text for injection into chat messages.
 * Supports: plain text, PDF, DOCX, XLSX/CSV, code files.
 */

// Text-based file extensions
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'log', 'sql', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'scala', 'c', 'cpp', 'h', 'hpp', 'cs',
  'php', 'swift', 'dart', 'lua', 'r', 'jl', 'ex', 'exs', 'erl', 'hs',
  'html', 'htm', 'css', 'scss', 'less', 'sass', 'vue', 'svelte',
  'dockerfile', 'makefile', 'gitignore', 'env',
]);

function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function isTextFile(file: File): boolean {
  const ext = getExtension(file.name);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (file.type.startsWith('text/')) return true;
  return false;
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || getExtension(file.name) === 'pdf';
}

export function isDocxFile(file: File): boolean {
  const ext = getExtension(file.name);
  return ext === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

export function isXlsxFile(file: File): boolean {
  const ext = getExtension(file.name);
  return ext === 'xlsx' || ext === 'xls' || ext === 'csv'
    || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || file.type === 'application/vnd.ms-excel';
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function isSupportedFile(_file: File): boolean {
  // All files are supported: recognized types get front-end parsing, others get uploaded to server
  return true;
}

export function getFileCategory(file: File): 'image' | 'pdf' | 'docx' | 'xlsx' | 'text' | 'unknown' {
  if (isImageFile(file)) return 'image';
  if (isPdfFile(file)) return 'pdf';
  if (isDocxFile(file)) return 'docx';
  if (isXlsxFile(file)) return 'xlsx';
  if (isTextFile(file)) return 'text';
  return 'unknown';
}

async function parseTextFile(file: File): Promise<string> {
  return file.text();
}

async function parsePdf(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');

  // Use bundled worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join('');
    if (text.trim()) {
      pages.push(`--- Page ${i} ---\n${text}`);
    }
  }

  return pages.join('\n\n');
}

async function parseDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function parseXlsx(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheets: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) {
      sheets.push(`--- Sheet: ${sheetName} ---\n${csv}`);
    }
  }

  return sheets.join('\n\n');
}

// Size threshold: files larger than this will be uploaded to server instead of front-end parsing
export const SERVER_UPLOAD_THRESHOLD = 512 * 1024; // 512KB

// Files that should always be uploaded to server (binary formats the front-end can't fully parse)
const ALWAYS_UPLOAD_EXTENSIONS = new Set([
  'doc', 'ppt', 'pptx', 'xls',  // old Office formats
  'zip', 'rar', '7z', 'tar', 'gz',
  'mp3', 'wav', 'ogg', 'mp4', 'avi', 'mov',
]);

export function shouldUploadToServer(file: File): boolean {
  const ext = getExtension(file.name);
  if (ALWAYS_UPLOAD_EXTENSIONS.has(ext)) return true;
  // Large PDF/DOCX/XLSX → upload to server for Agent to handle
  if (file.size > SERVER_UPLOAD_THRESHOLD && (isPdfFile(file) || isDocxFile(file) || isXlsxFile(file))) {
    return true;
  }
  return false;
}

export type UploadResult = {
  success: boolean;
  originalName: string;
  serverPath: string;
  error?: string;
};

/**
 * Upload a file to the server via /api/upload.
 */
export async function uploadFileToServer(file: File): Promise<UploadResult> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { success: false, originalName: file.name, serverPath: '', error: err.error || `HTTP ${res.status}` };
    }

    const data = await res.json();
    if (data.success && data.files?.length > 0) {
      return {
        success: true,
        originalName: file.name,
        serverPath: data.files[0].path,
      };
    }

    return { success: false, originalName: file.name, serverPath: '', error: 'Unexpected response' };
  } catch (err) {
    return {
      success: false,
      originalName: file.name,
      serverPath: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type ParseResult = {
  success: boolean;
  text: string;
  fileName: string;
  category: ReturnType<typeof getFileCategory>;
  error?: string;
};

/**
 * Parse a file and extract its text content.
 * Images are not parsed (they are sent as attachments).
 */
export async function parseFile(file: File): Promise<ParseResult> {
  const category = getFileCategory(file);

  if (category === 'image') {
    return { success: true, text: '', fileName: file.name, category };
  }

  if (category === 'unknown') {
    return {
      success: false,
      text: '',
      fileName: file.name,
      category,
      error: `Unsupported file type: ${file.name}`,
    };
  }

  try {
    let text = '';
    switch (category) {
      case 'text':
        text = await parseTextFile(file);
        break;
      case 'pdf':
        text = await parsePdf(file);
        break;
      case 'docx':
        text = await parseDocx(file);
        break;
      case 'xlsx':
        text = await parseXlsx(file);
        break;
    }

    if (!text.trim()) {
      return {
        success: false,
        text: '',
        fileName: file.name,
        category,
        error: `No text content found in ${file.name}`,
      };
    }

    return { success: true, text, fileName: file.name, category };
  } catch (err) {
    return {
      success: false,
      text: '',
      fileName: file.name,
      category,
      error: `Failed to parse ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
