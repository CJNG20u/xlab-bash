import type { Request, Response, Router } from 'express';
import express from 'express';
import path from 'path';
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import { getHostWithSecrets } from './db.ts';
import { formatSha256Fingerprint } from './sshManager.ts';

/*
 * SFTP file browser for saved hosts.
 *
 * Only hosts whose key fingerprint was already accepted in a terminal session
 * are allowed, so file transfers never trust an unknown or changed host key.
 * Each request opens its own short SSH connection (no long-lived state).
 */

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface SftpHandle {
  sftp: SFTPWrapper;
  close: () => void;
}

function openSftp(hostId: string): Promise<SftpHandle> {
  const saved = getHostWithSecrets(hostId);
  if (!saved) return Promise.reject(new HttpError(404, 'Host not found.'));

  const { summary } = saved;
  const trusted = summary.hostFingerprint;
  if (!trusted) {
    return Promise.reject(
      new HttpError(409, 'Open a terminal to this host once and accept its key before browsing files.')
    );
  }
  if (summary.authType === 'password' && !saved.password) {
    return Promise.reject(new HttpError(500, 'Saved password could not be decrypted.'));
  }
  if (summary.authType === 'key' && !saved.privateKey) {
    return Promise.reject(new HttpError(500, 'Saved private key could not be decrypted.'));
  }

  return new Promise((resolve, reject) => {
    const client = new Client();
    let keyMismatch = false;
    let settled = false;
    const close = () => {
      try {
        client.end();
      } catch {
        // ignore
      }
    };

    const config: ConnectConfig = {
      host: summary.host,
      port: summary.port,
      username: summary.username,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
      hostVerifier: (keyBlob: Buffer) => {
        const ok = formatSha256Fingerprint(keyBlob) === trusted;
        if (!ok) keyMismatch = true;
        return ok;
      },
    };
    if (summary.authType === 'key') {
      config.privateKey = saved.privateKey!;
      if (saved.passphrase) config.passphrase = saved.passphrase;
    } else {
      config.password = saved.password!;
      config.tryKeyboard = true;
      client.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
        finish(prompts.map(() => saved.password || ''));
      });
    }

    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) {
          settled = true;
          close();
          reject(new HttpError(502, `SFTP is not available on this host: ${err.message}`));
          return;
        }
        settled = true;
        resolve({ sftp, close });
      });
    });

    client.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (keyMismatch) {
        reject(
          new HttpError(
            409,
            'Host key changed since you trusted it. Open a terminal to review the new key first.'
          )
        );
      } else if ((err as Error & { level?: string }).level === 'client-authentication') {
        reject(new HttpError(401, 'SSH authentication failed for this host.'));
      } else {
        reject(new HttpError(502, err.message || 'SSH connection failed.'));
      }
    });

    client.connect(config);
  });
}

function remotePath(raw: unknown): string {
  const p = typeof raw === 'string' && raw.trim() ? raw.trim() : '.';
  if (p.length > 4096 || p.includes('\0')) throw new HttpError(400, 'Invalid path.');
  return p;
}

function safeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || name === '.' || name === '..' || name.length > 255 || /[\/\0]/.test(name)) {
    throw new HttpError(400, 'Invalid file name.');
  }
  return name;
}

const p = <T>(fn: (cb: (err: Error | null | undefined, val?: T) => void) => void) =>
  new Promise<T>((resolve, reject) => fn((err, val) => (err ? reject(err) : resolve(val as T))));

function sftpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const e = err as { code?: number; message?: string };
  // SFTP status codes: 2 = no such file, 3 = permission denied, 4 = failure
  if (e.code === 2) return new HttpError(404, 'No such file or folder.');
  if (e.code === 3) return new HttpError(403, 'Permission denied.');
  return new HttpError(500, e.message || 'SFTP operation failed.');
}

async function withSftp<T>(req: Request, res: Response, fn: (sftp: SFTPWrapper) => Promise<T>) {
  let handle: SftpHandle | null = null;
  try {
    handle = await openSftp(String(req.params.id));
    const result = await fn(handle.sftp);
    res.json(result);
  } catch (err) {
    const e = sftpError(err);
    res.status(e.status).json({ error: e.message });
  } finally {
    handle?.close();
  }
}

export interface RemoteEntry {
  name: string;
  type: 'dir' | 'file' | 'link' | 'other';
  size: number;
  mtime: number;
  mode: number;
}

function typeFromMode(mode: number): RemoteEntry['type'] {
  const fmt = mode & 0o170000;
  if (fmt === 0o040000) return 'dir';
  if (fmt === 0o100000) return 'file';
  if (fmt === 0o120000) return 'link';
  return 'other';
}

