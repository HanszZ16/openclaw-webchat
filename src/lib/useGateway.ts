import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GatewayClient,
  type ChatRunPayload,
  type GatewayEventFrame,
  type HelloOk,
  type ToolEventData,
} from './gateway';
import type { Attachment, ChatMessage, ConnectionConfig, ContentBlock, ToolEntry } from './types';

export type GatewayState = {
  connected: boolean;
  hello: HelloOk | null;
  messages: ChatMessage[];
  stream: string | null;
  streamTools: ToolEntry[];
  loading: boolean;
  sending: boolean;
  runId: string | null;
  error: string | null;
  sessionKey: string;
};

export type UseGatewayOptions = {
  /** Fixed session key (e.g. from URL param user). If set, disables session switching. */
  fixedSessionKey?: string | null;
};

export function useGateway(config: ConnectionConfig | null, options?: UseGatewayOptions) {
  const fixedKey = options?.fixedSessionKey;

  const clientRef = useRef<GatewayClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [hello, setHello] = useState<HelloOk | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stream, setStream] = useState<string | null>(null);
  const [streamTools, setStreamTools] = useState<ToolEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(() => {
    // If fixedSessionKey is set (iframe mode), use it directly
    if (fixedKey) return fixedKey;
    return localStorage.getItem('oc-session-key') || 'main';
  });

  const runIdRef = useRef(runId);
  runIdRef.current = runId;

  // Handle chat events
  const handleChatRun = useCallback((payload: ChatRunPayload) => {
    if (payload.state === 'delta') {
      setRunId(payload.runId);
      // Delta message contains FULL accumulated text (not incremental)
      const msg = payload.message as Record<string, unknown> | undefined;
      if (msg) {
        const content = msg.content;
        if (typeof content === 'string') {
          setStream(content);
        } else if (Array.isArray(content)) {
          const texts: string[] = [];
          for (const block of content) {
            if (block && typeof block === 'object' && 'type' in block) {
              if (block.type === 'text' && typeof block.text === 'string') {
                texts.push(block.text);
              }
            }
          }
          if (texts.length > 0) {
            setStream(texts.join(''));
          }
        }
      }
    } else if (payload.state === 'final') {
      // Finalize: add complete message
      const msg = payload.message as Record<string, unknown> | undefined;
      if (msg) {
        const content = msg.content;
        let blocks: ContentBlock[];
        if (typeof content === 'string') {
          blocks = [{ type: 'text', text: content }];
        } else if (Array.isArray(content)) {
          blocks = content as ContentBlock[];
        } else {
          blocks = [];
        }
        const finalMsg: ChatMessage = {
          role: 'assistant',
          content: blocks,
          timestamp: (msg.timestamp as number) ?? Date.now(),
        };
        setMessages((prev) => [...prev, finalMsg]);
      }
      setStream(null);
      setStreamTools([]);
      setRunId(null);
      setSending(false);
    } else if (payload.state === 'aborted') {
      // Add partial message
      const msg = payload.message as Record<string, unknown> | undefined;
      if (msg) {
        const content = msg.content;
        let blocks: ContentBlock[];
        if (typeof content === 'string') {
          blocks = [{ type: 'text', text: content }];
        } else if (Array.isArray(content)) {
          blocks = content as ContentBlock[];
        } else {
          blocks = [];
        }
        if (blocks.length > 0) {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: blocks, timestamp: Date.now() },
          ]);
        }
      }
      setStream(null);
      setStreamTools([]);
      setRunId(null);
      setSending(false);
    } else if (payload.state === 'error') {
      setError(payload.errorMessage ?? 'Unknown error');
      setStream(null);
      setStreamTools([]);
      setRunId(null);
      setSending(false);
    }
  }, []);

  // Handle agent.tool events
  const handleToolEvent = useCallback((data: ToolEventData) => {
    setStreamTools((prev) => {
      const existing = prev.find((t) => t.toolCallId === data.toolCallId);
      if (existing) {
        return prev.map((t) =>
          t.toolCallId === data.toolCallId
            ? {
                ...t,
                phase: data.phase,
                output: data.phase === 'result' ? String(data.result ?? '') : (data.partialResult ?? t.output),
              }
            : t,
        );
      }
      return [
        ...prev,
        {
          toolCallId: data.toolCallId,
          name: data.name,
          args: data.args,
          output: data.partialResult ?? (data.phase === 'result' ? String(data.result ?? '') : undefined),
          phase: data.phase,
          startedAt: Date.now(),
        },
      ];
    });
  }, []);

  // Handle events
  const handleEvent = useCallback(
    (evt: GatewayEventFrame) => {
      if (evt.event === 'chat') {
        handleChatRun(evt.payload as ChatRunPayload);
      } else if (evt.event === 'agent') {
        const p = evt.payload as { stream?: string; data?: ToolEventData } | undefined;
        if (p?.stream === 'tool' && p?.data) {
          handleToolEvent(p.data);
        }
      }
    },
    [handleChatRun, handleToolEvent],
  );

  // Connect to gateway
  useEffect(() => {
    if (!config) return;

    const client = new GatewayClient({
      url: config.wsUrl,
      password: config.password || undefined,
      onHello: (h) => {
        setHello(h);
        setError(null);
      },
      onEvent: handleEvent,
      onClose: () => {},
      onConnectedChange: (c) => setConnected(c),
    });

    clientRef.current = client;
    client.start();

    return () => {
      client.stop();
      clientRef.current = null;
    };
  }, [config, handleEvent]);

  // Load chat history when connected or session changes
  useEffect(() => {
    if (!connected || !clientRef.current) return;

    const loadHistory = async () => {
      setLoading(true);
      try {
        const res = await clientRef.current!.request<{
          messages?: unknown[];
          thinkingLevel?: string;
        }>('chat.history', { sessionKey, limit: 200 });
        const msgs = Array.isArray(res.messages) ? res.messages : [];
        setMessages(
          msgs.map((m) => {
            const msg = m as Record<string, unknown>;
            return {
              role: ((msg.role as string) ?? 'assistant') as ChatMessage['role'],
              content: msg.content as ContentBlock[] | string,
              timestamp: msg.timestamp as number | undefined,
            };
          }),
        );
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [connected, sessionKey]);

  // Send message
  const sendMessage = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      if (!clientRef.current || !connected) return;
      const trimmed = text.trim();
      const hasAttachments = attachments && attachments.length > 0;
      if (!trimmed && !hasAttachments) return;

      // Separate attachments by type
      const imageAttachments = hasAttachments ? attachments!.filter((a) => a.category === 'image') : [];
      const parsedAttachments = hasAttachments ? attachments!.filter((a) => a.category !== 'image' && a.textContent && !a.uploaded) : [];
      const uploadedAttachments = hasAttachments ? attachments!.filter((a) => a.uploaded && a.serverPath) : [];

      // Build the final message text
      let finalMessage = trimmed;
      const fileSections: string[] = [];

      // Front-end parsed files: inject text content
      if (parsedAttachments.length > 0) {
        for (const att of parsedAttachments) {
          const ext = att.file.name.split('.').pop() || 'txt';
          fileSections.push(`<file name="${att.file.name}">\n\`\`\`${ext}\n${att.textContent}\n\`\`\`\n</file>`);
        }
      }

      // Server-uploaded files: tell Agent the file path
      if (uploadedAttachments.length > 0) {
        for (const att of uploadedAttachments) {
          fileSections.push(`[Uploaded file: ${att.file.name}]\nFile saved on server at: ${att.serverPath}\nPlease use your read tool or exec tool to access this file.`);
        }
      }

      if (fileSections.length > 0) {
        const allFiles = fileSections.join('\n\n');
        finalMessage = finalMessage
          ? `${allFiles}\n\n${finalMessage}`
          : allFiles;
      }

      // Build user content blocks for local display
      const userBlocks: ContentBlock[] = [];
      if (trimmed) {
        userBlocks.push({ type: 'text', text: trimmed });
      }
      // Show document info in local display
      for (const att of parsedAttachments) {
        userBlocks.push({ type: 'text', text: `[File: ${att.file.name}]` });
      }
      for (const att of uploadedAttachments) {
        userBlocks.push({ type: 'text', text: `[Uploaded: ${att.file.name}]` });
      }
      // Show images in local display
      for (const att of imageAttachments) {
        userBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: att.mimeType, data: att.dataUrl },
        });
      }

      // Add user message to local state
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: userBlocks, timestamp: Date.now() },
      ]);
      setSending(true);
      setError(null);
      setStream(null);
      setStreamTools([]);

      try {
        // Build image attachments for gateway (same format as official Control UI)
        const gwAttachments = imageAttachments.length > 0
          ? imageAttachments
              .map((att) => {
                const match = /^data:([^;]+);base64,(.+)$/.exec(att.dataUrl);
                if (!match) return null;
                return {
                  type: 'image' as const,
                  mimeType: match[1],
                  content: match[2],
                };
              })
              .filter((a): a is NonNullable<typeof a> => a !== null)
          : undefined;

        await clientRef.current.request('chat.send', {
          sessionKey,
          message: finalMessage,
          attachments: gwAttachments,
          deliver: false,
          idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
      } catch (err) {
        setError(String(err));
        setSending(false);
      }
    },
    [connected, sessionKey],
  );

  // Abort
  const abort = useCallback(async () => {
    if (!clientRef.current || !connected) return;
    try {
      await clientRef.current.request('chat.abort', {
        sessionKey,
        runId: runIdRef.current,
      });
    } catch {
      // ignore
    }
  }, [connected, sessionKey]);

  // New session
  const newSession = useCallback(() => {
    const key = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('oc-session-key', key);
    setSessionKey(key);
    setMessages([]);
    setStream(null);
    setStreamTools([]);
    setRunId(null);
    setError(null);
  }, []);

  // Switch model
  const switchModel = useCallback(
    async (model: string) => {
      if (!clientRef.current || !connected) return;
      try {
        await clientRef.current.request('sessions.patch', {
          key: sessionKey,
          model,
        });
      } catch (err) {
        setError(String(err));
      }
    },
    [connected, sessionKey],
  );

  // Clear history: delete current session on gateway + create new session
  const clearHistory = useCallback(async () => {
    if (clientRef.current && connected && sessionKey !== 'main') {
      try {
        await clientRef.current.request('sessions.delete', {
          key: sessionKey,
          deleteTranscript: true,
        });
      } catch {
        // session might not exist on server, ignore
      }
    }
    // Create a brand new session
    const key = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('oc-session-key', key);
    setSessionKey(key);
    setMessages([]);
    setStream(null);
    setStreamTools([]);
    setRunId(null);
    setError(null);
  }, [connected, sessionKey]);

  return {
    connected,
    hello,
    messages,
    stream,
    streamTools,
    loading,
    sending,
    runId,
    error,
    sessionKey,
    sendMessage,
    abort,
    newSession,
    clearHistory,
    switchModel,
    setError,
    client: clientRef,
  };
}
