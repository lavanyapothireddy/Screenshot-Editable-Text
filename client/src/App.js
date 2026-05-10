import React, { useState, useRef, useCallback } from "react";
import "./App.css";

const API_BASE = process.env.REACT_APP_API_URL || "";

const MODES = [
  { id: "full", label: "Full Extract", icon: "◈", desc: "Raw text as-is" },
  { id: "structured", label: "Structured", icon: "⊞", desc: "Markdown formatted" },
  { id: "code", label: "Code / Tech", icon: "⌨", desc: "Preserves code blocks" },
];

export default function App() {
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [extractedText, setExtractedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("full");
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [stats, setStats] = useState(null);

  const fileInputRef = useRef(null);
  const textAreaRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file (PNG, JPG, WEBP, GIF).");
      return;
    }
    setImage(file);
    setError("");
    setExtractedText("");
    setStats(null);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target.result);
    reader.readAsDataURL(file);
  }, []);

  const onFileChange = (e) => handleFile(e.target.files[0]);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      handleFile(e.dataTransfer.files[0]);
    },
    [handleFile]
  );

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  // ✅ Paste handler lives ONLY on the drop zone, not the whole app
  // This way pasting text inside the textarea works normally
  const handleDropZonePaste = useCallback(
    (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          handleFile(item.getAsFile());
          break;
        }
      }
    },
    [handleFile]
  );

  const extract = async () => {
    if (!image) return;
    setLoading(true);
    setError("");
    setExtractedText("");
    setStats(null);

    const formData = new FormData();
    formData.append("image", image);
    formData.append("mode", mode);

    try {
      const res = await fetch(`${API_BASE}/api/extract`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed.");
      setExtractedText(data.text);
      setStats({
        chars: data.text.length,
        words: data.text.trim().split(/\s+/).filter(Boolean).length,
        lines: data.text.split("\n").length,
        model: data.model,
      });
      // Auto-focus textarea so user can immediately edit
      setTimeout(() => textAreaRef.current?.focus(), 150);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Update stats live as user edits
  const handleTextChange = (e) => {
    const val = e.target.value;
    setExtractedText(val);
    setStats((prev) =>
      prev ? {
        ...prev,
        chars: val.length,
        words: val.trim().split(/\s+/).filter(Boolean).length,
        lines: val.split("\n").length,
      } : null
    );
  };

  const copyText = () => {
    if (!extractedText) return;
    navigator.clipboard.writeText(extractedText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const downloadText = () => {
    if (!extractedText) return;
    const blob = new Blob([extractedText], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "extracted-text.txt";
    a.click();
  };

  const clearAll = () => {
    setImage(null);
    setImagePreview(null);
    setExtractedText("");
    setError("");
    setStats(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">◎</span>
            <span className="logo-text">
              <span className="logo-main">SnapText</span>
              <span className="logo-sub">Screenshot → Editable Text</span>
            </span>
          </div>
          <div className="header-badge">Powered by Groq AI</div>
        </div>
      </header>

      <main className="main">
        <section className="mode-section">
          <p className="section-label">Extraction Mode</p>
          <div className="mode-tabs">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`mode-tab ${mode === m.id ? "active" : ""}`}
                onClick={() => setMode(m.id)}
              >
                <span className="mode-icon">{m.icon}</span>
                <span className="mode-label">{m.label}</span>
                <span className="mode-desc">{m.desc}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="panels">
          {/* Left: Upload */}
          <div className="panel upload-panel">
            <div className="panel-header">
              <span className="panel-title">Input Image</span>
              {image && (
                <button className="clear-btn" onClick={clearAll}>✕ Clear</button>
              )}
            </div>

            {/* onPaste ONLY here — not on root div */}
            <div
              className={`drop-zone ${dragOver ? "drag-over" : ""} ${imagePreview ? "has-image" : ""}`}
              onClick={() => !imagePreview && fileInputRef.current?.click()}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onPaste={handleDropZonePaste}
              tabIndex={0}
            >
              {imagePreview ? (
                <img src={imagePreview} alt="Uploaded" className="preview-img" />
              ) : (
                <div className="drop-placeholder">
                  <div className="drop-icon">⬆</div>
                  <p className="drop-title">Drop your screenshot here</p>
                  <p className="drop-hint">or click to browse · paste image with Ctrl+V</p>
                  <p className="drop-types">PNG · JPG · WEBP · GIF · up to 10MB</p>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onFileChange}
              style={{ display: "none" }}
            />

            {imagePreview && (
              <button className="change-btn" onClick={() => fileInputRef.current?.click()}>
                Change Image
              </button>
            )}

            {error && <div className="error-box">⚠ {error}</div>}

            <button
              className={`extract-btn ${loading ? "loading" : ""}`}
              onClick={extract}
              disabled={!image || loading}
            >
              {loading ? (
                <><span className="spinner" />Extracting...</>
              ) : (
                <>◈ Extract Text</>
              )}
            </button>
          </div>

          {/* Right: Output — textarea only, nothing covering it */}
          <div className="panel output-panel">
            <div className="panel-header">
              <span className="panel-title">
                Extracted Text
                {extractedText && <span className="editable-hint"> · freely editable</span>}
              </span>
              {extractedText && (
                <div className="output-actions">
                  <button className="action-btn" onClick={copyText}>
                    {copied ? "✓ Copied!" : "⎘ Copy"}
                  </button>
                  <button className="action-btn" onClick={downloadText}>
                    ↓ Download
                  </button>
                </div>
              )}
            </div>

            {stats && (
              <div className="stats-bar">
                <span>{stats.words} words</span>
                <span>{stats.chars} chars</span>
                <span>{stats.lines} lines</span>
                <span className="model-tag">{stats.model}</span>
              </div>
            )}

            {/* ✅ Clean textarea — no overlapping divs, no position:absolute children */}
            <textarea
              ref={textAreaRef}
              className="output-textarea"
              value={extractedText}
              onChange={handleTextChange}
              placeholder={
                loading
                  ? "⏳ Extracting text from your image..."
                  : "Extracted text appears here.\nClick anywhere in this box to edit it!"
              }
            />
          </div>
        </div>
      </main>

      <footer className="footer">
        <p>SnapText · Screenshot → Editable Text · Built with Groq AI + Llama 4</p>
      </footer>
    </div>
  );
}
