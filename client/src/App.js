import React, { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";

const API_BASE = process.env.REACT_APP_API_URL || "";

export default function App() {
  const [imageFile, setImageFile] = useState(null);
  const [imageSrc, setImageSrc] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const fileInputRef = useRef(null);
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) {
      setError("Please upload a valid image (PNG, JPG, WEBP).");
      return;
    }
    setImageFile(file);
    setError("");
    setBlocks([]);
    setEditingId(null);
    const reader = new FileReader();
    reader.onload = (e) => setImageSrc(e.target.result);
    reader.readAsDataURL(file);
  }, []);

  const onFileChange = (e) => handleFile(e.target.files[0]);
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); };
  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const handleDropZonePaste = useCallback((e) => {
    for (let item of (e.clipboardData?.items || [])) {
      if (item.type.startsWith("image/")) { e.preventDefault(); handleFile(item.getAsFile()); break; }
    }
  }, [handleFile]);

  const extractText = async () => {
    if (!imageFile) return;
    setLoading(true);
    setError("");
    setBlocks([]);
    setEditingId(null);

    const formData = new FormData();
    formData.append("image", imageFile);

    try {
      const res = await fetch(`${API_BASE}/api/extract`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed.");
      if (!data.blocks || data.blocks.length === 0) {
        setError("No text detected in this image.");
        return;
      }
      setBlocks(data.blocks.map((b, i) => ({ ...b, id: b.id ?? i, edited: false })));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateText = (id, newText) => {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, text: newText, edited: true } : b));
  };

  const resetBlock = (id) => {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, edited: false } : b));
  };

  // Download the edited image using Canvas
  const downloadEdited = async () => {
    if (!imageSrc || blocks.length === 0) return;
    setDownloading(true);

    try {
      const img = new Image();
      img.src = imageSrc;
      await new Promise((res) => { img.onload = res; });

      const canvas = canvasRef.current;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");

      // Draw original image
      ctx.drawImage(img, 0, 0);

      // For each edited block, paint over old text and draw new text
      blocks.forEach((block) => {
        if (!block.edited) return;

        const x = (block.x / 100) * img.naturalWidth;
        const y = (block.y / 100) * img.naturalHeight;
        const w = (block.w / 100) * img.naturalWidth;
        const h = (block.h / 100) * img.naturalHeight;

        // Sample background color from center of block
        const sampleX = Math.min(Math.floor(x + w / 2), img.naturalWidth - 1);
        const sampleY = Math.min(Math.floor(y + h / 2), img.naturalHeight - 1);
        const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
        const bgColor = `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`;

        // Paint over the original text region with background color
        ctx.fillStyle = bgColor;
        ctx.fillRect(x - 2, y - 2, w + 4, h + 4);

        // Draw new text
        const fontSize = block.size === "large" ? Math.round(h * 0.75)
          : block.size === "medium" ? Math.round(h * 0.65)
          : Math.round(h * 0.55);

        ctx.font = `${fontSize}px Arial, sans-serif`;
        ctx.fillStyle = block.color === "light" ? "#ffffff" : "#000000";
        ctx.textBaseline = "top";

        // Word-wrap text to fit width
        const words = block.text.split(" ");
        let line = "";
        let lineY = y + 2;
        const lineH = fontSize * 1.2;

        for (let word of words) {
          const test = line ? `${line} ${word}` : word;
          if (ctx.measureText(test).width > w && line) {
            ctx.fillText(line, x + 2, lineY);
            line = word;
            lineY += lineH;
          } else {
            line = test;
          }
        }
        if (line) ctx.fillText(line, x + 2, lineY);
      });

      // Download
      canvas.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "edited-image.png";
        a.click();
      }, "image/png");
    } catch (err) {
      setError("Failed to export image: " + err.message);
    } finally {
      setDownloading(false);
    }
  };

  const editedCount = blocks.filter((b) => b.edited).length;
  const hasBlocks = blocks.length > 0;

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-mark">✎</span>
            <div>
              <div className="logo-name">SnapEdit</div>
              <div className="logo-sub">Edit text directly in your screenshots</div>
            </div>
          </div>
          <div className="header-right">
            {hasBlocks && (
              <div className="edit-count">
                {editedCount} of {blocks.length} blocks edited
              </div>
            )}
            {editedCount > 0 && (
              <button className="download-btn" onClick={downloadEdited} disabled={downloading}>
                {downloading ? "Exporting…" : "⬇ Download Edited Image"}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        {!imageSrc ? (
          /* ── Upload screen ── */
          <div className="upload-screen">
            <div
              className={`drop-zone-big ${dragOver ? "drag-over" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onPaste={handleDropZonePaste}
              tabIndex={0}
            >
              <div className="dz-icon">🖼</div>
              <h2 className="dz-title">Drop your screenshot here</h2>
              <p className="dz-sub">Click to browse · Paste with Ctrl+V</p>
              <p className="dz-types">PNG · JPG · WEBP · up to 10MB</p>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileChange} style={{ display: "none" }} />
            {error && <div className="error-box">⚠ {error}</div>}
          </div>
        ) : (
          /* ── Editor screen ── */
          <div className="editor-screen">
            {/* Toolbar */}
            <div className="toolbar">
              <button className="tool-btn secondary" onClick={() => { setImageSrc(null); setImageFile(null); setBlocks([]); setError(""); }}>
                ← New Image
              </button>
              {!hasBlocks ? (
                <button className="tool-btn primary" onClick={extractText} disabled={loading}>
                  {loading ? <><span className="spinner" /> Detecting text…</> : "🔍 Detect Text Blocks"}
                </button>
              ) : (
                <div className="toolbar-info">
                  Click any <span className="hl">highlighted block</span> on the image to edit its text
                </div>
              )}
              {error && <div className="error-inline">⚠ {error}</div>}
            </div>

            {/* Image canvas area */}
            <div className="image-area">
              <div className="image-container" ref={containerRef}>
                <img
                  ref={imageRef}
                  src={imageSrc}
                  alt="Uploaded"
                  className="main-image"
                  draggable={false}
                />

                {/* Text block overlays */}
                {blocks.map((block) => (
                  <TextBlock
                    key={block.id}
                    block={block}
                    isEditing={editingId === block.id}
                    onStartEdit={() => setEditingId(block.id)}
                    onStopEdit={() => setEditingId(null)}
                    onTextChange={(t) => updateText(block.id, t)}
                    onReset={() => resetBlock(block.id)}
                  />
                ))}

                {/* Loading shimmer over image */}
                {loading && (
                  <div className="detecting-overlay">
                    <div className="detecting-inner">
                      <span className="spinner large" />
                      <p>Detecting text blocks…</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Block list sidebar */}
            {hasBlocks && (
              <div className="block-list">
                <div className="block-list-title">Text Blocks ({blocks.length})</div>
                {blocks.map((block) => (
                  <div
                    key={block.id}
                    className={`block-item ${block.edited ? "edited" : ""} ${editingId === block.id ? "active" : ""}`}
                    onClick={() => setEditingId(editingId === block.id ? null : block.id)}
                  >
                    <div className="block-num">#{block.id + 1}</div>
                    <div className="block-text">{block.text}</div>
                    {block.edited && <div className="block-badge">edited</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Hidden canvas for export */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

/* ── Individual editable text block overlay ── */
function TextBlock({ block, isEditing, onStartEdit, onStopEdit, onTextChange, onReset }) {
  const [localText, setLocalText] = useState(block.text);
  const inputRef = useRef(null);

  useEffect(() => { setLocalText(block.text); }, [block.text]);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const commit = () => {
    onTextChange(localText);
    onStopEdit();
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
    if (e.key === "Escape") { setLocalText(block.text); onStopEdit(); }
  };

  const style = {
    left: `${block.x}%`,
    top: `${block.y}%`,
    width: `${block.w}%`,
    minHeight: `${block.h}%`,
  };

  return (
    <div
      className={`text-block ${block.size || "medium"} ${block.color === "light" ? "light-text" : "dark-text"} ${isEditing ? "editing" : ""} ${block.edited ? "was-edited" : ""}`}
      style={style}
      onClick={() => !isEditing && onStartEdit()}
      title={isEditing ? "" : "Click to edit this text"}
    >
      {isEditing ? (
        <div className="edit-popup">
          <textarea
            ref={inputRef}
            className="block-input"
            value={localText}
            onChange={(e) => setLocalText(e.target.value)}
            onKeyDown={handleKey}
            onBlur={commit}
            rows={3}
          />
          <div className="edit-popup-actions">
            <button className="pop-btn save" onMouseDown={(e) => { e.preventDefault(); commit(); }}>✓ Apply</button>
            <button className="pop-btn cancel" onMouseDown={(e) => { e.preventDefault(); setLocalText(block.text); onStopEdit(); }}>✕</button>
            {block.edited && (
              <button className="pop-btn reset" onMouseDown={(e) => { e.preventDefault(); setLocalText(block.text); onReset(); onStopEdit(); }}>↺ Reset</button>
            )}
          </div>
        </div>
      ) : (
        <span className="block-label">{block.text}</span>
      )}
    </div>
  );
}