export function createSftpRouter(): Router {
  const router = express.Router({ mergeParams: true });

  // List a folder (defaults to the login user's home)
  router.get('/', (req, res) =>
    withSftp(req, res, async (sftp) => {
      const dir = await p<string>((cb) => sftp.realpath(remotePath(req.query.path), cb));
      const list = await p<{ filename: string; attrs: { mode: number; size: number; mtime: number } }[]>(
        (cb) => sftp.readdir(dir, cb as never)
      );
      const entries: RemoteEntry[] = await Promise.all(
        list
          .filter((e) => e.filename !== '.' && e.filename !== '..')
          .map(async (e) => {
            let type = typeFromMode(e.attrs.mode);
            // Follow symlinks so linked folders open like folders
            if (type === 'link') {
              try {
                const target = await p<{ mode: number }>((cb) =>
                  sftp.stat(path.posix.join(dir, e.filename), cb as never)
                );
                if (typeFromMode(target.mode) === 'dir') type = 'dir';
              } catch {
                // broken link: keep as link
              }
            }
            return {
              name: e.filename,
              type,
              size: e.attrs.size,
              mtime: e.attrs.mtime * 1000,
              mode: e.attrs.mode & 0o7777,
            };
          })
      );
      entries.sort((a, b) =>
        a.type === 'dir' && b.type !== 'dir'
          ? -1
          : b.type === 'dir' && a.type !== 'dir'
          ? 1
          : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      );
      return { path: dir, parent: dir === '/' ? null : path.posix.dirname(dir), entries };
    })
  );

  // Download a file (streamed)
  router.get('/download', async (req, res) => {
    let handle: SftpHandle | null = null;
    try {
      const file = remotePath(req.query.path);
      handle = await openSftp(String(req.params.id));
      const sftp = handle.sftp;
      const stats = await p<{ mode: number; size: number }>((cb) => sftp.stat(file, cb as never));
      if (typeFromMode(stats.mode) !== 'file') throw new HttpError(400, 'Only files can be downloaded.');

      const name = path.posix.basename(file);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(stats.size));
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${name.replace(/["\\\r\n]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`
      );
      res.setHeader('Cache-Control', 'no-store');

      const h = handle;
      handle = null; // closed by the stream handlers below
      const stream = sftp.createReadStream(file);
      const done = () => h.close();
      stream.on('error', () => {
        res.destroy();
        done();
      });
      stream.on('close', done);
      res.on('close', () => {
        stream.destroy();
        done();
      });
      stream.pipe(res);
    } catch (err) {
      const e = sftpError(err);
      if (!res.headersSent) res.status(e.status).json({ error: e.message });
      handle?.close();
    }
  });

  // Upload a file: raw request body is streamed into <dir>/<name>
  router.put('/upload', async (req, res) => {
    let handle: SftpHandle | null = null;
    try {
      const dir = remotePath(req.query.dir);
      const name = safeName(req.query.name);
      const target = path.posix.join(dir, name);
      handle = await openSftp(String(req.params.id));
      const sftp = handle.sftp;

      if (req.query.overwrite !== '1') {
        const exists = await p((cb) => sftp.stat(target, cb as never)).then(
          () => true,
          () => false
        );
        if (exists) throw new HttpError(409, `${name} already exists.`);
      }

      await new Promise<void>((resolve, reject) => {
        const out = sftp.createWriteStream(target);
        out.on('error', reject);
        out.on('close', () => resolve());
        req.on('aborted', () => {
          out.destroy();
          reject(new HttpError(499, 'Upload cancelled.'));
        });
        req.pipe(out);
      });
      res.status(201).json({ ok: true, path: target });
    } catch (err) {
      const e = sftpError(err);
      if (!res.headersSent) res.status(e.status).json({ error: e.message });
    } finally {
      handle?.close();
    }
  });

  router.post('/mkdir', (req, res) =>
    withSftp(req, res, async (sftp) => {
      const dir = remotePath(req.body?.dir);
      const target = path.posix.join(dir, safeName(req.body?.name));
      await p((cb) => sftp.mkdir(target, cb as never));
      return { ok: true, path: target };
    })
  );

  router.post('/rename', (req, res) =>
    withSftp(req, res, async (sftp) => {
      const from = remotePath(req.body?.path);
      const to = path.posix.join(path.posix.dirname(from), safeName(req.body?.name));
      await p((cb) => sftp.rename(from, to, cb as never));
      return { ok: true, path: to };
    })
  );

  // Delete a file or an EMPTY folder (no recursive deletes from the phone)
  router.post('/delete', (req, res) =>
    withSftp(req, res, async (sftp) => {
      const target = remotePath(req.body?.path);
      if (target === '/' || target === '.') throw new HttpError(400, 'Refusing to delete that path.');
      const stats = await p<{ mode: number }>((cb) => sftp.lstat(target, cb as never));
      if (typeFromMode(stats.mode) === 'dir') {
        await p((cb) => sftp.rmdir(target, cb as never)).catch((err) => {
          const e = sftpError(err);
          throw e.status === 500 ? new HttpError(409, 'Folder is not empty.') : e;
        });
      } else {
        await p((cb) => sftp.unlink(target, cb as never));
      }
      return { ok: true };
    })
  );

  return router;
}
