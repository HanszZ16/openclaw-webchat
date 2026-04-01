export type ConnectionConfig = {
  wsUrl: string;
  password: string;
  token?: string;
};

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: ContentBlock[] | string;
  timestamp?: number;
  // For tool messages from agent.tool events
  toolCallId?: string;
  runId?: string;
  // Metadata
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
  /** True if the message failed to send */
  sendFailed?: boolean;
  /** Thinking/reasoning content from the model */
  thinking?: string;
  /** Tool calls executed during this turn */
  tools?: ToolEntry[];
};

export type ToolEntry = {
  toolCallId: string;
  name: string;
  args?: unknown;
  output?: string;
  phase: 'start' | 'update' | 'result';
  startedAt: number;
  /** Inferred skill that likely triggered this tool */
  skillHint?: string;
};

export type Attachment = {
  id: string;
  file: File;
  dataUrl: string;
  mimeType: string;
  previewUrl: string;
  /** For non-image files: extracted text content (front-end parsed) */
  textContent?: string;
  /** File category */
  category?: 'image' | 'pdf' | 'docx' | 'xlsx' | 'text' | 'unknown';
  /** Parse error message */
  parseError?: string;
  /** Server-side uploaded file path (for Agent read tool access) */
  serverPath?: string;
  /** Whether this file was uploaded to server */
  uploaded?: boolean;
  /** Upload status */
  uploadStatus?: 'uploading' | 'done' | 'error';
};
