/* ===========================
   Screenshot → Editable Text
   app.js  —  calls /api/extract (server proxy)
   No API key needed in the browser!
=========================== */

const MAX_HIST = 5;

/* ── DOM ── */
const dropZone    = document.getElementById('dropZone');
const fileInput   = document.getElementById('fileInput');
const previewBox  = document.getElementById('previewBox');
const previewImg  = document.getElementById('previewImg');
const fileNameEl  = document.getElementById('fileName');
const fileSizeEl  = document.getElementById('fileSize');
const extractBtn  = document.getElementById('extractBtn');
const btnLabel    = document.getElementById('btnLabel');
const spinner     = document.getElementById('spinner');
const clearBtn    = document.getElementById('clearBtn');
const pasteBtn    = document.getElementById('pasteBtn');
const resultCard  = document.getElementById('resultCard');
const outputArea  = document.getElementById('outputArea');
const copyBtn     = document.getElementById('copyBtn');
const dlTxt       = document.getElementById('dlTxt');
const dlMd        = document.getElementById('dlMd');
const statChars   = document.getElementById('statChars');
const statWords   = document.getElementById('statWords');
const statLines   = document.getElementById('statLines');
const statTime    = document.getElementById('statTime');
const historyCard = document.getElementById('historyCard');
const historyList = document.getElementById('historyList');
const clearHistBtn= document.getElementById('clearHistoryBtn');
const toastEl     = document.getElementById('toast');

/* ── State ── */
let currentFile = null;
let rawText     = '';
let currentMode = 'raw';
let history     = JSON.parse(localStorage.getItem('ocr_history') || '[]');

/* ════════════════════════════════
   TOAST
════════════════════════════════ */
let toastTimer;
function toast(msg, duration = 2400) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

/* ════════════════════════════════
   FILE LOADING
════════════════════════════════ */
function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('⚠ Please upload an image file'); return; }
  if (file.size > 20 * 1024 * 1024)   { toast('⚠ File too large — max 20 MB');  return; }

  currentFile = file;

  const url = URL.createObjectURL(file);
  previewImg.src         = url;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  previewBox.style.display  = 'block';
  clearBtn.style.display    = 'inline-flex';
  extractBtn.disabled       = false;

  resultCard.style.display = 'none';
  rawText = '';
  outputArea.value = '';
}

/* drag & drop */
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('over');
  loadFile(e.dataTransfer.files[0]);
});

/* click to browse */
fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));

/* paste button */
pasteBtn.addEventListener('click', async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imgType = item.types.find(t => t.startsWith('image/'));
      if (imgType) {
        const blob = await item.getType(imgType);
        loadFile(new File([blob], 'pasted-image.png', { type: imgType }));
        return;
      }
    }
    toast('⚠ No image found in clipboard');
  } catch {
    toast('⚠ Clipboard access denied — try Ctrl+V on the page');
  }
});

/* global Ctrl+V / Cmd+V */
document.addEventListener('paste', e => {
  const items   = [...(e.clipboardData?.items || [])];
  const imgItem = items.find(i => i.type.startsWith('image/'));
  if (imgItem) loadFile(imgItem.getAsFile());
});

/* clear */
clearBtn.addEventListener('click', () => {
  currentFile = null; rawText = ''; fileInput.value = '';
  previewImg.src            = '';
  previewBox.style.display  = 'none';
  clearBtn.style.display    = 'none';
  extractBtn.disabled       = true;
  resultCard.style.display  = 'none';
  outputArea.value          = '';
});

/* ════════════════════════════════
   BASE64 HELPER
════════════════════════════════ */
function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* ════════════════════════════════
   EXTRACT — POST to /api/extract
   (server adds the Groq API key)
