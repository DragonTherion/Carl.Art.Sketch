require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(__dirname, '.'), {
  setHeaders(res, fp) {
    /* evitar caché de obras.json para que el público vea siempre lo último */
    if (fp.endsWith('obras.json') || fp.endsWith('opciones.json')) res.setHeader('Cache-Control', 'no-store');
  }
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')) ? false : { rejectUnauthorized: false }
});

/* ---------- utilidades de mapeo fila -> obra ---------- */
function rowToWork(w) {
  return {
    id: w.id, title: w.title, desc: w.desc, img: w.img,
    year: w.year || '', paper: w.paper || '',
    cats: Array.isArray(w.cats) ? w.cats : (typeof w.cats === 'string' ? JSON.parse(w.cats || '[]') : []),
    techs: Array.isArray(w.techs) ? w.techs : (typeof w.techs === 'string' ? JSON.parse(w.techs || '[]') : []),
    palette: Array.isArray(w.palette) ? w.palette : (typeof w.palette === 'string' ? JSON.parse(w.palette || '[]') : []),
    file: w.file || '', num: w.num || '', copy: w.copy || '', dim: w.dim || '',
    kb: Number(w.kb) || 0,
    insignia: w.insignia === 'dorada' ? 'dorada' : 'normal',
    premium: !!w.premium, fit: w.fit === 'contain' ? 'contain' : 'cover',
    created: Number(w.created) || Date.now()
  };
}

const WORKS_COLS = 'id, title, "desc", img, year, paper, cats, techs, palette, file, num, copy, dim, kb, insignia, premium, fit, created';
const WORKS_PH = '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)';
function workParams(w) {
  return [
    String(w.id).slice(0, 40), String(w.title || '').slice(0, 200), String(w.desc || '').slice(0, 2000),
    String(w.img || ''), String(w.year || '').slice(0, 12), String(w.paper || '').slice(0, 120),
    JSON.stringify(Array.isArray(w.cats) ? w.cats : []),
    JSON.stringify(Array.isArray(w.techs) ? w.techs : []),
    JSON.stringify(Array.isArray(w.palette) ? w.palette : []),
    String(w.file || '').slice(0, 160), String(w.num || '').slice(0, 24), String(w.copy || '').slice(0, 200),
    String(w.dim || '').slice(0, 30), Number(w.kb) || 0,
    w.insignia === 'dorada' ? 'dorada' : 'normal', !!w.premium,
    w.fit === 'contain' ? 'contain' : 'cover', Number(w.created) || Date.now()
  ];
}

/* ---------- crear tablas + importar data/obras.json la primera vez ---------- */
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'CARL ART SKETCHES',
      sub TEXT NOT NULL DEFAULT '',
      copy TEXT NOT NULL DEFAULT '',
      updated BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS admin_auth (
      id SERIAL PRIMARY KEY,
      algorithm TEXT NOT NULL DEFAULT 'bcrypt',
      password_hash TEXT NOT NULL,
      salt TEXT,
      it INT
    );
    CREATE TABLE IF NOT EXISTS works (
      id VARCHAR(40) PRIMARY KEY,
      title TEXT, "desc" TEXT, img TEXT,
      year VARCHAR(12), paper TEXT,
      cats JSONB NOT NULL DEFAULT '[]',
      techs JSONB NOT NULL DEFAULT '[]',
      palette JSONB NOT NULL DEFAULT '[]',
      file VARCHAR(160), num VARCHAR(24), copy TEXT,
      dim VARCHAR(30), kb NUMERIC NOT NULL DEFAULT 0,
      insignia VARCHAR(20) NOT NULL DEFAULT 'normal',
      premium BOOLEAN NOT NULL DEFAULT false,
      fit VARCHAR(20) NOT NULL DEFAULT 'cover',
      created BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_works_created ON works (created DESC);
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM site_settings');
  if (rows[0].n === 0) {
    const obrasPath = path.join(__dirname, 'data', 'obras.json');
    let data = { site: { title: 'CARL ART SKETCHES', sub: '', copy: '' }, works: [] };
    if (fs.existsSync(obrasPath)) {
      try { data = JSON.parse(fs.readFileSync(obrasPath, 'utf8')); } catch (e) { console.error('No se pudo leer data/obras.json:', e.message); }
    }
    await pool.query('INSERT INTO site_settings (title, sub, copy, updated) VALUES ($1,$2,$3,$4)',
      [(data.site && data.site.title) || 'CARL ART SKETCHES', (data.site && data.site.sub) || '', (data.site && data.site.copy) || '', data.updated || Date.now()]);
    const works = Array.isArray(data.works) ? data.works : [];
    for (const w of works) {
      await pool.query(`INSERT INTO works (${WORKS_COLS}) VALUES ${WORKS_PH} ON CONFLICT (id) DO NOTHING`, workParams(w));
    }
    console.log(`Importadas ${works.length} obras desde data/obras.json`);
    console.log('Base de datos inicializada correctamente.');
  }
}

