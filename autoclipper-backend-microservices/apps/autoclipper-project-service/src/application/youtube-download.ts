import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_TRANSCRIPTION_MAX_SECONDS } from '@autoclipper/api-contracts';

export const YOUTUBE_SOURCE_MAX_BYTES = 100 * 1024 * 1024;
let activeDownloads = 0;

/** Only canonical video IDs reach the extractor. No shell, browser cookies, user config or playlists. */
export function youtubeDownloadArgs(videoId: string, directory: string, maxBytes: number) {
  if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId)) throw new Error('YOUTUBE_VIDEO_ID_INVALID');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > YOUTUBE_SOURCE_MAX_BYTES) throw new Error('YOUTUBE_DOWNLOAD_LIMIT_INVALID');
  return ['--ignore-config', '--no-playlist', '--no-cache-dir', '--no-progress', '--no-warnings',
    '--js-runtimes', 'node', '--socket-timeout', '15', '--retries', '1', '--fragment-retries', '1',
    '--max-filesize', String(maxBytes), '--match-filters', `!is_live & duration <= ${LOCAL_TRANSCRIPTION_MAX_SECONDS}`,
    '--format', `b[ext=mp4][filesize<=${maxBytes}]/b[ext=mp4][filesize_approx<=${maxBytes}]/b[ext=mp4][height<=360]/bv[ext=mp4][height<=360]+ba[ext=m4a]`, '--merge-output-format', 'mp4',
    '--output', join(directory, 'source.%(ext)s'), '--', `https://www.youtube.com/watch?v=${videoId}`];
}

export async function downloadYoutubeVideo(videoId: string, { maxBytes = YOUTUBE_SOURCE_MAX_BYTES } = {}) {
  if (activeDownloads >= 2) throw new Error('YOUTUBE_IMPORT_BUSY');
  activeDownloads++;
  let directory = '';
  let released = false;
  const release = () => { if (!released) { released = true; activeDownloads--; } };
  try {
    directory = await mkdtemp(join(tmpdir(), 'autoclipper-youtube-'));
    const args = youtubeDownloadArgs(videoId, directory, maxBytes);
    await new Promise<void>((resolve, reject) => {
      const child = spawn('yt-dlp', args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
        env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '' } });
      let failure = 'YOUTUBE_DOWNLOAD_FAILED';
      const stop=()=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{child.kill('SIGKILL');}};
      // Never return extractor stderr: it may contain signed URLs and private provider details.
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (/sign in|private video|members.only|not available|removed|age.restricted/iu.test(text)) failure = 'YOUTUBE_VIDEO_UNAVAILABLE';
        if (/max.filesize|larger than|too large/iu.test(text)) failure = 'YOUTUBE_DOWNLOAD_TOO_LARGE';
        if (/does not pass filter|duration.*(greater|longer|exceeds)/iu.test(text)) failure = 'LOCAL_TRANSCRIPTION_DURATION_LIMIT';
      });
      const deadline = setTimeout(() => { failure = 'YOUTUBE_DOWNLOAD_TIMEOUT'; stop(); }, 300_000);
      // Also bound downloads with missing/inaccurate Content-Length and fragmented media.
      const monitor = setInterval(() => {
        void readdir(directory).then(files => Promise.all(files.map(file => stat(join(directory, file))))).then(files => {
          if (files.reduce((total, file) => total + file.size, 0) > maxBytes * 2) {
            failure = 'YOUTUBE_DOWNLOAD_TOO_LARGE'; stop();
          }
        }).catch(() => undefined);
      }, 500);
      child.once('error', error => reject(new Error('code' in error && error.code === 'ENOENT' ? 'YOUTUBE_DOWNLOADER_NOT_CONFIGURED' : failure)));
      child.once('close', code => { clearTimeout(deadline); clearInterval(monitor); if (code === 0) resolve(); else reject(new Error(failure)); });
    });
    const path = join(directory, 'source.mp4');
    const file = await stat(path).catch(() => { throw new Error('YOUTUBE_VIDEO_UNAVAILABLE'); });
    if (file.size > maxBytes) throw new Error('YOUTUBE_DOWNLOAD_TOO_LARGE');
    if (file.size < 12) throw new Error('YOUTUBE_INVALID_MEDIA');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return { path, bytes: file.size, sha256: hash.digest('hex'), contentType: 'video/mp4' as const,
      cleanup: async () => { try { await rm(directory, { recursive: true, force: true }); } finally { release(); } } };
  } catch (error) {
    try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { release(); }
    throw error;
  }
}
