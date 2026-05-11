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
  const [previewSrc, setPreviewSrc] = useState(null);

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const offscreenRef = useRef(null); // always holds the ORIGINAL image pixels

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
    reader.onload = async (e) => {
      const src = e.target.result;
      // Pre-load image into an offscreen canvas to preserve original pixels
      const img = new Image();
      img.onload = () => {
        const oc = document.createElement("canvas");
        oc.width = img.naturalWidth;
        oc.height = img.naturalHeight;
        oc.getContext("2d").drawImage(img, 0, 0);
        offscreenRef.current = oc;
      };
      img.src = src;
      setImageSrc(src);
    };
    reader.readAsDataURL(file);
  }, []);

  const onFileChange = (e) => handleFile(e.target.files[0]);
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); };
  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const handleDropZonePaste = useCallback((e) => {
    for (let item of (e.clipboardData?.items || []))
      if (item.type.startsWith("image/")) { e.preventDefault(); handleFile(item.getAsFile()); break; }
  }, [handleFile]);

  const extractText = async () => {
    if (!imageFile) return;
    setLoading(true); setError(""); setBlocks([]); setEditingId(null); setPreviewSrc(null);
    const formData = new FormData();
    formData.append("image", imageFile);
    try {
      const res = await fetch(`${API_BASE}/api/extract`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed.");
      if (!data.blocks?.length) { setError("Could not detect text — please try again."); return; }
      setBlocks(data.blocks.map((b, i) => ({ ...b, id: b.id ?? i, newText: b.text })));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  // ── THE CORE ENGINE ────────────────────────────────────────────────────────
  const renderEdited = useCallback(async (currentBlocks) => {
    const oc = offscreenRef.current;
    if (!oc) return null;

    const W = oc.width, H = oc.height;
    const canvas = canvasRef.current;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    // Always start from the ORIGINAL image — never compound edits
    ctx.drawImage(oc, 0, 0);

    for (const block of currentBlocks) {
      if (block.newText === block.text) continue;

      const bx = Math.round((block.x / 100) * W);
      const by = Math.round((block.y / 100) * H);
      const bw = Math.round((block.w / 100) * W);
      const bh = Math.round((block.h / 100) * H);

      // ── 1. INPAINT background: copy a patch from nearby clean area ──────
      // Strategy: look for the largest contiguous region above or below
      // that is the same background. Prefer sampling a wide strip just
      // outside the bounding box and tile it to fill the erased region.

      const stripH = Math.max(4, Math.round(bh * 0.4)); // how tall the sample strip is

      // Try above first, then below, then left, then right
      let srcY = by - stripH - 2;
      let srcX = bx;
      let useSrc = "above";
      if (srcY < 0) { srcY = by + bh + 2; useSrc = "below"; }
      if (srcY + stripH > H) { useSrc = "left"; }

      if (useSrc === "above" || useSrc === "below") {
        // Get a strip of pixels from above/below and tile vertically to fill
        const srcImgData = ctx.getImageData(
          Math.max(0, srcX), Math.max(0, srcY),
          Math.min(bw, W - Math.max(0, srcX)),
          Math.min(stripH, H - Math.max(0, srcY))
        );

        // Create a temp canvas with the strip
        const tmpC = document.createElement("canvas");
        tmpC.width = bw; tmpC.height = bh + 8;
        const tmpCtx = tmpC.getContext("2d");
        // Tile the strip vertically
        for (let ty = 0; ty < bh + 8; ty += stripH) {
          const tmpImg = new ImageData(srcImgData.data, srcImgData.width, srcImgData.height);
          tmpCtx.putImageData(tmpImg, 0, ty);
        }
        // Draw tiled patch over the text region
        ctx.drawImage(tmpC, 0, 0, bw, bh + 8, bx, by - 2, bw, bh + 4);
      } else {
        // Fallback: sample the dominant color from the outer ring of the block
        const outerData = ctx.getImageData(
          Math.max(0, bx - 10), Math.max(0, by - 10),
          Math.min(bw + 20, W), Math.min(bh + 20, H)
        );
        let r = 0, g = 0, b = 0, count = 0;
        // Only sample from the outer edges, not inner text
        for (let py = 0; py < outerData.height; py++) {
          for (let px = 0; px < outerData.width; px++) {
            const isInner = px > 10 && px < outerData.width - 10 && py > 10 && py < outerData.height - 10;
            if (!isInner) {
              const idx = (py * outerData.width + px) * 4;
              r += outerData.data[idx]; g += outerData.data[idx+1]; b += outerData.data[idx+2]; count++;
            }
          }
        }
        if (count > 0) { r = Math.round(r/count); g = Math.round(g/count); b = Math.round(b/count); }
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(bx, by, bw, bh);
      }

      // ── 2. DETERMINE text color ──────────────────────────────────────────
      // Sample the center of the (now inpainted) background to measure real luminance
      const cx = Math.min(Math.floor(bx + bw/2), W - 1);
      const cy = Math.min(Math.floor(by + bh/2), H - 1);
      const cPx = ctx.getImageData(cx, cy, 1, 1).data;
      const lum = 0.299 * cPx[0] + 0.587 * cPx[1] + 0.114 * cPx[2];

      // Use original block color hint as tiebreaker
      let textColor = lum > 160 ? "#111111" : "#ffffff";
      if (block.color === "light" && lum > 100) textColor = "#ffffff";
      if (block.color === "dark" && lum < 200) textColor = "#111111";

      // ── 3. MEASURE & SET font ────────────────────────────────────────────
      const fontPx = Math.max(10, Math.round(bh * (
        block.size === "large" ? 0.68 : block.size === "medium" ? 0.55 : 0.42
      )));
      const isBold = block.size === "large";
      ctx.font = `${isBold ? "700" : "400"} ${fontPx}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = textColor;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";

      // ── 4. WORD-WRAP & DRAW text ─────────────────────────────────────────
      const words = block.newText.split(" ");
      const lines = [];
      let cur = "";
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(test).width > bw - 4 && cur) { lines.push(cur); cur = w; }
        else cur = test;
      }
      if (cur) lines.push(cur);

      const lineH = fontPx * 1.2;
      const totalH = lines.length * lineH;
      let startY = by + (bh - totalH) / 2 + lineH / 2;
      if (startY < by + fontPx * 0.5) startY = by + fontPx * 0.5;

      for (const line of lines) {
        ctx.fillText(line, bx + 3, startY);
        startY += lineH;
      }
    }

    return canvas.toDataURL("image/png");
  }, []);

  const applyEdit = useCallback(async (id, newText) => {
    const updated = blocks.map(b => b.id === id ? { ...b, newText } : b);
    setBlocks(updated);
    const url = await renderEdited(updated);
    if (url) setPreviewSrc(url);
  }, [blocks, renderEdited]);

  const downloadEdited = async () => {
    setDownloading(true);
    try {
      const url = await renderEdited(blocks);
      if (!url) return;
      const a = document.createElement("a");
      a.href = url; a.download = "edited-image.png"; a.click();
    } catch (e) { setError("Export failed: " + e.message); }
    finally { setDownloading(false); }
  };

  const clearAll = () => {
    setImageSrc(null); setImageFile(null); setBlocks([]);
    setError(""); setPreviewSrc(null); setEditingId(null);
    offscreenRef.current = null;
  };

  const editedCount = blocks.filter(b => b.newText !== b.text).length;
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
              {downloading ? "Exporting…" : "⬇ Download"}
            </button>
          )}
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          {!imageSrc ? (
            <div className={`dropzone ${dragOver ? "drag-over" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
              onPaste={handleDropZonePaste} tabIndex={0}>
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

          {blocks.length > 0 && (
            <div className="block-panel">
              <div className="block-panel-title">TEXT BLOCKS ({blocks.length})</div>
              <p className="block-panel-hint">Click a block → edit text → Apply to Image</p>
              {blocks.map(block => (
                <BlockEditor key={block.id} block={block}
                  isActive={editingId === block.id}
                  onActivate={() => setEditingId(editingId === block.id ? null : block.id)}
                  onSave={(t) => { applyEdit(block.id, t); setEditingId(null); }}
                />
              ))}
            </div>
          )}
        </aside>

        <main className="preview-area">
          {!imageSrc ? (
            <div className="preview-empty"><p>Upload a screenshot to start editing</p></div>
          ) : (
            <div className="preview-wrapper">
              {previewSrc && (
                <div className="preview-badge">
                  ✓ Live preview — {editedCount} block(s) edited
                </div>
              )}
              <img src={displaySrc} alt="Preview" className="preview-img" />
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
  const ref = useRef(null);
  useEffect(() => { setDraft(block.newText); }, [block.newText]);
  useEffect(() => { if (isActive) ref.current?.focus(); }, [isActive]);
  const changed = draft !== block.text;

  return (
    <div className={`block-card ${isActive ? "active" : ""} ${changed ? "changed" : ""}`}
      onClick={!isActive ? onActivate : undefined}>
      <div className="block-card-header">
        <span className="block-original">{block.text.length > 48 ? block.text.slice(0, 48) + "…" : block.text}</span>
        {changed && <span className="block-changed-dot" />}
      </div>
      {isActive && (
        <div className="block-editor-body" onClick={e => e.stopPropagation()}>
          <label className="editor-label">Replace with</label>
          <textarea ref={ref} className="editor-textarea" value={draft}
            onChange={e => setDraft(e.target.value)} rows={3} />
          <div className="editor-actions">
            <button className="btn-apply" onClick={() => onSave(draft)}>✓ Apply to Image</button>
            <button className="btn-cancel" onClick={() => { setDraft(block.newText); onActivate(); }}>Cancel</button>
            {changed && <button className="btn-reset" onClick={() => { setDraft(block.text); onSave(block.text); }}>↺ Reset</button>}
          </div>
        </div>
      )}
    </div>
  );
}
