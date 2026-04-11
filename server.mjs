// Simple WebSocket proxy server for OpenClaw WebChat
// Solves the CORS/origin issue by proxying WS connections to the Gateway
// Usage: node server.mjs [port]

import './env.mjs'; // Load .env before anything else
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { WebSocket, WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { ossEnabled, ossPut, ossGet, ossDelete, ossList, ossDeletePrefix, ossSignUrl } from './oss.mjs';

const PORT = parseInt(process.argv[2] || '5200', 10);
const FUNASR_WS_URL = process.env.FUNASR_WS_URL || 'ws://127.0.0.1:10096';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const TURNS_DIR = path.join(__dirname, 'data', 'turns');
const MARKET_DIR = path.join(__dirname, 'data', 'skills', 'packages');
const MARKET_REGISTRY = path.join(__dirname, 'data', 'skills', 'registry.json');

// Ensure directories exist
for (const dir of [UPLOAD_DIR, TURNS_DIR, MARKET_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
// Ensure registry file exists
if (!fs.existsSync(MARKET_REGISTRY)) {
  fs.writeFileSync(MARKET_REGISTRY, JSON.stringify([], null, 2));
}

// MIME types for static files
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB

// Parse multipart form data (minimal implementation, no external deps)
function parseMultipart(buffer, boundary) {
  const files = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];

  // Split by boundary
  let start = 0;
  while (true) {
    const idx = buffer.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    if (start > 0) {
      // Remove trailing \r\n before boundary
      let end = idx;
      if (buffer[end - 1] === 0x0a) end--;
      if (buffer[end - 1] === 0x0d) end--;
      parts.push(buffer.subarray(start, end));
    }
    start = idx + boundaryBuf.length;
    // Skip \r\n after boundary
    if (buffer[start] === 0x0d) start++;
    if (buffer[start] === 0x0a) start++;
    // Check for -- (end marker)
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break;
  }

  for (const part of parts) {
    // Find header/body separator (\r\n\r\n)
    const sepIdx = part.indexOf('\r\n\r\n');
    if (sepIdx === -1) continue;

    const headers = part.subarray(0, sepIdx).toString();
    const body = part.subarray(sepIdx + 4);

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const typeMatch = headers.match(/Content-Type:\s*(.+)/i);

    if (filenameMatch) {
      files.push({
        fieldName: nameMatch?.[1] || 'file',
        fileName: filenameMatch[1],
        contentType: typeMatch?.[1]?.trim() || 'application/octet-stream',
        data: body,
      });
    }
  }

  return files;
}

// HTTP server: serve static files + file upload API
const server = http.createServer(async (req, res) => {
  // CORS headers for API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // === File Upload API ===
  if (req.method === 'POST' && req.url === '/api/upload') {
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Expected multipart/form-data' }));
      return;
    }

    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing boundary' }));
      return;
    }

    const chunks = [];
    let totalSize = 0;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_UPLOAD_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File too large (max 50MB)' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const files = parseMultipart(buffer, boundaryMatch[1]);

        if (files.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No file found in request' }));
          return;
        }

        const results = [];

        for (const file of files) {
          const timestamp = Date.now();
          const random = Math.random().toString(36).slice(2, 8);
          const safeName = file.fileName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
          const storedName = `${timestamp}-${random}-${safeName}`;

          if (ossEnabled) {
            // Upload to OSS, return signed URL (24h) for private bucket access
            const ossKey = `uploads/${storedName}`;
            await ossPut(ossKey, file.data, file.contentType);
            const signedUrl = ossSignUrl(ossKey, 86400);
            console.log(`[upload] OSS: ${file.fileName} -> ${ossKey} (${file.data.length} bytes)`);
            results.push({
              originalName: file.fileName,
              storedName,
              path: signedUrl,
              ossKey,
              size: file.data.length,
              contentType: file.contentType,
              storage: 'oss',
            });
          } else {
            // Fallback: save locally
            const filePath = path.join(UPLOAD_DIR, storedName);
            fs.writeFileSync(filePath, file.data);
            const absolutePath = path.resolve(filePath);
            console.log(`[upload] Local: ${file.fileName} -> ${absolutePath} (${file.data.length} bytes)`);
            results.push({
              originalName: file.fileName,
              storedName,
              path: absolutePath,
              size: file.data.length,
              contentType: file.contentType,
              storage: 'local',
            });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, files: results }));
      } catch (err) {
        console.error('[upload] Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upload failed: ' + err.message }));
      }
    });

    return;
  }

  // === List uploaded files ===
  if (req.method === 'GET' && req.url === '/api/uploads') {
    try {
      if (ossEnabled) {
        const keys = await ossList('uploads/');
        const files = keys.map((key) => ({ name: key.replace('uploads/', ''), key, storage: 'oss' }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ files, storage: 'oss' }));
      } else {
        const files = fs.readdirSync(UPLOAD_DIR).map((name) => {
          const stat = fs.statSync(path.join(UPLOAD_DIR, name));
          return { name, size: stat.size, createdAt: stat.birthtimeMs, storage: 'local' };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ files, storage: 'local' }));
      }
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files: [] }));
    }
    return;
  }

  // === Turn Cache API: persist tool/thinking data across refreshes ===
  if (req.method === 'POST' && req.url === '/api/turns') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const { sessionKey, timestamp, data } = body;
        if (!sessionKey || !timestamp || !data) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing sessionKey, timestamp, or data' }));
          return;
        }
        // Sanitize sessionKey for filesystem safety
        const safeSession = String(sessionKey).replace(/[^a-zA-Z0-9_\-]/g, '_');
        const sessionDir = path.join(TURNS_DIR, safeSession);
        if (!fs.existsSync(sessionDir)) {
          fs.mkdirSync(sessionDir, { recursive: true });
        }
        const filePath = path.join(sessionDir, `${timestamp}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data));
        // Cleanup: keep only last 200 turns per session
        const files = fs.readdirSync(sessionDir).sort();
        if (files.length > 200) {
          for (let i = 0; i < files.length - 200; i++) {
            fs.unlinkSync(path.join(sessionDir, files[i]));
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith('/api/turns')) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      const sessionKey = urlObj.searchParams.get('sessionKey');
      if (!sessionKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing sessionKey' }));
        return;
      }
      const safeSession = String(sessionKey).replace(/[^a-zA-Z0-9_\-]/g, '_');
      const sessionDir = path.join(TURNS_DIR, safeSession);
      const turns = {};
      if (fs.existsSync(sessionDir)) {
        for (const file of fs.readdirSync(sessionDir)) {
          if (!file.endsWith('.json')) continue;
          const ts = file.replace('.json', '');
          try {
            turns[ts] = JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf-8'));
          } catch { /* skip corrupted files */ }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ turns }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // === Skill Market API ===
  // Storage: OSS (skills/registry.json + skills/packages/<key>/...) with local fallback

  // --- Market helpers ---
  async function readRegistry() {
    if (ossEnabled) {
      const data = await ossGet('skills/registry.json');
      return data ? JSON.parse(data.toString()) : [];
    }
    try { return JSON.parse(fs.readFileSync(MARKET_REGISTRY, 'utf-8')); } catch { return []; }
  }
  async function writeRegistry(registry) {
    const json = JSON.stringify(registry, null, 2);
    if (ossEnabled) {
      await ossPut('skills/registry.json', json, 'application/json');
    } else {
      fs.writeFileSync(MARKET_REGISTRY, json);
    }
  }
  async function writeSkillFile(skillKey, filePath, content) {
    if (ossEnabled) {
      const ossKey = `skills/packages/${skillKey}/${filePath}`;
      await ossPut(ossKey, content, 'application/octet-stream');
    } else {
      const abs = path.join(MARKET_DIR, skillKey, ...filePath.split('/'));
      const dir = path.dirname(abs);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  async function readSkillFile(skillKey, filePath) {
    if (ossEnabled) {
      return await ossGet(`skills/packages/${skillKey}/${filePath}`);
    }
    const abs = path.join(MARKET_DIR, skillKey, ...filePath.split('/'));
    return fs.existsSync(abs) ? fs.readFileSync(abs) : null;
  }
  async function listSkillFiles(skillKey) {
    if (ossEnabled) {
      const prefix = `skills/packages/${skillKey}/`;
      const keys = await ossList(prefix);
      return keys.map((k) => k.slice(prefix.length)).filter((k) => k && k !== 'skill.json');
    }
    const skillDir = path.join(MARKET_DIR, skillKey);
    if (!fs.existsSync(skillDir)) return [];
    function walk(dir, prefix = '') {
      const result = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) result.push(...walk(path.join(dir, entry.name), rel));
        else if (entry.name !== 'skill.json') result.push(rel);
      }
      return result;
    }
    return walk(skillDir);
  }
  async function deleteSkillFiles(skillKey) {
    if (ossEnabled) {
      await ossDeletePrefix(`skills/packages/${skillKey}/`);
    } else {
      const skillDir = path.join(MARKET_DIR, skillKey);
      if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
    }
  }

  // List all skills in the marketplace
  if (req.method === 'GET' && req.url === '/api/market/skills') {
    try {
      const registry = await readRegistry();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ skills: registry, storage: ossEnabled ? 'oss' : 'local' }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ skills: [] }));
    }
    return;
  }

  // Upload a skill package
  if (req.method === 'POST' && req.url === '/api/market/upload') {
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          const meta = body.metadata;
          if (!meta || !meta.key || !meta.name) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'metadata must include key and name' }));
            return;
          }

          let registry = await readRegistry();
          const existingIdx = registry.findIndex((s) => s.key === meta.key);

          const skillMeta = {
            key: meta.key,
            name: meta.name,
            version: meta.version || '1.0.0',
            description: meta.description || '',
            author: meta.author || 'anonymous',
            emoji: meta.emoji || '',
            tags: meta.tags || [],
            homepage: meta.homepage || '',
            requiresAuth: meta.requiresAuth || false,
            createdAt: existingIdx >= 0 ? registry[existingIdx].createdAt : Date.now(),
            updatedAt: Date.now(),
          };

          // Write skill.json
          await writeSkillFile(meta.key, 'skill.json', JSON.stringify(skillMeta, null, 2));

          // Write optional files — supports nested paths
          if (body.files && typeof body.files === 'object') {
            for (const [filename, content] of Object.entries(body.files)) {
              if (typeof content !== 'string') continue;
              const segments = filename.split('/').filter(Boolean).map(
                (seg) => seg.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_')
              );
              if (segments.length === 0) continue;
              const safePath = segments.join('/');
              // Detect base64
              let buf;
              try {
                const decoded = Buffer.from(content, 'base64');
                buf = (decoded.toString('base64') === content && content.length > 0) ? decoded : Buffer.from(content, 'utf-8');
              } catch {
                buf = Buffer.from(content, 'utf-8');
              }
              await writeSkillFile(meta.key, safePath, buf);
            }
          }

          // Update registry
          if (existingIdx >= 0) {
            registry[existingIdx] = skillMeta;
          } else {
            registry.push(skillMeta);
          }
          await writeRegistry(registry);

          console.log(`[market] Uploaded skill: ${meta.key} (${meta.name}) [${ossEnabled ? 'oss' : 'local'}]`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, skill: skillMeta }));
        } catch (err) {
          console.error('[market] Upload error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Upload failed: ' + err.message }));
        }
      });
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Expected application/json' }));
    return;
  }

  // Get skill detail
  if (req.method === 'GET' && req.url?.match(/^\/api\/market\/skills\/([^/]+)$/)) {
    const key = decodeURIComponent(req.url.match(/^\/api\/market\/skills\/([^/]+)$/)[1]);
    try {
      const metaBuf = await readSkillFile(key, 'skill.json');
      if (!metaBuf) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Skill not found' }));
        return;
      }
      const meta = JSON.parse(metaBuf.toString());
      const files = await listSkillFiles(key);
      const readmeBuf = await readSkillFile(key, 'README.md');
      const readme = readmeBuf ? readmeBuf.toString() : '';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ skill: meta, files, readme }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Download a skill as .tar.gz
  if (req.method === 'GET' && req.url?.match(/^\/api\/market\/skills\/([^/]+)\/download$/)) {
    const key = decodeURIComponent(req.url.match(/^\/api\/market\/skills\/([^/]+)\/download$/)[1]);
    try {
      const metaBuf = await readSkillFile(key, 'skill.json');
      if (!metaBuf) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Skill not found' }));
        return;
      }

      // Collect all files (including skill.json)
      const fileList = await listSkillFiles(key);
      const allFiles = ['skill.json', ...fileList];

      // Build tar archive (POSIX ustar)
      const blocks = [];
      for (const rel of allFiles) {
        const data = await readSkillFile(key, rel);
        if (!data) continue;
        const tarPath = `${key}/${rel}`;

        const header = Buffer.alloc(512, 0);
        header.write(tarPath.length <= 100 ? tarPath : tarPath.slice(-100), 0, 100, 'utf-8');
        header.write('0000644\0', 100, 8, 'utf-8');
        header.write('0000000\0', 108, 8, 'utf-8');
        header.write('0000000\0', 116, 8, 'utf-8');
        header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf-8');
        const mtime = Math.floor(Date.now() / 1000);
        header.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'utf-8');
        header.write('        ', 148, 8, 'utf-8');
        header.write('0', 156, 1, 'utf-8');
        header.write('ustar\0', 257, 6, 'utf-8');
        header.write('00', 263, 2, 'utf-8');

        // Long filename support
        if (tarPath.length > 100) {
          const lh = Buffer.alloc(512, 0);
          lh.write('././@LongLink', 0, 100, 'utf-8');
          lh.write('0000644\0', 100, 8, 'utf-8');
          lh.write('0000000\0', 108, 8, 'utf-8');
          lh.write('0000000\0', 116, 8, 'utf-8');
          const nl = Buffer.byteLength(tarPath, 'utf-8') + 1;
          lh.write(nl.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf-8');
          lh.write('        ', 148, 8, 'utf-8');
          lh.write('L', 156, 1, 'utf-8');
          lh.write('ustar\0', 257, 6, 'utf-8');
          lh.write('00', 263, 2, 'utf-8');
          let ls = 0; for (let i = 0; i < 512; i++) ls += lh[i];
          lh.write(ls.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');
          blocks.push(lh);
          const nd = Buffer.alloc(Math.ceil(nl / 512) * 512, 0);
          nd.write(tarPath + '\0', 0, 'utf-8');
          blocks.push(nd);
        }

        let sum = 0; for (let i = 0; i < 512; i++) sum += header[i];
        header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');
        blocks.push(header);

        if (data.length > 0) {
          const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512, 0);
          data.copy(padded);
          blocks.push(padded);
        }
      }
      blocks.push(Buffer.alloc(1024, 0));

      const gzipped = zlib.gzipSync(Buffer.concat(blocks));
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${key}.tar.gz"`,
        'Content-Length': gzipped.length,
      });
      res.end(gzipped);
    } catch (err) {
      console.error('[market] Download error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Delete / uninstall a skill
  if (req.method === 'DELETE' && req.url?.match(/^\/api\/market\/skills\/([^/]+)$/)) {
    const key = decodeURIComponent(req.url.match(/^\/api\/market\/skills\/([^/]+)$/)[1]);

    try {
      let registry = await readRegistry();
      registry = registry.filter((s) => s.key !== key);
      await writeRegistry(registry);
      await deleteSkillFiles(key);

      console.log(`[market] Deleted skill: ${key} [${ossEnabled ? 'oss' : 'local'}]`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // === Serve static files from dist/ ===
  let filePath = path.join(DIST_DIR, req.url === '/' ? 'index.html' : req.url);

  // SPA fallback
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const mimeType = MIME[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

// WebSocket servers (noServer mode to avoid upgrade conflicts)
const wss = new WebSocketServer({ noServer: true });
const wssAsr = new WebSocketServer({ noServer: true });

// Route upgrade requests by pathname
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === '/ws-proxy') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/ws-asr') {
    wssAsr.handleUpgrade(req, socket, head, (ws) => wssAsr.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// Gateway WebSocket proxy
wss.on('connection', (clientWs, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const target = url.searchParams.get('target');

  if (!target) {
    clientWs.close(4000, 'Missing target parameter');
    return;
  }

  console.log(`[proxy] New connection -> ${target}`);

  // Connect to the actual Gateway, setting origin to gateway's own address
  const targetUrl = new URL(target.replace('ws://', 'http://').replace('wss://', 'https://'));
  const gatewayOrigin = `${targetUrl.protocol}//${targetUrl.host}`;
  const gatewayWs = new WebSocket(target, {
    headers: {
      'User-Agent': 'OpenClaw-WebChat-Proxy/1.0',
      'Origin': gatewayOrigin,
    },
  });

  let gatewayReady = false;
  const buffered = [];

  gatewayWs.on('open', () => {
    gatewayReady = true;
    // Flush buffered messages
    for (const msg of buffered) {
      gatewayWs.send(msg);
    }
    buffered.length = 0;
  });

  // Forward: Gateway -> Client
  gatewayWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data.toString());
    }
  });

  // Forward: Client -> Gateway
  clientWs.on('message', (data) => {
    const msg = data.toString();
    if (gatewayReady && gatewayWs.readyState === WebSocket.OPEN) {
      gatewayWs.send(msg);
    } else {
      buffered.push(msg);
    }
  });

  // Cleanup
  gatewayWs.on('close', (code, reason) => {
    console.log(`[proxy] Gateway closed: ${code} ${reason}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason.toString());
    }
  });

  gatewayWs.on('error', (err) => {
    console.error(`[proxy] Gateway error:`, err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(4001, 'Gateway connection failed');
    }
  });

  clientWs.on('close', () => {
    console.log(`[proxy] Client disconnected`);
    if (gatewayWs.readyState === WebSocket.OPEN) {
      gatewayWs.close();
    }
  });

  clientWs.on('error', () => {
    if (gatewayWs.readyState === WebSocket.OPEN) {
      gatewayWs.close();
    }
  });
});

// ASR WebSocket proxy: browser -> /ws-asr -> FunASR server
wssAsr.on('connection', (clientWs) => {
  console.log(`[asr-proxy] New ASR connection -> ${FUNASR_WS_URL}`);

  const asrWs = new WebSocket(FUNASR_WS_URL);
  asrWs.binaryType = 'nodebuffer';

  let asrReady = false;
  const buffered = [];

  asrWs.on('open', () => {
    asrReady = true;
    for (const msg of buffered) {
      asrWs.send(msg);
    }
    buffered.length = 0;
  });

  // Forward: FunASR -> Client (text results)
  asrWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data.toString());
    }
  });

  // Forward: Client -> FunASR (JSON config + PCM audio)
  clientWs.on('message', (data, isBinary) => {
    const msg = isBinary ? data : data.toString();
    if (asrReady && asrWs.readyState === WebSocket.OPEN) {
      asrWs.send(msg);
    } else {
      buffered.push(msg);
    }
  });

  // Cleanup
  asrWs.on('close', (code, reason) => {
    console.log(`[asr-proxy] FunASR closed: ${code} ${reason}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason.toString());
    }
  });

  asrWs.on('error', (err) => {
    console.error(`[asr-proxy] FunASR error:`, err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(4001, 'ASR connection failed');
    }
  });

  clientWs.on('close', () => {
    console.log(`[asr-proxy] Client disconnected`);
    if (asrWs.readyState === WebSocket.OPEN) {
      asrWs.close();
    }
  });

  clientWs.on('error', () => {
    if (asrWs.readyState === WebSocket.OPEN) {
      asrWs.close();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  OpenClaw WebChat Server`);
  console.log(`  ➜  Local:   http://localhost:${PORT}/`);
  console.log(`  ➜  Network: http://0.0.0.0:${PORT}/`);
  console.log(`  ➜  WS Proxy: ws://localhost:${PORT}/ws-proxy?target=<gateway-url>`);
  console.log(`  ➜  ASR Proxy: ws://localhost:${PORT}/ws-asr -> ${FUNASR_WS_URL}`);
  console.log(`  ➜  Upload:  POST http://localhost:${PORT}/api/upload`);
  console.log(`  ➜  Storage: ${ossEnabled ? `OSS (${process.env.OSS_BUCKET}.${process.env.OSS_REGION})` : `Local (${path.resolve(UPLOAD_DIR)})`}`);
  console.log(`  ➜  Market:  ${ossEnabled ? 'OSS skills/' : path.resolve(MARKET_DIR)}\n`);
});
