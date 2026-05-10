require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Groq = require("groq-sdk");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

// Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Multer — store image in memory (no disk writes needed)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, GIF and WEBP images are allowed."));
    }
  },
});

app.use(cors());
app.use(express.json());

// Serve React build in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));
}

// ─── Health check ────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Screenshot-to-Text API is running" });
});

// ─── Extract text from screenshot ────────────────────────────────────────────
app.post("/api/extract", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided." });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "GROQ_API_KEY is not configured." });
    }

    // Convert buffer to base64
    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    const mode = req.body.mode || "plain"; // plain | markdown | code

    const systemPrompts = {
      plain:
        "You are an expert OCR engine. Extract ALL visible text from the image exactly as it appears. Preserve line breaks, spacing, and structure. Output ONLY the extracted text with no commentary, no explanation, no markdown formatting.",
      markdown:
        "You are an expert OCR engine. Extract ALL visible text from the image and format it as clean Markdown. Use headings, lists, bold, italics, and code blocks where appropriate. Output ONLY the Markdown content.",
      code:
        "You are an expert code extractor. Extract ALL code visible in the image. Preserve indentation, syntax, and comments exactly. Wrap the code in appropriate markdown code fences with the detected language. Output ONLY the code block.",
    };

    const chatCompletion = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
            {
              type: "text",
              text: systemPrompts[mode] || systemPrompts.plain,
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    const extractedText =
      chatCompletion.choices[0]?.message?.content?.trim() || "";

    res.json({
      success: true,
      text: extractedText,
      mode,
      tokens: chatCompletion.usage?.total_tokens || 0,
    });
  } catch (err) {
    console.error("Extraction error:", err);

    if (err.status === 401) {
      return res.status(401).json({ error: "Invalid GROQ_API_KEY." });
    }
    if (err.status === 429) {
      return res
        .status(429)
        .json({ error: "Rate limit hit. Please wait a moment and retry." });
    }

    res.status(500).json({ error: err.message || "Internal server error." });
  }
});

// Catch-all for React (production)
if (process.env.NODE_ENV === "production") {
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/build/index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
