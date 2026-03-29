/**
 * InspectFlow — API Server (Express + PostgreSQL)
 *
 * Utilise pg (node-postgres) sur le PostgreSQL local du VPS.
 * Variable requise dans .env : DATABASE_URL
 *
 * Usage : node server.js
 */

import 'dotenv/config';
import express        from 'express';
import pg             from 'pg';
import multer         from 'multer';
import sharp          from 'sharp';
import { fileURLToPath } from 'url';
import path           from 'path';
import fs             from 'fs';
import crypto         from 'crypto';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── Logs horodatés ─────────────────────────────────────────────────── */
const _log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const _err = (msg) => console.error(`[${new Date().toISOString()}] ERROR: ${msg}`);

/* ── Pool PostgreSQL ────────────────────────────────────────────────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => _err(`[pg] Unexpected error: ${err.message}`));

/* Wrapper : exécute une requête et retourne les rows */
async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

/* ── Express ────────────────────────────────────────────────────────── */
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

/* ── Multer — upload en mémoire (conversion sharp avant écriture) ───── */
const upload = multer({ storage: multer.memoryStorage() });

/* ── Helpers ────────────────────────────────────────────────────────── */
function mapDoc(d) {
  return {
    id:          d.id,
    name:        d.name,
    size:        d.file_size,
    type:        d.file_ext,
    status:      d.status,
    uploadedAt:  d.uploaded_at,
    storageUrl:  d.storage_url  ?? null,
    storagePath: d.storage_path ?? null,
    dataUrl:     null,
  };
}

function mapPhoto(p) {
  return {
    id:          p.id,
    index:       p.sort_order,
    lieu:        p.lieu,
    probleme:    p.probleme,
    solution:    p.solution,
    validated:   p.validated,
    image:       p.image_url    ?? null,
    storageUrl:  p.image_url    ?? null,
    storagePath: p.storage_path ?? null,
  };
}

function sendError(res, e, code = 500) {
  const msg = e?.message ?? String(e);
  console.error('[API]', msg);
  res.status(code).json({ error: msg });
}

/* ── SSE ────────────────────────────────────────────────────────────── */
const sseClients = new Set();

function broadcast(type, action, payload) {
  if (sseClients.size === 0) return;
  const data = `event: update\ndata: ${JSON.stringify({ type, action, payload })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

/* ── POST /api/upload ───────────────────────────────────────────────── */
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

  const isDoc = req.query.type === 'doc';
  const sub   = isDoc ? 'docs' : 'photos';
  const dir   = path.join(__dirname, 'public', 'uploads', sub);
  fs.mkdirSync(dir, { recursive: true });

  try {
    let filename, filepath;

    if (!isDoc && req.file.mimetype.startsWith('image/')) {
      // Convertit toute image en WebP qualité 82
      const baseName = path.parse(req.file.originalname).name;
      filename = `${baseName}.webp`;
      filepath = path.join(dir, filename);
      await sharp(req.file.buffer).webp({ quality: 82 }).toFile(filepath);
    } else {
      filename = req.file.originalname;
      filepath = path.join(dir, filename);
      fs.writeFileSync(filepath, req.file.buffer);
    }

    res.json({ url: `/uploads/${sub}/${filename}` });
  } catch (e) { sendError(res, e); }
});

/* ── Redirect / → /dashboard.html ──────────────────────────────────── */
app.get('/', (_req, res) => res.redirect('/dashboard.html'));

/* ── GET /api/events (SSE) ──────────────────────────────────────────── */
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  res.write(': connected\n\n');

  const keepalive = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
});

/* ── GET /api/data ──────────────────────────────────────────────────── */
app.get('/api/data', async (_req, res) => {
  try {
    const [managers, clients, inspections, photos, docs] = await Promise.all([
      query('SELECT * FROM managers          ORDER BY created_at'),
      query('SELECT * FROM clients           ORDER BY created_at'),
      query('SELECT * FROM inspections       ORDER BY created_at'),
      query('SELECT * FROM inspection_photos ORDER BY inspection_id, sort_order'),
      query('SELECT * FROM documents         ORDER BY created_at'),
    ]);

    const result = {
      managers: managers.map(m => ({
        id:    m.id,
        name:  m.name,
        email: m.email,
        phone: m.phone,
        color: m.color,
        notes: m.notes,
        clients: clients
          .filter(c => c.manager_id === m.id)
          .map(c => ({
            id:     c.id,
            name:   c.name,
            email:  c.email,
            phone:  c.phone,
            type:   c.type,
            urgent: c.urgent,
            notes:  c.notes,
            docs: docs.filter(d => d.client_id === c.id).map(mapDoc),
            inspections: inspections
              .filter(i => i.client_id === c.id)
              .map(i => ({
                id:            i.id,
                date:          i.inspection_date,
                scheduledDate: i.scheduled_date ?? null,
                notes:         i.notes,
                status:        i.status,
                urgent:        i.urgent,
                inspNotes:     i.insp_notes,
                docs:   docs.filter(d => d.inspection_id === i.id).map(mapDoc),
                photos: photos.filter(p => p.inspection_id === i.id).map(mapPhoto),
              })),
          })),
      })),
    };

    res.json(result);
  } catch (e) { sendError(res, e); }
});

/* ═══════════════════════════════════════════════════════
   MANAGERS
═══════════════════════════════════════════════════════ */
app.post('/api/managers', async (req, res) => {
  const { id, name, email = '', phone = '', color = '#1A56DB', notes = '' } = req.body;
  if (!id || !name) return sendError(res, 'id et name requis', 400);
  try {
    const rows = await query(
      `INSERT INTO managers (id, name, email, phone, color, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, name, email, phone, color, notes]
    );
    res.status(201).json(rows[0]);
    broadcast('managers', 'create', rows[0]);
  } catch (e) { sendError(res, e); }
});