════════════════════════════════ */
extractBtn.addEventListener('click', async () => {
  if (!currentFile) { toast('⚠ Upload a screenshot first'); return; }

  setLoading(true);

  try {
    const t0         = Date.now();
    const imageBase64 = await toBase64(currentFile);
    const mimeType    = currentFile.type || 'image/jpeg';

    const response = await fetch('/api/extract', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ imageBase64, mimeType })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Server error ${response.status}`);
    }

    rawText = data.text || '';
    if (!rawText) throw new Error('No text returned from model');

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    applyMode(currentMode);
    updateStats(outputArea.value, elapsed);
    resultCard.style.display = 'block';
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    saveHistory(rawText);
    toast(`✓ Done in ${elapsed}s`);

  } catch (err) {
    toast(`Error: ${err.message}`, 4500);
  } finally {
    setLoading(false);
  }
});

/* ════════════════════════════════
   MODE TABS
════════════════════════════════ */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
    applyMode(currentMode);
    updateStats(outputArea.value);
  });
});

function applyMode(mode) {
  if (!rawText) return;
  let out = rawText;

  if (mode === 'clean') {
    out = rawText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (mode === 'markdown') {
    out = rawText.split('\n').map(line => {
      const l = line.trim();
      if (!l) return '';
      if (l.length < 60 && /^[A-Z]/.test(l) && !/[.;,]$/.test(l)) return `## ${l}`;
      return l;
    }).join('\n');
  }

  outputArea.value = out;
}

outputArea.addEventListener('input', () => updateStats(outputArea.value));

/* ════════════════════════════════
   STATS
════════════════════════════════ */
function updateStats(text, elapsed) {
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text.trim() ? text.trim().split('\n').length : 0;
  statChars.innerHTML = `<i class="ti ti-letter-case"></i> ${chars.toLocaleString()} chars`;
  statWords.innerHTML = `<i class="ti ti-blockquote"></i> ${words.toLocaleString()} words`;
  statLines.innerHTML = `<i class="ti ti-list"></i> ${lines.toLocaleString()} lines`;
  if (elapsed) statTime.innerHTML = `<i class="ti ti-clock"></i> ${elapsed}s`;
}

/* ════════════════════════════════
   COPY & DOWNLOAD
════════════════════════════════ */
copyBtn.addEventListener('click', () => {
  if (!outputArea.value) { toast('Nothing to copy'); return; }
  navigator.clipboard.writeText(outputArea.value)
    .then(() => toast('✓ Copied to clipboard'))
    .catch(() => toast('⚠ Copy failed'));
});

dlTxt.addEventListener('click', () => download(outputArea.value, 'extracted_text.txt', 'text/plain'));
dlMd.addEventListener('click',  () => download(outputArea.value, 'extracted_text.md',  'text/markdown'));

function download(content, filename, type) {
  if (!content) { toast('Nothing to download'); return; }
  const a  = document.createElement('a');
  a.href   = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  toast(`✓ Downloaded ${filename}`);
}

/* ════════════════════════════════
   HISTORY
════════════════════════════════ */
function saveHistory(text) {
  const entry = {
    id:      Date.now(),
    preview: text.slice(0, 80).replace(/\n/g, ' '),
    text,
    time:    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  history.unshift(entry);
  if (history.length > MAX_HIST) history = history.slice(0, MAX_HIST);
  localStorage.setItem('ocr_history', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  if (!history.length) { historyCard.style.display = 'none'; return; }
  historyCard.style.display = 'block';
  historyList.innerHTML = history.map(h => `
    <div class="h-item" onclick="loadFromHistory(${h.id})">
      <span class="h-preview">${escapeHtml(h.preview)}…</span>
      <span class="h-time">${h.time}</span>
    </div>
  `).join('');
}

function loadFromHistory(id) {
  const entry = history.find(h => h.id === id);
  if (!entry) return;
  rawText = entry.text;
  applyMode(currentMode);
  updateStats(outputArea.value);
  resultCard.style.display = 'block';
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('✓ Loaded from history');
}
window.loadFromHistory = loadFromHistory;

clearHistBtn.addEventListener('click', () => {
  history = [];
  localStorage.removeItem('ocr_history');
  renderHistory();
  toast('History cleared');
});

/* ════════════════════════════════
   LOADING STATE
════════════════════════════════ */
function setLoading(on) {
  extractBtn.disabled = on;
  spinner.classList.toggle('hidden', !on);
  btnLabel.textContent = on ? 'Extracting...' : 'Extract Text';
}

/* ════════════════════════════════
   HELPERS
════════════════════════════════ */
function formatBytes(bytes) {
  if (bytes < 1024)      return bytes + ' B';
  if (bytes < 1048576)   return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Init ── */
renderHistory();
