const path = require('path');
const { query: db } = require('../config/db');

async function upload(req, res) {
  const uid = req.user.id;
  const dayCloseId = Number(req.params.id || 0);
  if (!req.file) return res.status(400).json({ success: false, message: 'Fichier PDF requis' });

  const rows = await db(`SELECT id FROM day_closes WHERE id=? AND user_id=?`, [dayCloseId, uid]);
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Clôture introuvable' });

  const { filename, originalname, mimetype, size } = req.file;
  await db(
    `INSERT INTO day_close_files (day_close_id, filename, original_name, mime, size, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [dayCloseId, filename, originalname, mimetype, size]
  );

  res.status(201).json({
    success: true,
    data: {
      filename,
      original_name: originalname,
      url: `/api/day-close/files/${filename}`,
      size,
      mime: mimetype
    }
  });
}

async function serve(req, res) {
  const filename = req.params.filename;
  const rows = await db(`SELECT id FROM day_close_files WHERE filename=?`, [filename]);
  if (!rows[0]) return res.status(404).send('Not found');

  const { baseDir } = require('../utils/uploader');
  const filePath = path.join(baseDir, filename);
  return res.sendFile(filePath);
}

async function listByClose(req, res) {
  const dayCloseId = Number(req.params.id || 0);
  const files = await db(
    `SELECT id, original_name, filename, size, mime, created_at
       FROM day_close_files
      WHERE day_close_id=?
      ORDER BY created_at ASC`,
    [dayCloseId]
  );
  res.json({ success: true, data: files || [] });
}

module.exports = { upload, serve, listByClose };
