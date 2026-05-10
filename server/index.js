const express = require("express");
const multer = require("multer");
const cors = require("cors");
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));
}

// Multer config — store in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed (JPEG, PNG, WEBP, GIF)"));
    }
  },
});

// POST /api/extract — main endpoint
app.post("/api/extract", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded." });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "GROQ_API_KEY is not configured on the server." });
    }

    // Convert image buffer to base64
    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    const mode = req.body.mode || "full"; // "full" | "structured" | "code"

    const prompts = {
      full: "Extract ALL text from this image exactly as it appears. Preserve formatting, line breaks, bullet points, and structure as much as possible. Return only the extracted text with no additional commentary.",
      structured:
        "Extract all text from this image and organize it in a clean, structured Markdown format. Use headings, lists, and tables where appropriate. Return only the formatted text.",
      code: "This image may contain code or technical content. Extract ALL text including code snippets, variable names, comments, and any surrounding text. Preserve indentation and formatting. Return only the extracted content.",
    };

    const prompt = prompts[mode] || prompts.full;

    // Call Groq with vision model
    const completion = await groq.chat.completions.create({
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
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    });

    const extractedText = completion.choices[0]?.message?.content || "";

    res.json({
      success: true,
      text: extractedText,
      model: completion.model,
      usage: completion.usage,
    });
  } catch (error) {
    console.error("Extraction error:", error);

    if (error.status === 401) {
      return res.status(401).json({ error: "Invalid Groq API key. Check your GROQ_API_KEY environment variable." });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: "Rate limit exceeded. Please wait a moment and try again." });
    }

    res.status(500).json({
      error: error.message || "Failed to extract text from image.",
    });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    groqConfigured: !!process.env.GROQ_API_KEY,
  });
});

// Catch-all for React router in production
if (process.env.NODE_ENV === "production") {
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/build/index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔑 Groq API Key: ${process.env.GROQ_API_KEY ? "Configured ✓" : "NOT SET ✗"}`);
});
