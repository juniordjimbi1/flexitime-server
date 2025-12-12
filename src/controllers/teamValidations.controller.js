const { query: db } = require('../config/db');

async function getRoleCode(userId) {
  const r = await db(`SELECT r.code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? LIMIT 1`, [userId]);
  return r?.[0]?.code || null;
}

/** GET /team-validations/pending  (ADMIN uniquement) */
async function listPending(req, res) {
  const role = await getRoleCode(req.user.id);
  if (role !== 'ADMIN') return res.status(403).json({ success:false, message:'Accès refusé' });

  const rows = await db(`
    SELECT v.id, v.team_close_id, v.validator_user_id, v.status, v.created_at,
           tc.team_id, tc.manager_user_id, tc.close_date, tc.members_total, tc.members_submitted,
           tc.tasks_done_total, tc.total_minutes, tc.comment AS manager_comment,
           t.name AS team_name,
           m.first_name AS mgr_first, m.last_name AS mgr_last, m.email AS mgr_email,
           (SELECT COUNT(*) FROM team_close_files f WHERE f.team_close_id = v.team_close_id) AS file_count
    FROM team_close_validations v
    JOIN team_closes tc ON tc.id = v.team_close_id
    JOIN teams t ON t.id = tc.team_id
    JOIN users m ON m.id = tc.manager_user_id
    WHERE v.status = 'PENDING'
    ORDER BY v.created_at ASC
  `);

  res.json({ success:true, data: rows || [] });
}

/** POST /team-validations/:id/decision  { status, comment? }  (ADMIN) */
async function decide(req, res) {
  const role = await getRoleCode(req.user.id);
  if (role !== 'ADMIN') return res.status(403).json({ success:false, message:'Accès refusé' });

  const id = Number(req.params.id || 0);
  const { status, comment = null } = req.body || {};
  if (!['APPROVED','REJECTED'].includes(status)) {
    return res.status(400).json({ success:false, message:'Statut invalide' });
  }

  const row = await db(`SELECT id FROM team_close_validations WHERE id=?`, [id]);
  if (!row?.[0]) return res.status(404).json({ success:false, message:'Validation introuvable' });

  await db(
    `UPDATE team_close_validations
        SET status=?, comment=?, decided_at=NOW()
      WHERE id=?`,
    [status, comment || null, id]
  );

  const updated = await db(`SELECT * FROM team_close_validations WHERE id=?`, [id]);
  res.json({ success:true, data: updated?.[0] || null });
}

module.exports = { listPending, decide };
