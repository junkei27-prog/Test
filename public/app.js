(() => {
  const form = document.getElementById('analyze-form');
  const urlInput = document.getElementById('url-input');
  const analyzeBtn = document.getElementById('analyze-btn');
  const statusMsg = document.getElementById('status-msg');
  const resultCard = document.getElementById('result-card');

  const thumbImg = document.getElementById('result-thumb');
  const badgeEl = document.getElementById('result-badge');
  const uploaderEl = document.getElementById('result-uploader');
  const statsEl = document.getElementById('result-stats');
  const titleEl = document.getElementById('result-title');

  const btnDownloadVideo = document.getElementById('btn-download-video');
  const btnDownloadImages = document.getElementById('btn-download-images');
  const btnThumbnail = document.getElementById('btn-thumbnail');
  const btnScript = document.getElementById('btn-script');
  const btnOcr = document.getElementById('btn-ocr');

  const extractPanel = document.getElementById('extract-panel');
  const extractTitle = document.getElementById('extract-title');
  const extractBody = document.getElementById('extract-body');
  const extractCopy = document.getElementById('extract-copy');
  const extractDownload = document.getElementById('extract-download');
  const extractClose = document.getElementById('extract-close');

  let currentUrl = '';
  let currentInfo = null;

  function setStatus(text, isError = false) {
    if (!text) {
      statusMsg.hidden = true;
      return;
    }
    statusMsg.hidden = false;
    statusMsg.textContent = text;
    statusMsg.classList.toggle('error', isError);
  }

  function statLine() {
    const parts = [];
    if (currentInfo.viewCount) parts.push(`👁 조회 ${currentInfo.viewCount}`);
    if (currentInfo.likeCount) parts.push(`❤ 좋아요 ${currentInfo.likeCount}`);
    if (currentInfo.commentCount) parts.push(`💬 댓글 ${currentInfo.commentCount}`);
    if (currentInfo.uploadDate) parts.push(`🗓 ${currentInfo.uploadDate}`);
    if (currentInfo.duration) parts.push(`⏱ ${currentInfo.duration}`);
    if (currentInfo.imageCount) parts.push(`🖼 이미지 ${currentInfo.imageCount}장`);
    return parts;
  }

  function render(info) {
    currentInfo = info;
    thumbImg.src = info.thumbnail || '';
    badgeEl.textContent = info.badge || '';
    uploaderEl.textContent = info.uploader ? `@${String(info.uploader).replace(/^@/, '')}` : '';
    titleEl.textContent = info.title || '';

    statsEl.innerHTML = '';
    statLine().forEach((text) => {
      const span = document.createElement('span');
      span.textContent = text;
      statsEl.appendChild(span);
    });

    btnDownloadVideo.hidden = !info.hasVideo;
    btnDownloadImages.hidden = info.type !== 'image_carousel';
    btnScript.disabled = !info.hasVideo;
    btnScript.title = info.hasVideo ? '' : '영상 콘텐츠에서만 지원됩니다.';

    extractPanel.hidden = true;
    resultCard.hidden = false;
  }

  async function analyze(url) {
    setStatus('분석 중입니다...');
    resultCard.hidden = true;
    analyzeBtn.disabled = true;
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '분석에 실패했습니다.');
      currentUrl = url;
      render(data);
      setStatus('');
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      analyzeBtn.disabled = false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;
    analyze(url);
  });

  function triggerDownload(path) {
    const params = new URLSearchParams({ url: currentUrl, title: currentInfo.title || '' });
    window.location.href = `${path}?${params.toString()}`;
  }

  btnDownloadVideo.addEventListener('click', () => triggerDownload('/api/download'));
  btnDownloadImages.addEventListener('click', () => triggerDownload('/api/images'));
  btnThumbnail.addEventListener('click', () => triggerDownload('/api/thumbnail'));

  function openExtractPanel(title) {
    extractPanel.hidden = false;
    extractTitle.textContent = title;
    extractBody.textContent = '추출 중입니다. 잠시만 기다려 주세요...';
  }

  async function runExtract({ endpoint, title, button }) {
    openExtractPanel(title);
    button.disabled = true;
    try {
      const res = await fetch(`${endpoint}?url=${encodeURIComponent(currentUrl)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '추출에 실패했습니다.');
      extractBody.textContent = data.text || '(추출된 텍스트가 없습니다.)';
    } catch (err) {
      extractBody.textContent = `⚠ ${err.message}`;
    } finally {
      button.disabled = false;
    }
  }

  btnScript.addEventListener('click', () =>
    runExtract({ endpoint: '/api/script', title: '📄 스크립트 (자막)', button: btnScript })
  );
  btnOcr.addEventListener('click', () =>
    runExtract({ endpoint: '/api/ocr', title: '🔤 화면 글자 추출', button: btnOcr })
  );

  extractClose.addEventListener('click', () => {
    extractPanel.hidden = true;
  });

  extractCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(extractBody.textContent);
      extractCopy.textContent = '복사됨!';
      setTimeout(() => (extractCopy.textContent = '복사'), 1200);
    } catch (err) {
      extractCopy.textContent = '복사 실패';
    }
  });

  extractDownload.addEventListener('click', () => {
    const blob = new Blob([extractBody.textContent], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(currentInfo && currentInfo.title) || 'extract'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  });
})();
