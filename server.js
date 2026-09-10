const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const archiver = require('archiver');

const ytdlp = require('./lib/ytdlp');
const gallerydl = require('./lib/gallerydl');
const ocr = require('./lib/ocr');
const { formatCount, formatDuration, formatDate, safeFilename } = require('./lib/format');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function makeTmpDir(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupOnFinish(res, dir) {
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }, () => {});
  res.on('finish', cleanup);
  res.on('close', cleanup);
}

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// --- Analyze -----------------------------------------------------------

app.post(
  '/api/analyze',
  asyncRoute(async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: '링크를 입력해 주세요.' });
    }

    const platform = ytdlp.detectPlatform(url);
    if (platform === 'unknown') {
      return res.status(400).json({ error: '유튜브 또는 인스타그램 링크만 지원합니다.' });
    }

    try {
      const info = await ytdlp.analyze(url);
      return res.json({
        source: 'yt-dlp',
        platform: info.platform,
        type: info.type,
        badge: info.badge,
        title: info.title,
        thumbnail: info.thumbnail,
        uploader: info.uploader,
        uploaderHandle: info.uploaderHandle,
        uploadDate: formatDate(info.uploadDate),
        duration: formatDuration(info.duration),
        viewCount: formatCount(info.viewCount),
        likeCount: formatCount(info.likeCount),
        commentCount: formatCount(info.commentCount),
        webpageUrl: info.webpageUrl || url,
        hasVideo: info.hasVideo,
        hasScript: info.hasAutoSubs || info.hasSubs,
      });
    } catch (err) {
      if (platform === 'instagram' && gallerydl.isAvailable()) {
        try {
          const items = await gallerydl.listImages(url);
          if (items.length) {
            const first = items[0].meta || {};
            return res.json({
              source: 'gallery-dl',
              platform: 'instagram',
              type: 'image_carousel',
              badge: items.length > 1 ? `카드뉴스 (이미지 ${items.length}장)` : '이미지 게시물',
              title: first.description || first.title || '(제목 없음)',
              thumbnail: items[0].imageUrl,
              uploader: first.username || first.owner_username || null,
              uploaderHandle: first.username || null,
              uploadDate: formatDate(first.date ? first.date.split('T')[0].replace(/-/g, '') : null),
              duration: null,
              viewCount: null,
              likeCount: formatCount(first.likes),
              commentCount: formatCount(first.comments),
              webpageUrl: url,
              hasVideo: false,
              hasScript: false,
              imageCount: items.length,
            });
          }
        } catch (galleryErr) {
          // fall through to original error below
        }
      }
      return res.status(422).json({
        error:
          platform === 'instagram'
            ? `분석에 실패했습니다. 비공개 계정이거나 로그인이 필요한 게시물일 수 있습니다. (${err.message})`
            : `분석에 실패했습니다. 링크를 확인해 주세요. (${err.message})`,
      });
    }
  })
);

// --- Video download ------------------------------------------------------

app.get(
  '/api/download',
  asyncRoute(async (req, res) => {
    const { url, title } = req.query;
    if (!url) return res.status(400).json({ error: '링크가 필요합니다.' });
    const dir = makeTmpDir('dl');
    cleanupOnFinish(res, dir);
    const filePath = await ytdlp.downloadVideo(String(url), dir);
    const filename = `${safeFilename(title, 'video')}${path.extname(filePath) || '.mp4'}`;
    res.download(filePath, filename);
  })
);

// --- Thumbnail download ---------------------------------------------------

app.get(
  '/api/thumbnail',
  asyncRoute(async (req, res) => {
    const { url, title } = req.query;
    if (!url) return res.status(400).json({ error: '링크가 필요합니다.' });
    const dir = makeTmpDir('thumb');
    cleanupOnFinish(res, dir);
    const filePath = await ytdlp.downloadThumbnail(String(url), dir);
    const filename = `${safeFilename(title, 'thumbnail')}${path.extname(filePath) || '.jpg'}`;
    res.download(filePath, filename);
  })
);

// --- Instagram image carousel (zip) --------------------------------------

app.get(
  '/api/images',
  asyncRoute(async (req, res) => {
    const { url, title } = req.query;
    if (!url) return res.status(400).json({ error: '링크가 필요합니다.' });
    if (!gallerydl.isAvailable()) {
      return res.status(501).json({
        error: '이미지 게시물 저장에는 gallery-dl이 필요합니다. "pip install gallery-dl" 로 설치해 주세요.',
      });
    }
    const dir = makeTmpDir('img');
    cleanupOnFinish(res, dir);
    const files = await gallerydl.downloadImages(String(url), dir);
    if (!files.length) return res.status(422).json({ error: '이미지를 찾을 수 없습니다.' });

    const filename = `${safeFilename(title, 'images')}.zip`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => res.status(500).end(String(err)));
    archive.pipe(res);
    files.forEach((f, i) => archive.file(f, { name: `image-${String(i + 1).padStart(2, '0')}${path.extname(f)}` }));
    await archive.finalize();
  })
);

// --- Script / transcript extraction ---------------------------------------

app.get(
  '/api/script',
  asyncRoute(async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: '링크가 필요합니다.' });
    const result = await ytdlp.extractScript(String(url));
    if (!result || !result.text) {
      return res.status(404).json({ error: '이 영상에서는 자막/스크립트를 찾을 수 없습니다.' });
    }
    res.json(result);
  })
);

// --- On-screen text (OCR) extraction ---------------------------------------

app.get(
  '/api/ocr',
  asyncRoute(async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: '링크가 필요합니다.' });
    const platform = ytdlp.detectPlatform(String(url));
    const dir = makeTmpDir('ocr');
    try {
      let info;
      try {
        info = await ytdlp.analyze(String(url));
      } catch (e) {
        info = { hasVideo: false };
      }

      if (info.hasVideo) {
        const videoPath = await ytdlp.downloadVideo(String(url), path.join(dir, 'src'));
        const text = await ocr.recognizeVideo(videoPath, dir, { intervalSec: 3, maxFrames: 12 });
        return res.json({ text, frameBased: true });
      }

      if (platform === 'instagram' && gallerydl.isAvailable()) {
        const files = await gallerydl.downloadImages(String(url), path.join(dir, 'imgs'));
        const text = await ocr.recognizeImages(files);
        return res.json({ text, frameBased: false });
      }

      return res.status(422).json({ error: '화면 글자를 추출할 콘텐츠를 찾을 수 없습니다.' });
    } finally {
      fs.rm(dir, { recursive: true, force: true }, () => {});
    }
  })
);

// --- Error handling ---------------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || '알 수 없는 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`유튜브 & 인스타 다운로더가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
