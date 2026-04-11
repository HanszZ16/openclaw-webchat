// Alibaba Cloud OSS utility — zero external dependencies
// Uses native Node.js crypto + https modules
// Reads config from environment variables:
//   ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET
//   OSS_REGION (e.g. oss-cn-beijing.aliyuncs.com), OSS_BUCKET

import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';

const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || '';
const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || '';
const bucket = process.env.OSS_BUCKET || '';
const region = process.env.OSS_REGION || '';

/** Whether OSS is configured and available */
export const ossEnabled = !!(accessKeyId && accessKeySecret && bucket && region);

const hostname = ossEnabled ? `${bucket}.${region}` : '';
const useHttps = !region.startsWith('http://');

function hmacSha1(key, data) {
  return crypto.createHmac('sha1', key).update(data).digest('base64');
}

function sign(method, resource, headers) {
  const contentMd5 = headers['Content-MD5'] || '';
  const contentType = headers['Content-Type'] || '';
  const date = headers['Date'] || '';
  // Collect x-oss-* headers
  const ossHeaders = Object.entries(headers)
    .filter(([k]) => k.toLowerCase().startsWith('x-oss-'))
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([k, v]) => `${k.toLowerCase()}:${v}`)
    .join('\n');
  const canonicalHeaders = ossHeaders ? ossHeaders + '\n' : '';
  const stringToSign = `${method}\n${contentMd5}\n${contentType}\n${date}\n${canonicalHeaders}${resource}`;
  return hmacSha1(accessKeySecret, stringToSign);
}

function makeRequest(method, objectKey, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const resource = `/${bucket}/${objectKey}`;
    const headers = {
      Date: new Date().toUTCString(),
      Host: hostname,
      ...extraHeaders,
    };
    if (body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
    }

    const signature = sign(method, resource, headers);
    headers['Authorization'] = `OSS ${accessKeyId}:${signature}`;

    const transport = useHttps ? https : http;
    // Encode each path segment for non-ASCII chars, but keep '/' intact
    const encodedPath = '/' + objectKey.split('/').map((s) => encodeURIComponent(s)).join('/');
    const req = transport.request(
      { hostname, path: encodedPath, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Upload a file to OSS
 * @returns {{ url: string }} Public URL of the uploaded object
 */
export async function ossPut(objectKey, data, contentType = 'application/octet-stream') {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const res = await makeRequest('PUT', objectKey, buf, { 'Content-Type': contentType });
  if (res.status !== 200) {
    throw new Error(`OSS PUT failed (${res.status}): ${res.data.toString()}`);
  }
  const protocol = useHttps ? 'https' : 'http';
  return { url: `${protocol}://${hostname}/${objectKey}` };
}

/**
 * Download a file from OSS
 * @returns {Buffer} File contents
 */
export async function ossGet(objectKey) {
  const res = await makeRequest('GET', objectKey);
  if (res.status === 404) return null;
  if (res.status !== 200) {
    throw new Error(`OSS GET failed (${res.status}): ${res.data.toString()}`);
  }
  return res.data;
}

/**
 * Delete a file from OSS
 */
export async function ossDelete(objectKey) {
  const res = await makeRequest('DELETE', objectKey);
  if (res.status !== 204 && res.status !== 200) {
    throw new Error(`OSS DELETE failed (${res.status}): ${res.data.toString()}`);
  }
}

/**
 * List objects with a given prefix
 * @returns {string[]} Array of object keys
 */
export async function ossList(prefix, maxKeys = 1000) {
  // LIST is a GET on bucket root with query params — resource for signing is "/${bucket}/"
  return new Promise((resolve, reject) => {
    const resource = `/${bucket}/`;
    const queryPath = `/?prefix=${encodeURIComponent(prefix)}&max-keys=${maxKeys}`;
    const headers = { Date: new Date().toUTCString(), Host: hostname };
    const signature = sign('GET', resource, headers);
    headers['Authorization'] = `OSS ${accessKeyId}:${signature}`;

    const transport = useHttps ? https : http;
    const req = transport.request({ hostname, path: queryPath, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          reject(new Error(`OSS LIST failed (${res.statusCode}): ${data.toString()}`));
          return;
        }
        const xml = data.toString();
        const keys = [];
        const regex = /<Key>([^<]+)<\/Key>/g;
        let match;
        while ((match = regex.exec(xml)) !== null) {
          keys.push(match[1]);
        }
        resolve(keys);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Delete all objects under a prefix (batch cleanup)
 */
export async function ossDeletePrefix(prefix) {
  const keys = await ossList(prefix);
  for (const key of keys) {
    await ossDelete(key);
  }
}

/**
 * Generate a pre-signed URL for temporary download access
 * @param {string} objectKey
 * @param {number} expireSeconds - URL validity in seconds (default 3600)
 * @returns {string} Signed URL
 */
export function ossSignUrl(objectKey, expireSeconds = 3600) {
  const expires = Math.floor(Date.now() / 1000) + expireSeconds;
  const resource = `/${bucket}/${objectKey}`;
  const stringToSign = `GET\n\n\n${expires}\n${resource}`;
  const signature = hmacSha1(accessKeySecret, stringToSign);
  const protocol = useHttps ? 'https' : 'http';
  return `${protocol}://${hostname}/${objectKey}?OSSAccessKeyId=${encodeURIComponent(accessKeyId)}&Expires=${expires}&Signature=${encodeURIComponent(signature)}`;
}

/**
 * Check if an object exists
 */
export async function ossExists(objectKey) {
  const res = await makeRequest('HEAD', objectKey);
  return res.status === 200;
}
