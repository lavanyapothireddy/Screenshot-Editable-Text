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

app.post("/api/extract", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded." });
    if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "GROQ_API_KEY not configured." });

    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    const prompt = `You are an OCR tool. Analyze this image and find every piece of visible text.

For EACH distinct text block (label, heading, paragraph, button, caption, etc.), return a JSON object with:
- "id": sequential number starting at 0
- "text": the EXACT text content as it appears
- "x": left edge position as % of image width (0-100)
- "y": top edge position as % of image height (0-100)  
- "w": width of the text block as % of image width (0-100)
- "h": height of the text block as % of image height (0-100)
- "size": "small" | "medium" | "large" based on font size relative to image
- "color": "light" if text is white/light colored, "dark" if text is black/dark colored

Return ONLY a valid JSON array. No markdown. No explanation. No extra text. Just the raw JSON array starting with [ and ending with ].

Example format:
[{"id":0,"text":"Hello World","x":10,"y":5,"w":40,"h":8,"size":"large","color":"dark"}]`;

    const completion = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          { type: "text", text: prompt }
        ]
      }],
      max_tokens: 4096,
      temperature: 0.05,
    });

    let raw = completion.choices[0]?.message?.content || "[]";
    raw = raw.replace(/```json|```/g, "").trim();
    const match = raw.match(/\[[\s\S]*\]/);
    let blocks = [];
    if (match) {
      try { blocks = JSON.parse(match[0]); } catch(e) { blocks = []; }
    }

    // Sanitize block values
    blocks = blocks.map((b, i) => ({
      id: typeof b.id === "number" ? b.id : i,
      text: String(b.text || ""),
      x: Math.max(0, Math.min(100, Number(b.x) || 0)),
      y: Math.max(0, Math.min(100, Number(b.y) || 0)),
      w: Math.max(1, Math.min(100, Number(b.w) || 10)),
      h: Math.max(1, Math.min(100, Number(b.h) || 5)),
      size: ["small","medium","large"].includes(b.size) ? b.size : "medium",
      color: b.color === "light" ? "light" : "dark",
    }));

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
  console.log(`Groq: ${process.env.GROQ_API_KEY ? "✓" : "✗ MISSING"}`);
});

