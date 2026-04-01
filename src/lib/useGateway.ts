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
  streamThinking: string | null;
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
  const [streamThinking, setStreamThinking] = useState<string | null>(null);
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
  const streamToolsRef = useRef(streamTools);
  streamToolsRef.current = streamTools;
  const streamThinkingRef = useRef(streamThinking);
  streamThinkingRef.current = streamThinking;
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;

  // ── Server-side turn cache: persist tool/thinking data across refreshes ──
  const saveTurnToServer = useCallback(async (
    sk: string, ts: number,
    data: { tools?: ToolEntry[]; thinking?: string; cleanText?: string; model?: string; usage?: unknown },
  ) => {
    try {
      await fetch('/api/turns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey: sk, timestamp: ts, data }),
      });
    } catch { /* fire and forget */ }
  }, []);

  const loadTurnsFromServer = useCallback(async (sk: string): Promise<Record<string, {
    tools?: ToolEntry[]; thinking?: string; cleanText?: string; model?: string; usage?: { input_tokens?: number; output_tokens?: number };
  }>> => {
    try {
      const res = await fetch(`/api/turns?sessionKey=${encodeURIComponent(sk)}`);
      if (!res.ok) return {};
      const data = await res.json();
      return data.turns || {};
    } catch { return {}; }
  }, []);

  // ── Skill inference: guess which skill triggered a tool call ──
  const inferSkill = useCallback((name: string, args: unknown): string | undefined => {
    const argsStr = typeof args === 'string' ? args : JSON.stringify(args ?? '');
    if (name === 'exec' || name === 'shell') {
      if (/\bgh\s/.test(argsStr) || /github\.com/i.test(argsStr)) return 'github';
      if (/\bgit\s/.test(argsStr)) return 'git';
      if (/\bnpm\s|yarn\s|pnpm\s|bun\s/.test(argsStr)) return 'nodejs';
      if (/\bdocker\s/.test(argsStr)) return 'docker';
      if (/\bkubectl\s/.test(argsStr)) return 'kubernetes';
      if (/\bcurl\s|wget\s/.test(argsStr)) return 'http';
      if (/\bpython\s|pip\s/.test(argsStr)) return 'python';
    }
    if (name === 'web_search' || name === 'search') return 'web-search';
    if (name === 'web_fetch' || name === 'fetch') return 'web-fetch';
    if (name === 'browser' || name === 'browser_navigate' || name === 'browser_click') return 'browser';
    if (name === 'canvas' || name === 'draw') return 'canvas';
    if (name === 'memory_read' || name === 'memory_write') return 'memory';
    return undefined;
  }, []);

  // ── Helpers ──
  const parseContentBlocks = (content: unknown): ContentBlock[] => {
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    if (Array.isArray(content)) return content as ContentBlock[];
    return [];
  };

  const extractText = (blocks: ContentBlock[]): string =>
    blocks
      .filter((b): b is { type: 'text'; text: string } =>
        b != null && typeof b === 'object' && 'type' in b && b.type === 'text' && typeof (b as { text?: string }).text === 'string')
      .map((b) => b.text)
      .join('\n');

  const collectStreamState = () => ({
    thinking: streamThinkingRef.current || undefined,
    tools: streamToolsRef.current.length > 0 ? [...streamToolsRef.current] : undefined,
  });

  const resetStreamState = () => {
    setStream(null);
    setStreamThinking(null);
    setStreamTools([]);
    setRunId(null);
    setSending(false);
  };

  // Handle chat events
  const handleChatRun = useCallback((payload: ChatRunPayload) => {
    if (payload.state === 'delta') {
      setRunId(payload.runId);
      const msg = payload.message as Record<string, unknown> | undefined;
      if (msg) {
        const text = extractText(parseContentBlocks(msg.content));
        if (text) setStream(text);
      }
    } else if (payload.state === 'final') {
      const msg = payload.message as Record<string, unknown> | undefined;
      if (msg) {
        const blocks = parseContentBlocks(msg.content);
        const ts = (msg.timestamp as number) ?? Date.now();
        const { thinking, tools } = collectStreamState();
        const cleanText = extractText(blocks) || undefined;
        const msgUsage = payload.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        const msgModel = (msg.model as string) || undefined;

        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: blocks,
          timestamp: ts,
          thinking,
          tools,
          usage: msgUsage,
          model: msgModel,
        }]);

        if (tools || thinking) {
          saveTurnToServer(sessionKeyRef.current, ts, { tools, thinking, cleanText, model: msgModel, usage: msgUsage });
        }
      }
      resetStreamState();
    } else if (payload.state === 'aborted') {
      const msg = payload.message as Record<string, unknown> | undefined;
      if (msg) {
        const blocks = parseContentBlocks(msg.content);
        if (blocks.length > 0) {
          const { thinking, tools } = collectStreamState();
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: blocks,
            timestamp: Date.now(),
            thinking,
            tools,
          }]);
        }
      }
      resetStreamState();
    } else if (payload.state === 'error') {
      setError(payload.errorMessage ?? 'Unknown error');
      resetStreamState();
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
                output: data.phase === 'result'
                  ? (data.result != null ? String(data.result) : t.output ?? '')
                  : (data.partialResult ?? t.output),
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
          output: data.partialResult ?? (data.phase === 'result' && data.result != null ? String(data.result) : undefined),
          phase: data.phase,
          startedAt: Date.now(),
          skillHint: inferSkill(data.name, data.args),
        },
      ];
    });
  }, [inferSkill]);

  // Handle agent.thinking events
  const handleThinkingEvent = useCallback((data: { text?: string; delta?: string }) => {
    if (data.text != null) {
      setStreamThinking(data.text);
    } else if (data.delta != null) {
      setStreamThinking((prev) => (prev ?? '') + data.delta);
    }
  }, []);

  // Handle events
  const handleEvent = useCallback(
    (evt: GatewayEventFrame) => {
      if (evt.event === 'chat') {
        handleChatRun(evt.payload as ChatRunPayload);
      } else if (evt.event === 'agent') {
        const p = evt.payload as { stream?: string; data?: unknown } | undefined;
        if (p?.stream === 'tool' && p?.data) {
          handleToolEvent(p.data as ToolEventData);
        } else if (p?.stream === 'thinking' && p?.data) {
          handleThinkingEvent(p.data as { text?: string; delta?: string });
        }
      }
    },
    [handleChatRun, handleToolEvent, handleThinkingEvent],
  );

  // Connect to gateway
  useEffect(() => {
    if (!config) return;

    const client = new GatewayClient({
      url: config.wsUrl,
      password: config.password || undefined,
      token: config.token || undefined,
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
    let stale = false;

    const loadHistory = async () => {
      setLoading(true);
      try {
        // Fetch history and turn cache in parallel
        const [histRes, turnsCache] = await Promise.all([
          clientRef.current!.request<{
            messages?: unknown[];
            thinkingLevel?: string;
          }>('chat.history', { sessionKey, limit: 200 }),
          loadTurnsFromServer(sessionKey),
        ]);
        if (stale) return;
        const msgs = Array.isArray(histRes.messages) ? histRes.messages : [];
        const cacheEntries = Object.entries(turnsCache).sort(([a], [b]) => Number(a) - Number(b));

        // ── Match cache entries to history messages by content similarity ──
        const matchMap = new Map<number, typeof turnsCache[string]>();
        const usedCacheKeys = new Set<string>();

        for (let i = 0; i < msgs.length; i++) {
          const msg = msgs[i] as Record<string, unknown>;
          if (msg.role !== 'assistant') continue;
          const msgText = extractText(parseContentBlocks(msg.content));
          if (!msgText) continue;

          let bestKey = '';
          let bestScore = 0;
          for (const [key, val] of cacheEntries) {
            if (usedCacheKeys.has(key) || !val.cleanText) continue;
            const clean = val.cleanText;
            let score = 0;
            if (msgText.includes(clean)) score = clean.length;
            else if (clean.includes(msgText)) score = msgText.length;
            else {
              // Prefix comparison for partial matches
              const prefix = clean.slice(0, 100);
              if (msgText.includes(prefix)) score = prefix.length;
            }
            if (score > bestScore) { bestScore = score; bestKey = key; }
          }
          if (bestKey && bestScore >= 30) {
            matchMap.set(i, turnsCache[bestKey]);
            usedCacheKeys.add(bestKey);
          }
        }

        // ── Build filtered message list ──
        const builtMessages: ChatMessage[] = [];
        let skipToolOutput = false;

        for (let idx = 0; idx < msgs.length; idx++) {
          const msg = msgs[idx] as Record<string, unknown>;
          const role = ((msg.role as string) ?? 'assistant') as ChatMessage['role'];
          const content = msg.content as ContentBlock[] | string;
          const ts = msg.timestamp as number | undefined;
          const usage = msg.usage as { input?: number; output?: number; input_tokens?: number; output_tokens?: number } | undefined;
          const cached = matchMap.get(idx);

          // Skip internal message types (toolResult, tool, system)
          if (role === 'toolResult' as string || role === 'tool' || role === 'system') continue;

          // User message resets skip state
          if (role === 'user') skipToolOutput = false;

          // Skip assistant messages with raw toolCall/tool_use content
          if (!cached && Array.isArray(content)) {
            const hasToolCall = (content as Array<Record<string, unknown>>).some((b) => b.type === 'tool_use' || b.type === 'toolCall');
            if (hasToolCall) continue;
          }

          // Skip raw assistant messages following a cached turn with tools
          if (skipToolOutput && role === 'assistant' && !cached) continue;

          skipToolOutput = !!(cached?.tools?.length);

          // Build display content
          let displayContent: ContentBlock[] | string;
          if (cached?.cleanText) {
            displayContent = [{ type: 'text' as const, text: cached.cleanText }];
          } else if (role === 'user') {
            // Strip "System: [...]" log lines prepended by Gateway
            const stripSystemLines = (text: string) => text.replace(/^(System:\s*\[.*?\].*\n?)+/gm, '').trim();
            if (typeof content === 'string') {
              displayContent = stripSystemLines(content) || content;
            } else if (Array.isArray(content)) {
              displayContent = (content as ContentBlock[])
                .map((b) => {
                  if (b && typeof b === 'object' && 'type' in b && b.type === 'text' && typeof (b as { text: string }).text === 'string') {
                    return { ...b, text: stripSystemLines((b as { text: string }).text) } as ContentBlock;
                  }
                  return b;
                })
                .filter((b) => !(b && typeof b === 'object' && 'type' in b && b.type === 'text' && !(b as { text: string }).text));
            } else {
              displayContent = content;
            }
          } else {
            displayContent = content;
          }

          builtMessages.push({
            role,
            content: displayContent,
            timestamp: ts,
            model: cached?.model || (msg.model as string | undefined),
            usage: cached?.usage || (usage ? { input_tokens: usage.input_tokens ?? usage.input, output_tokens: usage.output_tokens ?? usage.output } : undefined),
            tools: cached?.tools?.length ? cached.tools : undefined,
            thinking: cached?.thinking,
          });
        }
        setMessages(builtMessages);
      } catch (err) {
        if (!stale) setError(String(err));
      } finally {
        if (!stale) setLoading(false);
      }
    };

    loadHistory();
    return () => { stale = true; };
  }, [connected, sessionKey, loadTurnsFromServer]);

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
      setStreamThinking(null);
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
        // Mark the last user message as failed
        setMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === 'user') {
              copy[i] = { ...copy[i], sendFailed: true };
              break;
            }
          }
          return copy;
        });
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
    setStreamThinking(null);
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

  // Retry: remove last assistant message, resend the last user message
  const retryLastMessage = useCallback(async () => {
    if (!clientRef.current || !connected) return;
    // Find the last user message
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const lastUserMsg = messages[lastUserIdx];
    const userText = typeof lastUserMsg.content === 'string'
      ? lastUserMsg.content
      : lastUserMsg.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join('');
    if (!userText.trim()) return;

    // Remove messages from lastUserIdx onwards (the user msg + assistant reply)
    setMessages((prev) => prev.slice(0, lastUserIdx));
    setSending(true);
    setError(null);
    setStream(null);
    setStreamTools([]);

    // Re-add user message
    setMessages((prev) => [...prev, { ...lastUserMsg, timestamp: Date.now() }]);

    try {
      await clientRef.current.request('chat.send', {
        sessionKey,
        message: userText,
        deliver: false,
        idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
    } catch (err) {
      setError(String(err));
      setSending(false);
      setMessages((prev) => {
        const copy = [...prev];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === 'user') {
            copy[i] = { ...copy[i], sendFailed: true };
            break;
          }
        }
        return copy;
      });
    }
  }, [connected, sessionKey, messages]);

  // Resend a failed message by index
  const resendMessage = useCallback(async (msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg || msg.role !== 'user' || !msg.sendFailed) return;
    if (!clientRef.current || !connected) return;

    const userText = typeof msg.content === 'string'
      ? msg.content
      : msg.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join('');
    if (!userText.trim()) return;

    // Clear failed flag
    setMessages((prev) => prev.map((m, i) => i === msgIndex ? { ...m, sendFailed: false } : m));
    setSending(true);
    setError(null);
    setStream(null);
    setStreamTools([]);

    try {
      await clientRef.current.request('chat.send', {
        sessionKey,
        message: userText,
        deliver: false,
        idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
    } catch (err) {
      setError(String(err));
      setSending(false);
      setMessages((prev) => prev.map((m, i) => i === msgIndex ? { ...m, sendFailed: true } : m));
    }
  }, [connected, sessionKey, messages]);

  // Switch to an existing session by key
  const switchSession = useCallback((key: string) => {
    localStorage.setItem('oc-session-key', key);
    setSessionKey(key);
    setMessages([]);
    setStream(null);
    setStreamThinking(null);
    setStreamTools([]);
    setRunId(null);
    setError(null);
  }, []);

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
    setStreamThinking(null);
    setStreamTools([]);
    setRunId(null);
    setError(null);
  }, [connected, sessionKey]);

  return {
    connected,
    hello,
    messages,
    stream,
    streamThinking,
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
    switchSession,
    retryLastMessage,
    resendMessage,
    setError,
    client: clientRef,
  };
}
