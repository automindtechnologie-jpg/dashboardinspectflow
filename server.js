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
import { fileURLToPath } from 'url';
import path           from 'path';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── Pool PostgreSQL ────────────────────────────────────────────────── */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => console.error('[pg] Unexpected error:', err));

/* Wrapper : exécute une requête et retourne les rows */
async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

/* ── Express ────────────────────────────────────────────────────────── */
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
                id:        i.id,
                date:      i.inspection_date,
                notes:     i.notes,
                status:    i.status,
                urgent:    i.urgent,
                inspNotes: i.insp_notes,
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
  } catch (e) { sendError(res, e); }
});

app.delete('/api/managers/:id', async (req, res) => {
  try {
    await query('DELETE FROM managers WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
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
  } catch (e) { sendError(res, e); }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    await query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

/* ═══════════════════════════════════════════════════════
   INSPECTIONS
═══════════════════════════════════════════════════════ */
app.post('/api/inspections', async (req, res) => {
  const { id, client_id, date, notes = '', status = 'draft', urgent = false, inspNotes = '' } = req.body;
  if (!id || !client_id || !date) return sendError(res, 'id, client_id et date requis', 400);
  try {
    const rows = await query(
      `INSERT INTO inspections (id, client_id, inspection_date, notes, status, urgent, insp_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, client_id, date, notes, status, !!urgent, inspNotes]
    );
    res.status(201).json(rows[0]);
  } catch (e) { sendError(res, e); }
});

app.patch('/api/inspections/:id', async (req, res) => {
  /* Mappe camelCase JS → colonne PostgreSQL */
  const fieldMap = {
    date:      'inspection_date',
    notes:     'notes',
    status:    'status',
    urgent:    'urgent',
    inspNotes: 'insp_notes',
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
  } catch (e) { sendError(res, e); }
});

app.delete('/api/inspections/:id', async (req, res) => {
  try {
    await query('DELETE FROM inspections WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
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
  } catch (e) { sendError(res, e); }
});

app.delete('/api/photos/:id', async (req, res) => {
  try {
    await query('DELETE FROM inspection_photos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
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
  } catch (e) { sendError(res, e); }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    await query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

/* ── Start ──────────────────────────────────────────────────────────── */
const PORT = process.env.PORT ?? 3001;
app.listen(PORT, async () => {
  try {
    await pool.query('SELECT 1');
    console.log(`[pg]  Connecté à PostgreSQL`);
  } catch (e) {
    console.error('[pg]  Connexion échouée :', e.message);
    process.exit(1);
  }
  console.log(`API      →  http://localhost:${PORT}/api/data`);
  console.log(`Dashboard →  http://localhost:${PORT}/dashboard.html`);
});
