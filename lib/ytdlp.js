const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { which } = require('./which');

const COMMON_ARGS = [
  '--no-warnings',
  '--no-check-certificates',
  '--prefer-free-formats',
  '--add-header', 'referer:youtube.com',
  '--add-header', 'user-agent:Mozilla/5.0',
];

let resolvedRunner = null;

/** Resolves how to invoke yt-dlp: a system binary on PATH, the yt-dlp-exec bundled
 *  binary (if present), or the `python3 -m yt_dlp` module as a last resort. */
function resolveRunner() {
  if (resolvedRunner) return resolvedRunner;

  const systemBin = which('yt-dlp');
  if (systemBin) {
    resolvedRunner = { cmd: systemBin, baseArgs: [] };
    return resolvedRunner;
  }

  const bundled = path.join(__dirname, '..', 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp');
  if (fs.existsSync(bundled)) {
    resolvedRunner = { cmd: bundled, baseArgs: [] };
    return resolvedRunner;
  }

  const python = which('python3') || which('python');
  if (python) {
    resolvedRunner = { cmd: python, baseArgs: ['-m', 'yt_dlp'] };
    return resolvedRunner;
  }

  const err = new Error(
    'yt-dlp를 찾을 수 없습니다. "pip install yt-dlp" (또는 brew install yt-dlp) 로 설치한 뒤 다시 시도해 주세요.'
  );
  err.code = 'YT_DLP_MISSING';
  throw err;
}

function run(args, options = {}) {
  const { cmd, baseArgs } = resolveRunner();
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      [...baseArgs, ...args],
      { maxBuffer: 1024 * 1024 * 128, ...options },
      (error, stdout, stderr) => {
        if (error) {
          const e = new Error((stderr || error.message || '').trim() || 'yt-dlp 실행 중 오류가 발생했습니다.');
          e.cause = error;
          reject(e);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be' || host === 'm.youtube.com') {
      return 'youtube';
    }
    if (/(^|\.)instagram\.com$/.test(host)) {
      return 'instagram';
    }
    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

function makeTmpDir(prefix = 'ytx') {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Runs `yt-dlp -j <url>` and returns the parsed metadata JSON. */
async function fetchRawInfo(url) {
  const stdout = await run([...COMMON_ARGS, '-j', '--no-playlist', url]);
  const firstLine = stdout.split(/\r?\n/).find((l) => l.trim().startsWith('{'));
  if (!firstLine) throw new Error('영상 정보를 읽어올 수 없습니다.');
  return JSON.parse(firstLine);
}

function normalize(raw, platform) {
  const duration = typeof raw.duration === 'number' ? raw.duration : null;
  const hasVideo = Boolean(
    duration !== null &&
    (raw.ext === 'mp4' || raw.ext === 'webm' || (Array.isArray(raw.formats) && raw.formats.length > 0))
  );

  let badge = '영상';
  if (platform === 'instagram') {
    badge = /reel/i.test(raw.webpage_url || '') || duration ? '릴스 / 영상' : '게시물';
  } else if (platform === 'youtube') {
    badge = duration && duration <= 60 ? '쇼츠 / 영상' : '유튜브 영상';
  }

  return {
    platform,
    type: hasVideo ? 'video' : 'unknown',
    title: raw.title || raw.fulltitle || '(제목 없음)',
    thumbnail: raw.thumbnail || (Array.isArray(raw.thumbnails) && raw.thumbnails.length
      ? raw.thumbnails[raw.thumbnails.length - 1].url
      : null),
    uploader: raw.uploader || raw.channel || raw.uploader_id || null,
    uploaderHandle: raw.uploader_id || raw.channel_id || null,
    uploadDate: raw.upload_date || raw.release_date || null,
    duration,
    viewCount: typeof raw.view_count === 'number' ? raw.view_count : null,
    likeCount: typeof raw.like_count === 'number' ? raw.like_count : null,
    commentCount: typeof raw.comment_count === 'number' ? raw.comment_count : null,
    description: raw.description || null,
    webpageUrl: raw.webpage_url || null,
    badge,
    hasVideo,
    hasAutoSubs: Boolean(raw.automatic_captions && Object.keys(raw.automatic_captions).length),
    hasSubs: Boolean(raw.subtitles && Object.keys(raw.subtitles).length),
  };
}

async function analyze(url) {
  const platform = detectPlatform(url);
  if (platform === 'unknown') {
    const err = new Error('유튜브 또는 인스타그램 링크만 지원합니다.');
    err.code = 'UNSUPPORTED_PLATFORM';
    throw err;
  }
  const raw = await fetchRawInfo(url);
  const info = normalize(raw, platform);
  info._raw = raw;
  return info;
}

/** Downloads the best available mp4 (or best playable format) to destDir, returns the resulting file path. */
async function downloadVideo(url, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const outputTemplate = path.join(destDir, 'video.%(ext)s');
  await run([
    ...COMMON_ARGS,
    '--no-playlist',
    '-o', outputTemplate,
    '-f', 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
    '--merge-output-format', 'mp4',
    url,
  ]);
  const files = fs.readdirSync(destDir).filter((f) => f.startsWith('video.'));
  if (!files.length) throw new Error('다운로드된 영상 파일을 찾을 수 없습니다.');
  files.sort((a, b) => (a.endsWith('.mp4') ? -1 : 1));
  return path.join(destDir, files[0]);
}

/** Downloads the thumbnail image to destDir, returns the resulting file path. */
async function downloadThumbnail(url, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const outputTemplate = path.join(destDir, 'thumb.%(ext)s');
  await run([
    ...COMMON_ARGS,
    '--no-playlist',
    '-o', outputTemplate,
    '--skip-download',
    '--write-thumbnail',
    url,
  ]);
  const files = fs.readdirSync(destDir).filter((f) => f.startsWith('thumb.'));
  if (!files.length) throw new Error('썸네일을 찾을 수 없습니다.');
  return path.join(destDir, files[0]);
}

function vttToText(vttContent) {
  const lines = vttContent.split(/\r?\n/);
  const out = [];
  let prev = '';
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^WEBVTT/.test(line)) continue;
    if (/^\d+$/.test(line.trim())) continue;
    if (/-->/.test(line)) continue;
    if (/^(Kind|Language):/i.test(line)) continue;
    const cleaned = line
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .trim();
    if (!cleaned || cleaned === prev) continue;
    out.push(cleaned);
    prev = cleaned;
  }
  return out.join('\n');
}

/** Extracts a transcript/script for the video (auto captions preferred), returns { language, text } or null. */
async function extractScript(url) {
  const dir = makeTmpDir('sub');
  try {
    const outputTemplate = path.join(dir, 'sub');
    await run([
      ...COMMON_ARGS,
      '--no-playlist',
      '-o', outputTemplate,
      '--skip-download',
      '--write-auto-sub',
      '--write-sub',
      '--sub-lang', 'ko,ko-KR,en,en-US',
      '--sub-format', 'vtt',
      url,
    ]);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.vtt'));
    if (!files.length) return null;
    const preferred =
      files.find((f) => /\.ko/i.test(f)) || files.find((f) => /\.en/i.test(f)) || files[0];
    const content = fs.readFileSync(path.join(dir, preferred), 'utf8');
    return { language: preferred, text: vttToText(content) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = {
  detectPlatform,
  analyze,
  downloadVideo,
  downloadThumbnail,
  extractScript,
  makeTmpDir,
};
