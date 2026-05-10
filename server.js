const express = require('express');
const https   = require('https');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Serve static files from /public ── */
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '25mb' }));

/* ── Health check ── */
app.get('/health', (req, res) => res.json({ status: 'ok' }));

/* ── Proxy endpoint: POST /api/extract ──
   Frontend sends the base64 image here.
   Server attaches the Groq API key and forwards to Groq.
   The key is NEVER exposed to the browser.
*/
app.post('/api/extract', (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY environment variable not set on server.' });
  }

  const { imageBase64, mimeType } = req.body;

  if (!imageBase64 || !mimeType) {
    return res.status(400).json({ error: 'Missing imageBase64 or mimeType in request body.' });
  }

  const payload = JSON.stringify({
    model:       'meta-llama/llama-4-scout-17b-16e-instruct',
    max_tokens:  4096,
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        {
          type:      'image_url',
          image_url: { url: `data:${mimeType};base64,${imageBase64}` }
        },
        {
          type: 'text',
          text: 'Extract ALL text visible in this image exactly as it appears. Preserve line breaks, spacing, and structure as much as possible. Return only the extracted text — no explanations, no preamble.'
        }
      ]
    }]
  });

  const options = {
    hostname: 'api.groq.com',
    path:     '/openai/v1/chat/completions',
    method:   'POST',
    headers:  {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const groqReq = https.request(options, groqRes => {
    let data = '';
    groqRes.on('data', chunk => data += chunk);
    groqRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (groqRes.statusCode !== 200) {
          return res.status(groqRes.statusCode).json({ error: parsed.error?.message || 'Groq API error' });
        }
        const text = parsed.choices?.[0]?.message?.content?.trim() || '';
        res.json({ text });
      } catch {
        res.status(500).json({ error: 'Failed to parse Groq response' });
      }
    });
  });

  groqReq.on('error', err => {
    res.status(500).json({ error: `Request failed: ${err.message}` });
  });

  groqReq.write(payload);
  groqReq.end();
});

/* ── Fallback: all routes → index.html ── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
