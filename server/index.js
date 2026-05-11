const express = require("express");
const multer = require("multer");
const cors = require("cors");
const Groq = require("groq-sdk");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json({ limit: "20mb" }));

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Images only"));
  },
});

// Try to extract JSON array from messy LLM output
function parseBlocks(raw) {
  if (!raw) return [];
  // Strip markdown fences
  raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  // Try direct parse first
  try { const r = JSON.parse(raw); if (Array.isArray(r)) return r; } catch (_) {}
  // Find first [...] array
  const m = raw.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  // Find all {...} objects and wrap
  const objs = [...raw.matchAll(/\{[^{}]+\}/g)];
  if (objs.length > 0) {
    try { return JSON.parse("[" + objs.map(o => o[0]).join(",") + "]"); } catch (_) {}
  }
  return [];
}

app.post("/api/extract", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded." });
    if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "GROQ_API_KEY not configured." });

    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    // Two-pass: first get all text lines, then get positions
    const prompt = `This is a screenshot. I need you to find ALL visible text in it.

Look carefully at every part of the image — headers, body text, labels, timestamps, numbers, buttons, messages, everything.

For each piece of text you find, output a JSON object. Return ALL of them as a JSON array.

Each object must have these exact keys:
- "id": integer starting from 0
- "text": the exact text string you see (can be multi-line, use \\n)
- "x": number, left edge of text as percent of total image width (0 to 100)
- "y": number, top edge of text as percent of total image height (0 to 100)
- "w": number, width of text region as percent of image width (1 to 100)
- "h": number, height of text region as percent of image height (1 to 100)
- "size": one of "small", "medium", "large"
- "color": "dark" if text is dark/black, "light" if text is white/light

CRITICAL RULES:
1. Return ONLY the JSON array. Nothing else. No explanation. No markdown.
2. Start your response with [ and end with ]
3. Every string value must use double quotes
4. If you see many lines of text close together, group them into one block
5. There IS text in this image — do not return an empty array`;

    const completion = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          { type: "text", text: prompt }
        ]
      }],
      max_tokens: 8192,
      temperature: 0.0,
    });

    const raw = completion.choices[0]?.message?.content || "";
    console.log("Raw LLM response (first 500 chars):", raw.slice(0, 500));

    let blocks = parseBlocks(raw);

    // If still empty, try a simpler fallback prompt
    if (blocks.length === 0) {
      console.log("First pass empty, trying fallback prompt...");
      const fallback = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            { type: "text", text: `List every text string visible in this image as a JSON array. Format: [{"id":0,"text":"...","x":10,"y":10,"w":80,"h":10,"size":"medium","color":"dark"}]. Only output the JSON array.` }
          ]
        }],
        max_tokens: 4096,
        temperature: 0.0,
      });
      const raw2 = fallback.choices[0]?.message?.content || "";
      console.log("Fallback response (first 500 chars):", raw2.slice(0, 500));
      blocks = parseBlocks(raw2);
    }

    // Sanitize
    blocks = blocks
      .filter(b => b && typeof b.text === "string" && b.text.trim().length > 0)
      .map((b, i) => ({
        id: typeof b.id === "number" ? b.id : i,
        text: String(b.text || "").trim(),
        x: Math.max(0, Math.min(99, Number(b.x) || 0)),
        y: Math.max(0, Math.min(99, Number(b.y) || 0)),
        w: Math.max(1, Math.min(100, Number(b.w) || 20)),
        h: Math.max(1, Math.min(50, Number(b.h) || 5)),
        size: ["small","medium","large"].includes(b.size) ? b.size : "medium",
        color: b.color === "light" ? "light" : "dark",
      }));

    console.log(`Returning ${blocks.length} blocks`);
    res.json({ success: true, blocks });

  } catch (err) {
    console.error("Extract error:", err);
    if (err.status === 401) return res.status(401).json({ error: "Invalid Groq API key." });
    if (err.status === 429) return res.status(429).json({ error: "Rate limit hit. Please wait and retry." });
    res.status(500).json({ error: err.message || "Extraction failed." });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", groqConfigured: !!process.env.GROQ_API_KEY });
});

if (process.env.NODE_ENV === "production") {
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/build/index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Server on port ${PORT}`);
  console.log(`Groq: ${process.env.GROQ_API_KEY ? "✓ configured" : "✗ MISSING"}`);
});
