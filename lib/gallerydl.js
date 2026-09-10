const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { which } = require('./which');

function resolveBinary() {
  return which('gallery-dl');
}

function isAvailable() {
  return Boolean(resolveBinary());
}

function run(args, options = {}) {
  const bin = resolveBinary();
  if (!bin) {
    const err = new Error(
      '이미지 게시물(카드뉴스)을 저장하려면 gallery-dl이 필요합니다. "pip install gallery-dl" 로 설치해 주세요.'
    );
    err.code = 'GALLERY_DL_MISSING';
    throw err;
  }
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1024 * 1024 * 64, ...options }, (error, stdout, stderr) => {
      if (error) {
        const e = new Error(stderr || error.message);
        e.cause = error;
        reject(e);
        return;
      }
      resolve(stdout);
    });
  });
}

/** Returns metadata for each image in an Instagram post/carousel via `gallery-dl -j`. */
async function listImages(url) {
  const stdout = await run(['-j', url]);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    throw new Error('gallery-dl 응답을 해석할 수 없습니다.');
  }
  // gallery-dl -j output: array of [extractor_status, url, metadata]
  const items = parsed
    .filter((entry) => Array.isArray(entry) && entry.length >= 3 && typeof entry[1] === 'string')
    .map((entry) => ({ imageUrl: entry[1], meta: entry[2] || {} }));
  return items;
}

/** Downloads all images in a post/carousel to destDir, returns array of file paths. */
async function downloadImages(url, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  await run(['-D', destDir, '--no-mtime', url]);
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(jpg|jpeg|png|webp)$/i.test(name)) files.push(full);
    }
  };
  walk(destDir);
  return files;
}

module.exports = { isAvailable, listImages, downloadImages };
