import React, { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";

const API_BASE = process.env.REACT_APP_API_URL || "";

export default function App() {
  const [imageFile, setImageFile] = useState(null);
  const [imageSrc, setImageSrc] = useState(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewSrc, setPreviewSrc] = useState(null); // live preview of edited image

  const fileInputRef = useRef(null);
  const imageRef = useRef(null);
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
    setPreviewSrc(null);
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
    setPreviewSrc(null);

    const formData = new FormData();
    formData.append("image", imageFile);

    try {
      const res = await fetch(`${API_BASE}/api/extract`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed.");
      if (!data.blocks || data.blocks.length === 0) {
        setError("Could not detect text — please try again.");
        return;
      }
      setBlocks(data.blocks.map((b, i) => ({ ...b, id: b.id ?? i, newText: b.text })));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Core: render edited image to canvas ──────────────────────────────────
  const renderEditedCanvas = useCallback(async (currentBlocks) => {
    if (!imageSrc || !currentBlocks || currentBlocks.length === 0) return null;

    const img = new Image();
    img.src = imageSrc;
    await new Promise((res) => { img.onload = res; });

    const W = img.naturalWidth;
    const H = img.naturalHeight;
    setNaturalSize({ w: W, h: H });

    const canvas = canvasRef.current;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    // Draw original image
    ctx.drawImage(img, 0, 0, W, H);

    // Process each edited block
    for (const block of currentBlocks) {
      if (block.newText === block.text) continue; // unchanged

      const bx = Math.round((block.x / 100) * W);
      const by = Math.round((block.y / 100) * H);
      const bw = Math.round((block.w / 100) * W);
      const bh = Math.round((block.h / 100) * H);

      // ── Step 1: Sample background from multiple edge points ──
      const edgeSamples = [];
      const samplePad = Math.max(2, Math.round(bh * 0.05));

      // Top edge strip
      for (let sx = bx; sx < bx + bw; sx += Math.max(1, Math.round(bw / 12))) {
        const sy = Math.max(0, by - samplePad);
        if (sy >= 0 && sy < H && sx >= 0 && sx < W) {
          const p = ctx.getImageData(sx, sy, 1, 1).data;
          edgeSamples.push([p[0], p[1], p[2]]);
        }
      }
      // Bottom edge strip
      for (let sx = bx; sx < bx + bw; sx += Math.max(1, Math.round(bw / 12))) {
        const sy = Math.min(H - 1, by + bh + samplePad);
        if (sy >= 0 && sy < H && sx >= 0 && sx < W) {
          const p = ctx.getImageData(sx, sy, 1, 1).data;
          edgeSamples.push([p[0], p[1], p[2]]);
        }
      }
      // Left/right borders
      for (let sy = by; sy < by + bh; sy += Math.max(1, Math.round(bh / 6))) {
        const lp = ctx.getImageData(Math.max(0, bx - samplePad), sy, 1, 1).data;
        edgeSamples.push([lp[0], lp[1], lp[2]]);
        const rp = ctx.getImageData(Math.min(W - 1, bx + bw + samplePad), sy, 1, 1).data;
        edgeSamples.push([rp[0], rp[1], rp[2]]);
      }

      // Average background color
      let bgR = 255, bgG = 255, bgB = 255;
      if (edgeSamples.length > 0) {
        bgR = Math.round(edgeSamples.reduce((s, p) => s + p[0], 0) / edgeSamples.length);
        bgG = Math.round(edgeSamples.reduce((s, p) => s + p[1], 0) / edgeSamples.length);
        bgB = Math.round(edgeSamples.reduce((s, p) => s + p[2], 0) / edgeSamples.length);
      }

      // ── Step 2: Erase original text region with sampled background ──
      const pad = Math.round(bh * 0.08);
      ctx.fillStyle = `rgb(${bgR},${bgG},${bgB})`;
      ctx.fillRect(bx - pad, by - pad, bw + pad * 2, bh + pad * 2);

      // ── Step 3: Determine text color (contrast against bg) ──
      const luminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
      let textColor;
      if (block.color === "light") {
        textColor = luminance < 128 ? "#ffffff" : `rgb(${255 - bgR}, ${255 - bgG}, ${255 - bgB})`;
      } else {
        textColor = luminance > 128 ? "#000000" : "#ffffff";
      }

      // Detect if original text color was likely a specific color (e.g. green amount text)
      // Sample text region pixels to guess original text color
      const textRegion = ctx.getImageData(bx, by, Math.min(bw, 30), Math.min(bh, 10));
      // (already erased, use block.color hint)
      if (block.textColorHex) textColor = block.textColorHex;

      // ── Step 4: Calculate font size to match original ──
      // block.h is percentage of image height; use that to derive px size
      const fontPx = Math.max(10, Math.round(bh * (
        block.size === "large" ? 0.70 :
        block.size === "medium" ? 0.58 : 0.45
      )));

      // ── Step 5: Pick font weight & family to match context ──
      const isBold = block.size === "large" || block.bold;
      const fontWeight = isBold ? "700" : "400";
      const fontFamily = `"Helvetica Neue", Arial, "Noto Sans", sans-serif`;

      ctx.font = `${fontWeight} ${fontPx}px ${fontFamily}`;
      ctx.fillStyle = textColor;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      // ── Step 6: Word-wrap new text to fit in the block width ──
      const newText = block.newText;
      const lines = [];
      const words = newText.split(" ");
      let current = "";
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (ctx.measureText(test).width > bw - 4 && current) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);

      // ── Step 7: Draw each line ──
      const lineHeight = fontPx * 1.18;
      let ty = by + Math.round((bh - lines.length * lineHeight) / 2);
      if (ty < by) ty = by;

      for (const line of lines) {
        ctx.fillText(line, bx + 2, ty);
        ty += lineHeight;
        if (ty > by + bh) break;
      }
    }

    return canvas.toDataURL("image/png");
  }, [imageSrc]);

  // Update block text and re-render preview
  const updateBlock = useCallback(async (id, newText) => {
    const updated = blocks.map((b) => b.id === id ? { ...b, newText } : b);
    setBlocks(updated);
    const dataUrl = await renderEditedCanvas(updated);
    if (dataUrl) setPreviewSrc(dataUrl);
  }, [blocks, renderEditedCanvas]);

  // Download final image
  const downloadEdited = async () => {
    setDownloading(true);
    try {
      const dataUrl = await renderEditedCanvas(blocks);
      if (!dataUrl) return;
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "edited-image.png";
      a.click();
    } catch (e) {
      setError("Export failed: " + e.message);
    } finally {
      setDownloading(false);
    }
  };

  const clearAll = () => {
    setImageSrc(null); setImageFile(null); setBlocks([]);
    setError(""); setPreviewSrc(null); setEditingId(null);
  };

  const editedCount = blocks.filter((b) => b.newText !== b.text).length;
  const hasBlocks = blocks.length > 0;
  const displaySrc = previewSrc || imageSrc;

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <span className="logo-mark">✎</span>
          <div>
            <div className="logo-name">SnapEdit</div>
            <div className="logo-sub">Professional screenshot text editor</div>
          </div>
        </div>
        <div className="header-right">
          {editedCount > 0 && <span className="edit-badge">{editedCount} edited</span>}
          {editedCount > 0 && (
            <button className="btn-download" onClick={downloadEdited} disabled={downloading}>
              {downloading ? "Exporting…" : "⬇ Download Edited Image"}
            </button>
          )}
        </div>
      </header>

      <div className="layout">
        {/* LEFT: Controls */}
        <aside className="sidebar">
          {!imageSrc ? (
            <div
              className={`dropzone ${dragOver ? "drag-over" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
              onPaste={handleDropZonePaste} tabIndex={0}
            >
              <div className="dz-icon">🖼</div>
              <p className="dz-title">Drop screenshot here</p>
              <p className="dz-hint">or click to browse · Ctrl+V to paste</p>
            </div>
          ) : (
            <>
              <button className="btn-outline" onClick={clearAll}>← New Image</button>
              <button className="btn-primary" onClick={extractText} disabled={loading}>
                {loading ? <><span className="spin" /> Detecting…</> : "🔍 Detect Text Blocks"}
              </button>
            </>
          )}

          {error && <div className="error-msg">⚠ {error}</div>}

          {hasBlocks && (
            <div className="block-panel">
              <div className="block-panel-title">TEXT BLOCKS ({blocks.length})</div>
              <p className="block-panel-hint">Click a block to edit its text. Changes render live on the image.</p>
              {blocks.map((block) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  isActive={editingId === block.id}
                  onActivate={() => setEditingId(editingId === block.id ? null : block.id)}
                  onSave={(newText) => { updateBlock(block.id, newText); setEditingId(null); }}
                />
              ))}
            </div>
          )}
        </aside>

        {/* RIGHT: Image preview */}
        <main className="preview-area">
          {!imageSrc ? (
            <div className="preview-empty">
              <p>Upload a screenshot to start editing</p>
            </div>
          ) : (
            <div className="preview-wrapper">
              {previewSrc && (
                <div className="preview-badge">
                  {editedCount > 0 ? `✓ Live preview — ${editedCount} text block(s) edited` : "Original"}
                </div>
              )}
              <img
                ref={imageRef}
                src={displaySrc}
                alt="Preview"
                className="preview-img"
                onLoad={(e) => setNaturalSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
              />
            </div>
          )}
        </main>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileChange} style={{ display: "none" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

function BlockEditor({ block, isActive, onActivate, onSave }) {
  const [draft, setDraft] = useState(block.newText);
  const textareaRef = useRef(null);

  useEffect(() => { setDraft(block.newText); }, [block.newText]);
  useEffect(() => { if (isActive) textareaRef.current?.focus(); }, [isActive]);

  const changed = draft !== block.text;

  return (
    <div className={`block-card ${isActive ? "active" : ""} ${changed ? "changed" : ""}`} onClick={!isActive ? onActivate : undefined}>
      <div className="block-card-header">
        <span className="block-original">{block.text.length > 50 ? block.text.slice(0, 50) + "…" : block.text}</span>
        {changed && <span className="block-changed-dot" title="Edited" />}
      </div>

      {isActive && (
        <div className="block-editor-body" onClick={(e) => e.stopPropagation()}>
          <label className="editor-label">New text</label>
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
          />
          <div className="editor-actions">
            <button className="btn-apply" onClick={() => onSave(draft)}>✓ Apply to Image</button>
            <button className="btn-cancel" onClick={() => { setDraft(block.newText); onActivate(); }}>Cancel</button>
            {changed && (
              <button className="btn-reset" onClick={() => { setDraft(block.text); onSave(block.text); }}>↺ Reset</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
