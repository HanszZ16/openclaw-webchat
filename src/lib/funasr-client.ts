/**
 * FunASR WebSocket client for real-time speech recognition (2pass mode).
 *
 * Protocol reference:
 *   https://github.com/modelscope/FunASR/blob/main/runtime/docs/SDK_advanced_guide_online_zh.md
 *
 * Flow:
 *   1. Connect WebSocket
 *   2. Send first chunk with JSON config (chunk_size, mode, etc.)
 *   3. Stream PCM audio chunks
 *   4. Send {"is_speaking": false} to signal end
 *   5. Receive partial/final results via onResult callback
 */

export type FunASRMode = 'online' | 'offline' | '2pass';

export interface FunASRConfig {
  /** WebSocket URL, e.g. ws://localhost:10096 */
  url: string;
  mode?: FunASRMode;
  /** Chunk size in ms for streaming, default [5, 10, 5] */
  chunkSize?: number[];
  /** Hot words JSON string, e.g. '{"阿里巴巴": 20}' */
  hotwords?: string;
  /** Whether to enable ITN (inverse text normalization), default true */
  itn?: boolean;
}

export interface FunASRResult {
  /** Recognized text */
  text: string;
  /** Whether this is a final result for the current utterance */
  isFinal: boolean;
  /** Recognition mode that produced this result */
  mode: string;
  /** Timestamp info if available */
  timestamp?: string;
  /** Raw server message */
  raw: unknown;
}

export interface FunASRCallbacks {
  onResult: (result: FunASRResult) => void;
  onError: (error: Error) => void;
  onClose: () => void;
  onOpen?: () => void;
}

export class FunASRClient {
  private ws: WebSocket | null = null;
  private isFirstChunk = true;
  private config: Required<Pick<FunASRConfig, 'url' | 'mode' | 'chunkSize' | 'itn'>> & FunASRConfig;
  private callbacks: FunASRCallbacks;
  private _connected = false;

  constructor(config: FunASRConfig, callbacks: FunASRCallbacks) {
    this.config = {
      mode: '2pass',
      chunkSize: [5, 10, 5],
      itn: true,
      ...config,
    };
    this.callbacks = callbacks;
  }

  get connected() {
    return this._connected;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          this._connected = true;
          this.isFirstChunk = true;
          this.callbacks.onOpen?.();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            // FunASR server sends: { text, mode, is_final, timestamp, ... }
            const result: FunASRResult = {
              text: msg.text || '',
              isFinal: msg.is_final === true || msg.is_final === 'true',
              mode: msg.mode || '',
              timestamp: msg.timestamp,
              raw: msg,
            };
            this.callbacks.onResult(result);
          } catch {
            // Non-JSON message, ignore
          }
        };

        this.ws.onerror = (event) => {
          const err = new Error('FunASR WebSocket error' + ((event as ErrorEvent).message ? `: ${(event as ErrorEvent).message}` : ''));
          this.callbacks.onError(err);
          reject(err);
        };

        this.ws.onclose = () => {
          this._connected = false;
          this.callbacks.onClose();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Send an audio chunk (PCM 16-bit 16kHz).
   * The first chunk triggers sending the config header.
   */
  sendAudio(pcmData: ArrayBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (this.isFirstChunk) {
      // Send JSON config first
      const config: Record<string, unknown> = {
        mode: this.config.mode,
        chunk_size: this.config.chunkSize,
        wav_name: 'webchat-mic',
        is_speaking: true,
        wav_format: 'pcm',
        audio_fs: 16000,
        itn: this.config.itn,
      };
      if (this.config.hotwords) {
        config.hotwords = this.config.hotwords;
      }
      this.ws.send(JSON.stringify(config));
      this.isFirstChunk = false;
    }

    this.ws.send(pcmData);
  }

  /**
   * Signal end of speech. Server will return final results.
   */
  finishSpeaking() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ is_speaking: false }));
  }

  /**
   * Close the WebSocket connection.
   */
  close() {
    if (this.ws) {
      this.finishSpeaking();
      // Give server a moment to send final results before closing
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
        }
        this.ws = null;
      }, 1000);
    }
  }
}
