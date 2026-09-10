const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const { createWorker } = require('tesseract.js');

const OCR_LANGS = 'eng+kor';

/** Samples frames from a video at a fixed interval (capped at maxFrames), returns file paths. */
function extractFrames(videoPath, destDir, { intervalSec = 3, maxFrames = 12 } = {}) {
  fs.mkdirSync(destDir, { recursive: true });
  const pattern = path.join(destDir, 'frame-%03d.jpg');
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      [
        '-y',
        '-i', videoPath,
        '-vf', `fps=1/${intervalSec}`,
        '-frames:v', String(maxFrames),
        '-q:v', '3',
        pattern,
      ],
      { maxBuffer: 1024 * 1024 * 32 },
      (error) => {
        if (error) {
          reject(new Error('영상 프레임 추출에 실패했습니다: ' + error.message));
          return;
        }
        const files = fs
          .readdirSync(destDir)
          .filter((f) => f.startsWith('frame-'))
          .sort()
          .map((f) => path.join(destDir, f));
        resolve(files);
      }
    );
  });
}

function dedupeLines(lines) {
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length < 2) continue;
    const key = line.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/** Runs OCR over a list of image files and returns merged, de-duplicated text. */
async function recognizeImages(filePaths, onProgress) {
  if (!filePaths.length) return '';
  const worker = await createWorker(OCR_LANGS);
  const allLines = [];
  try {
    for (let i = 0; i < filePaths.length; i += 1) {
      const { data } = await worker.recognize(filePaths[i]);
      allLines.push(...data.text.split(/\r?\n/));
      if (onProgress) onProgress(i + 1, filePaths.length);
    }
  } finally {
    await worker.terminate();
  }
  return dedupeLines(allLines).join('\n');
}

/** Full pipeline: video file -> sampled frames -> OCR -> merged text. Cleans up frame files. */
async function recognizeVideo(videoPath, workDir, opts) {
  const framesDir = path.join(workDir, 'frames');
  const frames = await extractFrames(videoPath, framesDir, opts);
  try {
    if (!frames.length) return '';
    return await recognizeImages(frames);
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

module.exports = { extractFrames, recognizeImages, recognizeVideo };