app.patch('/api/managers/:id', async (req, res) => {
  const allowed = ['name', 'email', 'phone', 'color', 'notes'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { sets.push(`${k} = $${sets.length + 1}`); vals.push(req.body[k]); }
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  try {
    const rows = await query(
      `UPDATE managers SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    res.json(rows[0]);
    broadcast('managers', 'update', rows[0]);
  } catch (e) { sendError(res, e); }
});

app.delete('/api/managers/:id', async (req, res) => {
  try {
    await query('DELETE FROM managers WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    broadcast('managers', 'delete', { id: req.params.id });
  } catch (e) { sendError(res, e); }
});

/* ═══════════════════════════════════════════════════════
   CLIENTS
═══════════════════════════════════════════════════════ */
app.post('/api/clients', async (req, res) => {
  const { id, manager_id, name, email = '', phone = '', type = '', urgent = false, notes = '' } = req.body;
  if (!id || !manager_id || !name) return sendError(res, 'id, manager_id et name requis', 400);
  try {
    const rows = await query(
      `INSERT INTO clients (id, manager_id, name, email, phone, type, urgent, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, manager_id, name, email, phone, type, !!urgent, notes]
    );
    res.status(201).json(rows[0]);
    broadcast('clients', 'create', rows[0]);
  } catch (e) { sendError(res, e); }
});

app.patch('/api/clients/:id', async (req, res) => {
  const allowed = ['name', 'email', 'phone', 'type', 'urgent', 'notes'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { sets.push(`${k} = $${sets.length + 1}`); vals.push(req.body[k]); }
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  try {
    const rows = await query(
      `UPDATE clients SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    res.json(rows[0]);
    broadcast('clients', 'update', rows[0]);
  } catch (e) { sendError(res, e); }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    await query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    broadcast('clients', 'delete', { id: req.params.id });
  } catch (e) { sendError(res, e); }
});

/* ═══════════════════════════════════════════════════════
   INSPECTIONS
═══════════════════════════════════════════════════════ */
app.post('/api/inspections', async (req, res) => {
  const { id, client_id, date, notes = '', status = 'draft', urgent = false, inspNotes = '', scheduledDate = null } = req.body;
  if (!id || !client_id || !date) return sendError(res, 'id, client_id et date requis', 400);
  try {
    const rows = await query(
      `INSERT INTO inspections (id, client_id, inspection_date, notes, status, urgent, insp_notes, scheduled_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, client_id, date, notes, status, !!urgent, inspNotes, scheduledDate || null]
    );
    res.status(201).json(rows[0]);
    broadcast('inspections', 'create', rows[0]);
  } catch (e) { sendError(res, e); }
});

app.patch('/api/inspections/:id', async (req, res) => {
  /* Mappe camelCase JS → colonne PostgreSQL */
  const fieldMap = {
    date:          'inspection_date',
    scheduledDate: 'scheduled_date',
    notes:         'notes',
    status:        'status',
    urgent:        'urgent',
    inspNotes:     'insp_notes',
  };
  const sets = [], vals = [];
  for (const [jsKey, col] of Object.entries(fieldMap)) {
    if (req.body[jsKey] !== undefined) { sets.push(`${col} = $${sets.length + 1}`); vals.push(req.body[jsKey]); }
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  try {
    const rows = await query(
      `UPDATE inspections SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    res.json(rows[0]);
    broadcast('inspections', 'update', rows[0]);
  } catch (e) { sendError(res, e); }
});

app.delete('/api/inspections/:id', async (req, res) => {
  try {
    await query('DELETE FROM inspections WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    broadcast('inspections', 'delete', { id: req.params.id });
  } catch (e) { sendError(res, e); }
});

/* ═══════════════════════════════════════════════════════
   PHOTOS
═══════════════════════════════════════════════════════ */
app.post('/api/photos', async (req, res) => {
  const { id, inspection_id, sort_order = 0, lieu = '', probleme = '', solution = '' } = req.body;
  if (!id || !inspection_id) return sendError(res, 'id et inspection_id requis', 400);
  try {
    const rows = await query(
      `INSERT INTO inspection_photos (id, inspection_id, sort_order, lieu, probleme, solution)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, inspection_id, sort_order, lieu, probleme, solution]
    );
    res.status(201).json(rows[0]);
    broadcast('photos', 'create', rows[0]);
  } catch (e) { sendError(res, e); }
});

app.patch('/api/photos/:id', async (req, res) => {
  const fieldMap = {
    lieu:        'lieu',
    probleme:    'probleme',
    solution:    'solution',
    validated:   'validated',
    image:       'image_url',
    storagePath: 'storage_path',
    sort_order:  'sort_order',
  };
  const sets = [], vals = [];
  for (const [jsKey, col] of Object.entries(fieldMap)) {
    if (req.body[jsKey] !== undefined) { sets.push(`${col} = $${sets.length + 1}`); vals.push(req.body[jsKey]); }
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  try {
    const rows = await query(
      `UPDATE inspection_photos SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    res.json(rows[0]);
    broadcast('photos', 'update', rows[0]);
  } catch (e) { sendError(res, e); }
});

app.delete('/api/photos/:id', async (req, res) => {
  try {
    await query('DELETE FROM inspection_photos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    broadcast('photos', 'delete', { id: req.params.id });
  } catch (e) { sendError(res, e); }
});

/* ═══════════════════════════════════════════════════════
   DOCUMENTS
═══════════════════════════════════════════════════════ */
app.post('/api/documents', async (req, res) => {
  const {
    id, client_id = null, inspection_id = null,
    name, file_size = '', file_ext = '', status = 'none',
    storage_path = null, storage_url = null,
  } = req.body;
  if (!id || !name) return sendError(res, 'id et name requis', 400);
  if (!client_id && !inspection_id) return sendError(res, 'client_id ou inspection_id requis', 400);
  try {
    const rows = await query(
      `INSERT INTO documents
         (id, client_id, inspection_id, name, file_size, file_ext, status, storage_path, storage_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, client_id, inspection_id, name, file_size, file_ext, status, storage_path, storage_url]
    );
    res.status(201).json(rows[0]);
    broadcast('documents', 'create', rows[0]);
  } catch (e) { sendError(res, e); }
});

app.patch('/api/documents/:id', async (req, res) => {
  const fieldMap = { status: 'status', storage_path: 'storage_path', storage_url: 'storage_url' };
  const sets = [], vals = [];
  for (const [jsKey, col] of Object.entries(fieldMap)) {
    if (req.body[jsKey] !== undefined) { sets.push(`${col} = $${sets.length + 1}`); vals.push(req.body[jsKey]); }
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  try {
    const rows = await query(
      `UPDATE documents SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    res.json(rows[0]);
    broadcast('documents', 'update', rows[0]);
  } catch (e) { sendError(res, e); }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    await query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
    broadcast('documents', 'delete', { id: req.params.id });
  } catch (e) { sendError(res, e); }
});

/* ═══════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════ */
app.get('/api/config/:key', async (req, res) => {
  try {
    const rows = await query('SELECT value FROM config WHERE key = $1', [req.params.key]);
    res.json({ value: rows.length ? rows[0].value : null });
  } catch (e) { sendError(res, e); }
});

app.put('/api/config/:key', async (req, res) => {
  const { value } = req.body;
  if (value === undefined) return sendError(res, 'value requis', 400);
  try {
    const rows = await query(
      `INSERT INTO config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING *`,
      [req.params.key, JSON.stringify(value)]
    );
    res.json(rows[0]);
    broadcast('config', 'update', { key: req.params.key, value });
  } catch (e) { sendError(res, e); }
});

/* ═══════════════════════════════════════════════════════
   PLANNING NOTES
═══════════════════════════════════════════════════════ */
app.get('/api/planning-notes/:managerId', async (req, res) => {
  try {
    const rows = await query(
      `SELECT note_date::text, note FROM planning_notes WHERE manager_id = $1 ORDER BY note_date`,
      [req.params.managerId]
    );
    res.json(rows);
  } catch (e) { sendError(res, e); }
});

app.put('/api/planning-notes/:managerId/:date', async (req, res) => {
  const { note = '' } = req.body;
  try {
    const rows = await query(
      `INSERT INTO planning_notes (manager_id, note_date, note)
       VALUES ($1, $2, $3)
       ON CONFLICT (manager_id, note_date) DO UPDATE SET note = EXCLUDED.note
       RETURNING *`,
      [req.params.managerId, req.params.date, note]
    );
    res.json(rows[0]);
    broadcast('planning_notes', 'update', { managerId: req.params.managerId, date: req.params.date, note });
  } catch (e) { sendError(res, e); }
});

app.delete('/api/planning-notes/:managerId/:date', async (req, res) => {
  try {
    await query(
      `DELETE FROM planning_notes WHERE manager_id = $1 AND note_date = $2`,
      [req.params.managerId, req.params.date]
    );
    res.json({ ok: true });
    broadcast('planning_notes', 'delete', { managerId: req.params.managerId, date: req.params.date });
  } catch (e) { sendError(res, e); }
});


/* ═══════════════════════════════════════════════════════
   PORTAIL CLIENT
═══════════════════════════════════════════════════════ */

/* Route page portail client */
app.get('/client/:token', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client-portal.html'));
});

/* GET /api/portal/token/:clientId — récupère ou crée le token */
app.get('/api/portal/token/:clientId', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM client_tokens WHERE client_id = $1', [req.params.clientId]);
    if (rows.length) return res.json({ token: rows[0].token });
    const token = crypto.randomBytes(24).toString('hex');
    await query('INSERT INTO client_tokens (client_id, token) VALUES ($1, $2)', [req.params.clientId, token]);
    res.json({ token });
  } catch (e) { sendError(res, e); }
});

/* POST /api/portal/token/:clientId/regenerate — régénère le token */
app.post('/api/portal/token/:clientId/regenerate', async (req, res) => {
  try {
    const token = crypto.randomBytes(24).toString('hex');
    await query(
      `INSERT INTO client_tokens (client_id, token) VALUES ($1, $2)
       ON CONFLICT (client_id) DO UPDATE SET token = EXCLUDED.token, created_at = NOW()`,
      [req.params.clientId, token]
    );
    res.json({ token });
    broadcast('portal_token', 'regenerate', { clientId: req.params.clientId });
  } catch (e) { sendError(res, e); }
});

/* POST /api/portal/push/:inspectionId — push une inspection vers le portail */
app.post('/api/portal/push/:inspectionId', async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) return sendError(res, 'client_id requis', 400);
  try {
    await query(
      `INSERT INTO inspection_pushes (inspection_id, client_id)
       VALUES ($1, $2) ON CONFLICT (inspection_id) DO UPDATE SET pushed_at = NOW()`,
      [req.params.inspectionId, client_id]
    );
    res.json({ ok: true });
    broadcast('portal_push', 'create', { inspectionId: req.params.inspectionId, clientId: client_id });
  } catch (e) { sendError(res, e); }
});

/* DELETE /api/portal/push/:inspectionId — retire une inspection du portail */
app.delete('/api/portal/push/:inspectionId', async (req, res) => {
  try {
    await query('DELETE FROM inspection_pushes WHERE inspection_id = $1', [req.params.inspectionId]);
    res.json({ ok: true });
    broadcast('portal_push', 'delete', { inspectionId: req.params.inspectionId });
  } catch (e) { sendError(res, e); }
});

/* GET /api/portal/client/:token — données complètes pour le portail client */
app.get('/api/portal/client/:token', async (req, res) => {
  try {
    const tkRows = await query('SELECT * FROM client_tokens WHERE token = $1', [req.params.token]);
    if (!tkRows.length) return res.status(404).json({ error: 'Lien invalide ou expiré' });
    const clientId = tkRows[0].client_id;

    const [clients, inspections, photos, docs, pushes, feedbacks] = await Promise.all([
      query('SELECT * FROM clients WHERE id = $1', [clientId]),
      query('SELECT i.* FROM inspections i JOIN inspection_pushes p ON p.inspection_id = i.id WHERE p.client_id = $1 ORDER BY i.inspection_date DESC', [clientId]),
      query('SELECT ip.* FROM inspection_photos ip JOIN inspection_pushes p ON p.inspection_id = ip.inspection_id WHERE p.client_id = $1 ORDER BY ip.sort_order', [clientId]),
      query('SELECT d.* FROM documents d JOIN inspection_pushes p ON p.inspection_id = d.inspection_id WHERE p.client_id = $1', [clientId]),
      query('SELECT * FROM inspection_pushes WHERE client_id = $1', [clientId]),
      query('SELECT * FROM client_feedbacks WHERE client_id = $1', [clientId]),
    ]);

    if (!clients.length) return res.status(404).json({ error: 'Client introuvable' });
    const client = clients[0];

    res.json({
      client: { id: client.id, name: client.name, email: client.email, phone: client.phone, type: client.type, notes: client.notes },
      inspections: inspections.map(i => ({
        id: i.id, date: i.inspection_date, notes: i.notes, status: i.status,
        inspNotes: i.insp_notes,
        pushedAt: pushes.find(p => p.inspection_id === i.id)?.pushed_at,
        photos: photos.filter(p => p.inspection_id === i.id).map(mapPhoto),
        docs: docs.filter(d => d.inspection_id === i.id).map(mapDoc),
        feedback: feedbacks.find(f => f.inspection_id === i.id) ?? null,
      })),
    });
  } catch (e) { sendError(res, e); }
});

/* PUT /api/portal/feedback/:inspectionId — soumettre / modifier un feedback */
app.put('/api/portal/feedback/:inspectionId', async (req, res) => {
  const { client_id, rating, propre, ponctuel, efficace, comment = '' } = req.body;
  if (!client_id) return sendError(res, 'client_id requis', 400);
  try {
    const rows = await query(
      `INSERT INTO client_feedbacks (inspection_id, client_id, rating, propre, ponctuel, efficace, comment, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (inspection_id) DO UPDATE SET
         rating = EXCLUDED.rating, propre = EXCLUDED.propre, ponctuel = EXCLUDED.ponctuel,
         efficace = EXCLUDED.efficace, comment = EXCLUDED.comment, updated_at = NOW()
       RETURNING *`,
      [req.params.inspectionId, client_id, rating, propre, ponctuel, efficace, comment]
    );
    res.json(rows[0]);
    broadcast('portal_feedback', 'upsert', { inspectionId: req.params.inspectionId, clientId: client_id });
  } catch (e) { sendError(res, e); }
});

/* GET /api/portal/admin — vue admin : tous les clients avec stats portail */
app.get('/api/portal/admin', async (_req, res) => {
  try {
    const [clients, tokens, pushes, feedbacks] = await Promise.all([
      query('SELECT * FROM clients ORDER BY name'),
      query('SELECT * FROM client_tokens'),
      query('SELECT * FROM inspection_pushes'),
      query('SELECT * FROM client_feedbacks ORDER BY updated_at DESC'),
    ]);

    const data = clients.map(c => {
      const token = tokens.find(t => t.client_id === c.id);
      const clientPushes = pushes.filter(p => p.client_id === c.id);
      const clientFeedbacks = feedbacks.filter(f => f.client_id === c.id);
      const lastFeedback = clientFeedbacks[0] ?? null;
      return {
        id: c.id, name: c.name, email: c.email, phone: c.phone, type: c.type,
        token: token?.token ?? null,
        portalActive: !!token,
        pushedCount: clientPushes.length,
        feedbackCount: clientFeedbacks.length,
        lastFeedbackAt: lastFeedback?.updated_at ?? null,
        lastRating: lastFeedback?.rating ?? null,
        feedbacks: clientFeedbacks,
      };
    });

    res.json(data);
  } catch (e) { sendError(res, e); }
});

/* ── Start ──────────────────────────────────────────────────────────── */
const PORT = process.env.PORT ?? 3001;
app.listen(PORT, async () => {
  try {
    await pool.query('SELECT 1');
    _log('[pg]  Connecté à PostgreSQL');
  } catch (e) {
    _err(`[pg]  Connexion échouée : ${e.message}`);
    process.exit(1);
  }
  // Crée les tables si elles n'existent pas
  await query(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value JSONB)`);
  await query(`CREATE TABLE IF NOT EXISTS planning_notes (
    id          SERIAL PRIMARY KEY,
    manager_id  TEXT NOT NULL,
    note_date   DATE NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    UNIQUE(manager_id, note_date)
  )`);
  // scheduled_date et index créés via migration superuser (inspectflow n'est pas owner)
  _log('[pg]  Tables OK');
  _log(`API      →  http://localhost:${PORT}/api/data`);
  _log(`SSE      →  http://localhost:${PORT}/api/events`);
  _log(`Dashboard →  http://localhost:${PORT}/dashboard.html`);
});
