const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, 'data');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(NOTES_FILE)) fs.writeFileSync(NOTES_FILE, '[]', 'utf8');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

function readNotes() {
  try { return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8') || '[]'); }
  catch (e) { return []; }
}

function writeNotes(notes) {
  fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf8');
}

app.get('/api/notes', (req, res) => {
  res.json(readNotes());
});

app.post('/api/notes', (req, res) => {
  const notes = readNotes();
  const note = Object.assign({ id: Date.now().toString(), createdAt: new Date().toISOString() }, req.body);
  notes.unshift(note);
  writeNotes(notes);
  res.json(note);
});

app.put('/api/notes/:id', (req, res) => {
  const id = req.params.id;
  const notes = readNotes();
  const idx = notes.findIndex(n => n.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  notes[idx] = Object.assign({}, notes[idx], req.body, { updatedAt: new Date().toISOString() });
  writeNotes(notes);
  res.json(notes[idx]);
});

app.delete('/api/notes/:id', (req, res) => {
  const id = req.params.id;
  let notes = readNotes();
  const before = notes.length;
  notes = notes.filter(n => n.id !== id);
  if (notes.length === before) return res.status(404).json({ error: 'not found' });
  writeNotes(notes);
  res.json({ ok: true });
});

// Simple server-side proxy for Google Geocoding to avoid exposing API key in client
app.get('/api/geocode', (req, res) => {
  const place = req.query.place || (req.body && req.body.place);
  const key = process.env.GEOCODING_KEY;
  if (!place) return res.status(400).json({ error: 'place query required' });
  if (!key) return res.status(500).json({ error: 'GEOCODING_KEY not configured on server' });
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(place)}&key=${encodeURIComponent(key)}`;
  https.get(url, (resp) => {
    let data = '';
    resp.on('data', (chunk) => data += chunk);
    resp.on('end', () => {
      try {
        const j = JSON.parse(data);
        res.json(j);
      } catch (e) {
        console.error('geocode parse error', e);
        res.status(502).json({ error: 'invalid response from geocode provider' });
      }
    });
  }).on('error', (err) => {
    console.error('geocode request failed', err);
    res.status(502).json({ error: 'geocode request failed' });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
