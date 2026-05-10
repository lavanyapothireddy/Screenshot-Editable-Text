import React, { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";

const MODES = [
  { id: "plain", label: "Plain Text", icon: "Aa", desc: "Raw text, no formatting" },
  { id: "markdown", label: "Markdown", icon: "M↓", desc: "Structured with headings & lists" },
  { id: "code", label: "Code", icon: "</>", desc: "Extract & detect language" },
];

function useTypewriter(text, speed = 8) {
  const [displayed, setDisplayed] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    setDisplayed("");
    if (!text) return;
    let i = 0;
    ref.current = setInterval(() => {
      if (i < text.length) {
        setDisplayed(text.slice(0, i + 1));
        i++;
      } else {
        clearInterval(ref.current);
      }
    }, speed);
    return () => clearInterval(ref.current);
  }, [text, speed]);

  return displayed;
}

export default function App() {
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [mode, setMode] = useState("plain");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [tokens, setTokens] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const textareaRef = useRef(null);
  const displayed = useTypewriter(result, 6);

  const handleFile = useCallback((file) => {
    if (!file) return;
    setImage(file);
    setResult("");
    setError("");
    setTokens(0);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target.result);
    reader.readAsDataURL(file);
  }, []);

  const onFileChange = (e) => handleFile(e.target.files[0]);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) handleFile(file);
    },
    [handleFile]
  );

  const onPaste = useCallback(
    (e) => {
      const items = Array.from(e.clipboardData.items);
      const imgItem = items.find((i) => i.type.startsWith("image/"));
      if (imgItem) handleFile(imgItem.getAsFile());
    },
    [handleFile]
  );

  useEffect(() => {
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onPaste]);

  const extract = async () => {
    if (!image) return;
    setLoading(true);
    setError("");
    setResult("");
    setTokens(0);

    const formData = new FormData();
    formData.append("image", image);
    formData.append("mode", mode);

    try {
      const res = await fetch("/api/extract", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      setResult(data.text);
      setTokens(data.tokens || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const clear = () => {
    setImage(null);
    setImagePreview(null);
    setResult("");
    setError("");
    setTokens(0);
    if (fileRef.current) fileRef.current.value = "";
  };

  const downloadTxt = () => {
    if (!result) return;
    const blob = new Blob([result], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `extracted_${mode}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      {/* Background mesh */}
      <div className="mesh" aria-hidden="true">
        <div className="mesh-orb orb1" />
        <div className="mesh-orb orb2" />
        <div className="mesh-orb orb3" />
        <div className="mesh-grid" />
      </div>

      {/* Header */}
      <header className="header">
        <div className="logo">
          <span className="logo-icon">⚡</span>
          <span className="logo-text">SnapText</span>
          <span className="logo-badge">AI</span>
        </div>
        <p className="tagline">Screenshot → Editable Text, instantly</p>
      </header>

      <main className="main">
        {/* Left Panel */}
        <section className="panel panel-left">
          <div className="panel-header">
            <span className="step-num">01</span>
            <h2>Upload Screenshot</h2>
          </div>

          {/* Drop Zone */}
          <div
            className={`dropzone ${dragOver ? "drag-active" : ""} ${imagePreview ? "has-image" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !imagePreview && fileRef.current?.click()}
          >
            {imagePreview ? (
              <div className="preview-wrap">
                <img src={imagePreview} alt="Preview" className="preview-img" />
                <button className="remove-btn" onClick={(e) => { e.stopPropagation(); clear(); }}>
                  ✕ Remove
                </button>
              </div>
            ) : (
              <div className="drop-inner">
                <div className="drop-icon">
                  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="4" y="8" width="40" height="32" rx="4" stroke="currentColor" strokeWidth="2"/>
                    <circle cx="16" cy="20" r="4" stroke="currentColor" strokeWidth="2"/>
                    <path d="M4 34l12-10 8 8 8-6 12 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M32 4v12M26 8l6-4 6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p className="drop-title">Drop your screenshot here</p>
                <p className="drop-sub">or click to browse · paste from clipboard</p>
                <p className="drop-formats">PNG · JPG · WEBP · GIF · max 10 MB</p>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            style={{ display: "none" }}
          />

          {/* Mode selector */}
          <div className="panel-header" style={{ marginTop: "28px" }}>
            <span className="step-num">02</span>
            <h2>Output Mode</h2>
          </div>
          <div className="mode-grid">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`mode-btn ${mode === m.id ? "active" : ""}`}
                onClick={() => setMode(m.id)}
              >
                <span className="mode-icon">{m.icon}</span>
                <span className="mode-label">{m.label}</span>
                <span className="mode-desc">{m.desc}</span>
              </button>
            ))}
          </div>

          {/* Extract button */}
          <button
            className={`extract-btn ${loading ? "loading" : ""}`}
            onClick={extract}
            disabled={!image || loading}
          >
            {loading ? (
              <>
                <span className="spinner" />
                Extracting…
              </>
            ) : (
              <>
                <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
                Extract Text
              </>
            )}
          </button>
        </section>

        {/* Right Panel */}
        <section className="panel panel-right">
          <div className="panel-header">
            <span className="step-num">03</span>
            <h2>Editable Result</h2>
            {tokens > 0 && (
              <span className="token-badge">{tokens} tokens</span>
            )}
          </div>

          {error && (
            <div className="error-box">
              <span>⚠</span> {error}
            </div>
          )}

          <div className="textarea-wrap">
            <textarea
              ref={textareaRef}
              className={`result-textarea ${mode === "code" ? "mono" : ""}`}
              value={displayed}
              onChange={(e) => setResult(e.target.value)}
              placeholder={
                loading
                  ? "AI is reading your screenshot…"
                  : "Extracted text will appear here and become fully editable…"
              }
              spellCheck={mode !== "code"}
            />
            {!result && !loading && (
              <div className="textarea-hint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40">
                  <path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <p>Upload a screenshot and hit Extract</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="actions">
            <button
              className="action-btn primary"
              onClick={copy}
              disabled={!result}
            >
              {copied ? "✓ Copied!" : "Copy Text"}
            </button>
            <button
              className="action-btn"
              onClick={downloadTxt}
              disabled={!result}
            >
              Download .txt
            </button>
            <button
              className="action-btn danger"
              onClick={clear}
              disabled={!image && !result}
            >
              Clear All
            </button>
          </div>

          {/* Character count */}
          {result && (
            <div className="stats">
              <span>{result.length} chars</span>
              <span>·</span>
              <span>{result.trim().split(/\s+/).filter(Boolean).length} words</span>
              <span>·</span>
              <span>{result.split("\n").length} lines</span>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <p>Powered by <strong>Groq</strong> · Llama 4 Scout vision model</p>
      </footer>
    </div>
  );
}
