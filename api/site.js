import { get, put } from '@vercel/blob';
import { Readable } from 'node:stream';
import { scryptSync, timingSafeEqual } from 'node:crypto';

const SALT = '33ac03d6ba46af748698b0d8d9b2f006';
const HASH = 'c373f109dd1d1cbfa06a3e2df490ae374e4f2cc0a495d2a11287944cc8240019';
const PHOTO = /^\/api\/site\?p=photos\/[A-Za-z0-9._-]+\.jpg$/;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function passwordOk(pw) {
  if (process.env.EDIT_PASSWORD) {
    const a = Buffer.from(norm(pw));
    const b = Buffer.from(norm(process.env.EDIT_PASSWORD));
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return timingSafeEqual(scryptSync(norm(pw), SALT, 32), Buffer.from(HASH, 'hex'));
}

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query && req.query.p) {
    const p = String(req.query.p);
    if (!/^photos\/[A-Za-z0-9._-]+\.jpg$/.test(p)) return res.status(400).send('bad');
    const r = await get(p, { access: 'private' });
    if (!r || r.statusCode !== 200) return res.status(404).send('not found');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return Readable.fromWeb(r.stream).pipe(res);
  }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const r = await get('state.json', { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200) return res.status(200).json({});
      return res.status(200).json(JSON.parse(await new Response(r.stream).text()));
    } catch (e) {
      return res.status(200).json({});
    }
  }

  if (req.method !== 'POST') return res.status(405).end();
  const { password, state } = req.body || {};
  if (!passwordOk(password)) return res.status(401).json({ error: 'bad password' });
  if (!state) return res.status(400).json({ error: 'no state' });

  const out = { events: [], records: [] };
  for (const e of (state.events || []).slice(0, 300)) {
    out.events.push({
      id: String(e.id || '').slice(0, 40),
      d: String(e.d || '').slice(0, 10),
      time: String(e.time || '').slice(0, 40),
      p: String(e.p || '').slice(0, 60),
    });
  }
  for (const r of (state.records || []).slice(0, 300)) {
    const imgs = [];
    for (const u of (r.imgs || []).slice(0, 12)) {
      if (typeof u !== 'string') continue;
      if (u.startsWith('data:image/jpeg;base64,')) {
        const buf = Buffer.from(u.split(',')[1], 'base64');
        if (buf.length > 3000000) continue;
        const b = await put('photos/photo.jpg', buf, {
          access: 'private',
          addRandomSuffix: true,
          contentType: 'image/jpeg',
        });
        imgs.push('/api/site?p=' + b.pathname);
      } else if (PHOTO.test(u)) {
        imgs.push(u);
      }
    }
    out.records.push({
      id: String(r.id || '').slice(0, 40),
      date: String(r.date || '').slice(0, 10),
      text: String(r.text || '').slice(0, 300),
      imgs,
    });
  }
  await put('state.json', JSON.stringify(out), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
  return res.status(200).json({ state: out });
}
