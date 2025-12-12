const { query: db } = require('../config/db');

function iso(d) {
  try { return new Date(d).toISOString().slice(0,10); } catch { return null; }
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function myHistory(req, res) {
  const uid = req.user.id;
  const from = req.query.from ? iso(req.query.from) : null;
  const to   = req.query.to   ? iso(req.query.to)   : null;
  const status = (req.query.status || '').toUpperCase(); // PENDING | APPROVED | REJECTED | (vide)

  const where = ['dc.user_id = ?'];
  const params = [uid];

  if (from) { where.push('dc.close_date >= ?'); params.push(from); }
  if (to)   { where.push('dc.close_date <= ?'); params.push(to); }
  if (['PENDING','APPROVED','REJECTED'].includes(status)) {
    where.push('v.status = ?'); params.push(status);
  }

  const rows = await db(`
    SELECT dc.id, dc.close_date, dc.closed_at,
           dc.total_minutes, dc.tasks_done,
           dc.summary AS employee_comment,  -- si la colonne n'existe pas, renverra NULL
           v.status AS validation_status,
           v.comment AS validator_comment
    FROM day_closes dc
    LEFT JOIN day_close_validations v ON v.day_close_id = dc.id
    WHERE ${where.join(' AND ')}
    ORDER BY dc.close_date DESC, dc.id DESC
  `, params);

  res.json({ success: true, data: rows || [] });
}

async function myHistoryCsv(req, res) {
  const uid = req.user.id;
  const from = req.query.from ? iso(req.query.from) : null;
  const to   = req.query.to   ? iso(req.query.to)   : null;
  const status = (req.query.status || '').toUpperCase();

  const where = ['dc.user_id = ?'];
  const params = [uid];
  if (from) { where.push('dc.close_date >= ?'); params.push(from); }
  if (to)   { where.push('dc.close_date <= ?'); params.push(to); }
  if (['PENDING','APPROVED','REJECTED'].includes(status)) {
    where.push('v.status = ?'); params.push(status);
  }

  const rows = await db(`
    SELECT dc.close_date, dc.total_minutes, dc.tasks_done,
           v.status AS validation_status, v.comment AS validator_comment,
           dc.summary AS employee_comment
    FROM day_closes dc
    LEFT JOIN day_close_validations v ON v.day_close_id = dc.id
    WHERE ${where.join(' AND ')}
    ORDER BY dc.close_date DESC, dc.id DESC
  `, params);

  const header = [
    'Date',
    'Temps (minutes)',
    'Tâches DONE',
    'Statut validation',
    'Commentaire validateur',
    'Résumé employé'
  ];
  const lines = [header.map(csvEscape).join(',')];

  for (const r of (rows || [])) {
    lines.push([
      csvEscape(r.close_date || ''),
      csvEscape(r.total_minutes || 0),
      csvEscape(r.tasks_done || 0),
      csvEscape(r.validation_status || ''),
      csvEscape(r.validator_comment || ''),
      csvEscape(r.employee_comment || '')
    ].join(','));
  }

  const csv = lines.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="historique_${uid}.csv"`);
  res.send(csv);
}

module.exports = { myHistory, myHistoryCsv };
