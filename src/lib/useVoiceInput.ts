import { useState, useRef, useCallback } from 'react';
import { FunASRClient, type FunASRResult } from './funasr-client';

export type VoiceState = 'idle' | 'connecting' | 'recording' | 'stopping';

interface UseVoiceInputOptions {
  /** FunASR WebSocket URL (via proxy), e.g. /ws-asr */
  asrUrl: string;
  /**
   * Called whenever the display text changes.
   * `displayText` = all confirmed offline text + current online partial.
   */
  onDisplayUpdate: (displayText: string) => void;
  /** Called on error */
  onError?: (error: string) => void;
}

/**
 * Resamples Float32 audio from source sample rate to 16kHz and returns Int16 PCM.
 */
function resampleTo16kPCM(float32: Float32Array, sourceSampleRate: number): ArrayBuffer {
  const ratio = sourceSampleRate / 16000;
  const outLength = Math.floor(float32.length / ratio);
  const result = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcIndex = Math.floor(i * ratio);
    const s = Math.max(-1, Math.min(1, float32[srcIndex]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  return result.buffer;
}

export function useVoiceInput({ asrUrl, onDisplayUpdate, onError }: UseVoiceInputOptions) {
  const [state, setState] = useState<VoiceState>('idle');
  const clientRef = useRef<FunASRClient | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // 2pass text accumulation:
  // offlineText: confirmed corrected text (accumulated across utterances)
  // onlineText: current streaming partial (replaced each time, cleared on offline)
  // baseText: text in the input box before voice session started
  const offlineTextRef = useRef('');
  const onlineTextRef = useRef('');
  const baseTextRef = useRef('');

  const stop = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (contextRef.current) {
      contextRef.current.close();
      contextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (clientRef.current) {
      setState('stopping');
      clientRef.current.close();
      clientRef.current = null;
    }

    setTimeout(() => setState('idle'), 1200);
  }, []);

  const start = useCallback(async (baseText: string) => {
    if (state !== 'idle') return;

    setState('connecting');

    // Reset buffers
    offlineTextRef.current = '';
    onlineTextRef.current = '';
    baseTextRef.current = baseText;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: { ideal: 16000 },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}${asrUrl}`;

      const client = new FunASRClient(
        { url: wsUrl, mode: '2pass' },
        {
          onResult: (result: FunASRResult) => {
            if (!result.text) return;

            if (result.mode === '2pass-offline') {
              // Offline: corrected final text, replaces all accumulated online text
              onlineTextRef.current = '';
              offlineTextRef.current += result.text;
            } else {
              // Online: accumulate streaming results
              onlineTextRef.current += result.text;
            }

            // Display = base + confirmed offline + current online accumulation
            const display = baseTextRef.current + offlineTextRef.current + onlineTextRef.current;
            onDisplayUpdate(display);
          },
          onError: (err) => {
            onError?.(err.message);
            stop();
          },
          onClose: () => {
            // noop - cleanup handled by stop()
          },
          onOpen: () => {
            setState('recording');
          },
        },
      );
      clientRef.current = client;

      await client.connect();

      const audioContext = new AudioContext({ sampleRate: 16000 });
      contextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!clientRef.current?.connected) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBuffer = resampleTo16kPCM(inputData, audioContext.sampleRate);
        clientRef.current.sendAudio(pcmBuffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      const message = err instanceof DOMException && err.name === 'NotAllowedError'
        ? '麦克风权限被拒绝，请在浏览器设置中允许使用麦克风'
        : `语音连接失败：${(err as Error).message}`;
      onError?.(message);
      setState('idle');
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }
  }, [state, asrUrl, onDisplayUpdate, onError, stop]);

  const toggle = useCallback((currentText: string) => {
    if (state === 'idle') {
      start(currentText);
    } else if (state === 'recording') {
      stop();
    }
  }, [state, start, stop]);

  return { state, start, stop, toggle };
}
