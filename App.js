/* ===========================
   Screenshot → Editable Text
   app.js  —  vanilla JS, no build required
=========================== */

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_HIST   = 5;

/* ── DOM ── */
const apiKeyEl    = document.getElementById('apiKey');
const eyeBtn      = document.getElementById('eyeBtn');
const eyeIcon     = document.getElementById('eyeIcon');
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
   API KEY — show / hide toggle
════════════════════════════════ */
eyeBtn.addEventListener('click', () => {
  const isPassword = apiKeyEl.type === 'password';
  apiKeyEl.type    = isPassword ? 'text' : 'password';
  eyeIcon.className = isPassword ? 'ti ti-eye-off' : 'ti ti-eye';
});

/* ════════════════════════════════
   FILE LOADING
════════════════════════════════ */
function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('⚠ Please upload an image file');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast('⚠ File too large — max 20 MB');
    return;
  }

  currentFile = file;

  /* preview */
  const url        = URL.createObjectURL(file);
  previewImg.src   = url;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  previewBox.style.display  = 'block';
  clearBtn.style.display    = 'inline-flex';
  extractBtn.disabled       = false;

  /* reset result */
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

/* file input click */
fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));

/* paste from clipboard */
pasteBtn.addEventListener('click', async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find(t => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        loadFile(new File([blob], 'pasted-image.png', { type: imageType }));
        return;
      }
    }
    toast('⚠ No image found in clipboard');
  } catch {
    toast('⚠ Clipboard access denied — paste manually');
  }
});

/* global paste shortcut Ctrl+V / Cmd+V */
document.addEventListener('paste', e => {
  const items = [...(e.clipboardData?.items || [])];
  const imgItem = items.find(i => i.type.startsWith('image/'));
  if (imgItem) loadFile(imgItem.getAsFile());
});

/* ── Clear ── */
clearBtn.addEventListener('click', () => {
  currentFile = null; rawText = '';
  fileInput.value      = '';
  previewImg.src       = '';
  previewBox.style.display  = 'none';
  clearBtn.style.display    = 'none';
  extractBtn.disabled       = true;
  resultCard.style.display  = 'none';
  outputArea.value          = '';
  dropZone.classList.remove('over');
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
   EXTRACT — call Groq API
════════════════════════════════ */
extractBtn.addEventListener('click', async () => {
  const apiKey = apiKeyEl.value.trim();
  if (!apiKey) { toast('⚠ Enter your Groq API key first'); return; }
  if (!currentFile) { toast('⚠ Upload a screenshot first'); return; }

  /* loading state */
  setLoading(true);

  try {
    const t0     = Date.now();
    const b64    = await toBase64(currentFile);
    const mime   = currentFile.type || 'image/jpeg';

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model:      GROQ_MODEL,
        max_tokens: 4096,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${b64}` }
            },
            {
              type: 'text',
              text: 'Extract ALL text visible in this image exactly as it appears. Preserve line breaks, spacing, and structure as much as possible. Return only the extracted text — no explanations, no preamble.'
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    rawText = data.choices?.[0]?.message?.content?.trim() || '';
    if (!rawText) throw new Error('Model returned no text');

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    /* show result */
    applyMode(currentMode);
    updateStats(outputArea.value, elapsed);
    resultCard.style.display = 'block';
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    /* save history */
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
    out = rawText
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  if (mode === 'markdown') {
    out = rawText.split('\n').map(line => {
      const l = line.trim();
      if (!l) return '';
      /* treat short ALL-CAPS or Title-Case short lines as headings */
      if (l.length < 60 && /^[A-Z]/.test(l) && !/[.;,]$/.test(l)) return `## ${l}`;
      return l;
    }).join('\n');
  }

  outputArea.value = out;
}

/* live edit updates stats */
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
  const a = document.createElement('a');
  a.href  = URL.createObjectURL(new Blob([content], { type }));
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
  if (!history.length) {
    historyCard.style.display = 'none';
    return;
  }
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
window.loadFromHistory = loadFromHistory; /* expose for inline onclick */

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
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1024*1024)  return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ════════════════════════════════
   INIT
════════════════════════════════ */
renderHistory();
