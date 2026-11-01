/**
 * Minimal HTTP client for the notes plugin's local AI services (transcription, diarization).
 *
 * Node's built-in fetch can't be given a long idle timeout without an extra dependency, and a
 * transcription of a long recording can legitimately take a long time, so this uses node:http
 * directly and streams uploaded files from disk instead of buffering them.
 */

import fs from 'fs';
import http from 'http';
import https from 'https';
import crypto from 'crypto';

export interface HttpResult {
  status: number;
  body: string;
}

/** Idle-socket limit: a long recording on a busy GPU can take a while. */
export const SOCKET_TIMEOUT_MS = 3 * 60 * 60 * 1000;

export function request(
  url: URL,
  options: http.RequestOptions,
  send: (req: http.ClientRequest) => void,
  timeoutMessage = 'The request timed out',
): Promise<HttpResult> {
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, options, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(SOCKET_TIMEOUT_MS, () => req.destroy(new Error(timeoutMessage)));
    req.on('error', reject);
    send(req);
  });
}

/** POST form `fields` plus one file as multipart/form-data, streaming the file from disk. */
export async function postMultipartFile(
  url: URL,
  fields: [string, string][],
  file: { path: string; filename: string; mime: string; field?: string },
  extraHeaders: Record<string, string> = {},
  timeoutMessage?: string,
): Promise<HttpResult> {
  const boundary = `----wwwform${crypto.randomBytes(12).toString('hex')}`;
  const safeName = file.filename.replace(/["\r\n]/g, '_');
  const head = Buffer.from(
    fields.map(([k, val]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${val}\r\n`).join('')
      + `--${boundary}\r\nContent-Disposition: form-data; name="${file.field ?? 'file'}"; filename="${safeName}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const size = (await fs.promises.stat(file.path)).size;
  const headers: Record<string, string | number> = {
    ...extraHeaders,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': head.length + size + tail.length,
  };
  return request(url, { method: 'POST', headers }, (req) => {
    req.write(head);
    const stream = fs.createReadStream(file.path);
    stream.on('error', (err) => req.destroy(err));
    stream.on('end', () => req.end(tail));
    stream.pipe(req, { end: false });
  }, timeoutMessage);
}
