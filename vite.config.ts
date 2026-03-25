import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { WebSocket as WsWebSocket, WebSocketServer } from 'ws'
import type { ViteDevServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, 'uploads')

// Dev-only: WS proxy plugin so the browser can reach remote gateways
// without running into origin/CORS restrictions
function wsProxyPlugin() {
  return {
    name: 'ws-proxy',
    configureServer(server: ViteDevServer) {
      if (!server.httpServer) return

      const wss = new WebSocketServer({ noServer: true })

      server.httpServer.on('upgrade', (req, socket, head) => {
        // Only intercept /ws-proxy paths
        if (!req.url?.startsWith('/ws-proxy')) return

        const url = new URL(req.url, `http://${req.headers.host}`)
        const target = url.searchParams.get('target')
        if (!target) {
          socket.destroy()
          return
        }

        wss.handleUpgrade(req, socket, head, (clientWs) => {
          console.log(`[ws-proxy] -> ${target}`)
          // Set origin to the gateway's own address to pass origin checks
          const targetUrl = new URL(target.replace('ws://', 'http://').replace('wss://', 'https://'))
          const gatewayOrigin = `${targetUrl.protocol}//${targetUrl.host}`
          const gatewayWs = new WsWebSocket(target, {
            headers: {
              'User-Agent': 'OpenClaw-WebChat-Proxy/1.0',
              'Origin': gatewayOrigin,
            },
          })

          let ready = false
          const buf: string[] = []

          gatewayWs.on('open', () => {
            ready = true
            for (const m of buf) gatewayWs.send(m)
            buf.length = 0
          })

          gatewayWs.on('message', (data) => {
            if (clientWs.readyState === WsWebSocket.OPEN) {
              clientWs.send(data.toString())
            }
          })

          clientWs.on('message', (data) => {
            const msg = data.toString()
            if (ready && gatewayWs.readyState === WsWebSocket.OPEN) {
              gatewayWs.send(msg)
            } else {
              buf.push(msg)
            }
          })

          gatewayWs.on('close', (code, reason) => {
            if (clientWs.readyState === WsWebSocket.OPEN) clientWs.close(code, reason.toString())
          })
          gatewayWs.on('error', (err) => {
            console.error(`[ws-proxy] error:`, err.message)
            if (clientWs.readyState === WsWebSocket.OPEN) clientWs.close(4001, 'Gateway error')
          })
          clientWs.on('close', () => {
            if (gatewayWs.readyState === WsWebSocket.OPEN) gatewayWs.close()
          })
          clientWs.on('error', () => {
            if (gatewayWs.readyState === WsWebSocket.OPEN) gatewayWs.close()
          })
        })
      })
    },
  }
}

// Dev-only: file upload plugin
function uploadPlugin() {
  return {
    name: 'upload-api',
    configureServer(server: ViteDevServer) {
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true })
      }

      server.middlewares.use('/api/upload', (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          res.end()
          return
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const contentType = req.headers['content-type'] || ''
        const boundaryMatch = contentType.match(/boundary=(.+)/)
        if (!boundaryMatch) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing boundary' }))
          return
        }

        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks)
            const boundary = boundaryMatch[1]
            const boundaryBuf = Buffer.from(`--${boundary}`)
            const parts: Buffer[] = []

            let start = 0
            while (true) {
              const idx = buffer.indexOf(boundaryBuf, start)
              if (idx === -1) break
              if (start > 0) {
                let end = idx
                if (buffer[end - 1] === 0x0a) end--
                if (buffer[end - 1] === 0x0d) end--
                parts.push(buffer.subarray(start, end))
              }
              start = idx + boundaryBuf.length
              if (buffer[start] === 0x0d) start++
              if (buffer[start] === 0x0a) start++
              if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break
            }

            const results: Array<{ originalName: string; storedName: string; path: string; size: number; contentType: string }> = []
            for (const part of parts) {
              const sepIdx = part.indexOf('\r\n\r\n')
              if (sepIdx === -1) continue
              const headers = part.subarray(0, sepIdx).toString()
              const body = part.subarray(sepIdx + 4)
              const filenameMatch = headers.match(/filename="([^"]+)"/)
              const typeMatch = headers.match(/Content-Type:\s*(.+)/i)
              if (!filenameMatch) continue

              const timestamp = Date.now()
              const random = Math.random().toString(36).slice(2, 8)
              const safeName = filenameMatch[1].replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_')
              const storedName = `${timestamp}-${random}-${safeName}`
              const filePath = path.join(UPLOAD_DIR, storedName)
              fs.writeFileSync(filePath, body)
              const absolutePath = path.resolve(filePath)
              console.log(`[upload] Saved: ${filenameMatch[1]} -> ${absolutePath} (${body.length} bytes)`)
              results.push({
                originalName: filenameMatch[1],
                storedName,
                path: absolutePath,
                size: body.length,
                contentType: typeMatch?.[1]?.trim() || 'application/octet-stream',
              })
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, files: results }))
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: String(err) }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), wsProxyPlugin(), uploadPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5200,
  },
})