initDB().catch(e => {
  console.error('FATAL: no se pudo inicializar la base de datos.');
  console.error(e.message);
  process.exit(1);
});

/* ---- API publica ---- */
app.get('/api/gallery', async (req,res) => {
  try {
    const sRes = await pool.query('SELECT title, sub, copy, updated FROM site_settings LIMIT 1');
    const wRes = await pool.query('SELECT * FROM works ORDER BY created DESC, id ASC');
    const site = sRes.rows[0] || { title: 'CARL ART SKETCHES', sub: '', copy: '', updated: Date.now() };
    const works = wRes.rows.map(rowToWork);
    res.json({ updated: Number(site.updated) || Date.now(), site: { title: site.title, sub: site.sub, copy: site.copy }, works });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno del servidor' }); }
});

app.post('/api/gallery', async (req,res) => {
  try {
    const { site, works } = req.body || {};
    const now = Date.now();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM site_settings');
      await client.query('INSERT INTO site_settings (title, sub, copy, updated) VALUES ($1,$2,$3,$4)',
        [(site && site.title) || 'CARL ART SKETCHES', (site && site.sub) || '', (site && site.copy) || '', now]);
      await client.query('DELETE FROM works');
      const list = Array.isArray(works) ? works : [];
      for (const w of list) {
        await client.query(`INSERT INTO works (${WORKS_COLS}) VALUES ${WORKS_PH}`, workParams(w));
      }
      await client.query('COMMIT');
      res.json({ ok: true, updated: now, works: list.length });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al guardar en la base de datos' }); }
});

/* ---- autenticacion de administrador ---- */
app.post('/api/auth/verify', async (req,res) => {
  try {
    const { password } = req.body || {};
    if (typeof password !== 'string' || !password.length) return res.status(400).json({ ok: false });
    const { rows } = await pool.query('SELECT * FROM admin_auth LIMIT 1');
    if (!rows.length) {
      /* primera vez: se crea la cuenta de administrador */
      if (password.length < 12) return res.status(400).json({ ok: false, create: true, error: 'La contraseña debe tener 12 o más caracteres.' });
      const hash = await bcrypt.hash(password, 10);
      await pool.query('INSERT INTO admin_auth (algorithm, password_hash) VALUES ($1,$2)', ['bcrypt', hash]);
      return res.json({ ok: true, created: true });
    }
    const a = rows[0];
    let good = false;
    if (a.algorithm === 'bcrypt') good = await bcrypt.compare(password, a.password_hash);
    else {
      const crypto = require('crypto');
      const hash = crypto.pbkdf2Sync(password, a.salt, a.it || 310000, 32, 'sha256').toString('hex');
      good = hash === a.password_hash;
    }
    res.json({ ok: good });
  } catch (err) { console.error(err); res.status(500).json({ ok: false }); }
});

app.post('/api/auth/password', async (req,res) => {
  try {
    const { password } = req.body || {};
    if (typeof password !== 'string' || password.length < 12) return res.status(400).json({ ok: false, error: 'La contraseña debe tener 12 o más caracteres.' });
    const hash = await bcrypt.hash(password, 10);
    await pool.query('DELETE FROM admin_auth');
    await pool.query('INSERT INTO admin_auth (algorithm, password_hash) VALUES ($1,$2)', ['bcrypt', hash]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ ok: false }); }
});

