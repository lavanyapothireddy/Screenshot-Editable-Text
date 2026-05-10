# SnapText — Screenshot → Editable Text

Extract editable text from any screenshot or image using **Groq AI** (Llama 4 Vision).

## Features
- 📋 Upload by drag & drop, file picker, or **Ctrl+V paste**
- 3 extraction modes: Full Extract, Structured (Markdown), Code/Tech
- Live word/char/line stats
- Fully editable output textarea
- Copy to clipboard & Download as `.txt`
- Responsive, dark-themed UI

---

## Project Structure

```
screenshot-to-text/
├── client/               ← React frontend
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── App.js
│   │   ├── App.css
│   │   └── index.js
│   └── package.json
├── server/               ← Express backend
│   ├── index.js
│   └── package.json
├── package.json          ← Root (build scripts for Render)
├── render.yaml           ← Render deployment config
├── .env.example
└── .gitignore
```

---

## Local Development

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd screenshot-to-text
npm run install-all
```

### 2. Set environment variables

```bash
cp .env.example .env
# Edit .env and add your GROQ_API_KEY
```

Get your Groq API key free at: https://console.groq.com

### 3. Run locally

Open two terminals:

**Terminal 1 — Backend:**
```bash
cd server
node index.js
# Server starts on http://localhost:5000
```

**Terminal 2 — Frontend:**
```bash
cd client
npm start
# React app starts on http://localhost:3000
```

The React dev server proxies `/api/*` requests to `localhost:5000`.

---

## Deploy to Render

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

### Step 2 — Create Web Service on Render
1. Go to https://render.com → **New** → **Web Service**
2. Connect your GitHub repo
3. Configure:
   - **Environment**: `Node`
   - **Build Command**: `npm run install-all && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free

### Step 3 — Add Environment Variable
In your Render service dashboard → **Environment** tab → Add:

| Key | Value |
|-----|-------|
| `GROQ_API_KEY` | `your_groq_api_key_here` |
| `NODE_ENV` | `production` |

### Step 4 — Deploy
Click **Deploy** — Render builds the React app and serves everything from the Express server.

---

## API Reference

### `POST /api/extract`
Extracts text from an uploaded image.

**Form Data:**
| Field | Type | Description |
|-------|------|-------------|
| `image` | File | Image file (PNG, JPG, WEBP, GIF, max 10MB) |
| `mode` | string | `full` \| `structured` \| `code` |

**Response:**
```json
{
  "success": true,
  "text": "Extracted text here...",
  "model": "meta-llama/llama-4-scout-17b-16e-instruct",
  "usage": { "prompt_tokens": 123, "completion_tokens": 456 }
}
```

### `GET /api/health`
Returns server health and whether Groq API key is configured.

---

## Tech Stack
- **Frontend**: React 18, vanilla CSS
- **Backend**: Node.js, Express, Multer
- **AI**: Groq API (Llama 4 Scout Vision)
- **Hosting**: Render
