const { query: db } = require('../config/db');

async function getRoleCode(userId) {
  const rows = await db(`
    SELECT r.code
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
    LIMIT 1
  `, [userId]);
  return (rows && rows[0] && rows[0].code) || null;
}

async function pickValidatorForUser(userId) {
  const mgr = await db(`
    SELECT t.manager_user_id AS id
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ? AND t.manager_user_id IS NOT NULL
    LIMIT 1
  `, [userId]);
  if (mgr && mgr[0] && mgr[0].id) return mgr[0].id;

  const adm = await db(`
    SELECT u.id
    FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.code='ADMIN'
    ORDER BY u.id
    LIMIT 1
  `);
  return (adm && adm[0] && adm[0].id) || null;
}

/** POST /validations/submit { day_close_id?, date? } */
async function submit(req, res) {
  const uid = req.user.id;
  const { day_close_id = null, date = null } = req.body || {};

  let close;
  if (day_close_id) {
    const rows = await db(`SELECT * FROM day_closes WHERE id=? AND user_id=?`, [day_close_id, uid]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Clôture introuvable' });
    close = rows[0];
  } else {
    const rows = await db(
      `SELECT * FROM day_closes WHERE user_id=? AND close_date = COALESCE(?, CURDATE())`,
      [uid, date]
    );
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Aucune clôture trouvée pour ce jour' });
    close = rows[0];
  }

  const exists = await db(`SELECT * FROM day_close_validations WHERE day_close_id=?`, [close.id]);
  if (exists && exists[0]) {
    const cur = exists[0];
    if (cur.status !== 'PENDING') {
      await db(`
        UPDATE day_close_validations
           SET status='PENDING', comment=NULL, decided_at=NULL
         WHERE id=?
      `, [cur.id]);
      return res.json({ success: true, message: 'Re-soumise', data: { id: cur.id } });
    }
    return res.json({ success: true, message: 'Déjà soumise', data: { id: cur.id } });
  }

  const validatorId = await pickValidatorForUser(uid);
  const result = await db(
    `INSERT INTO day_close_validations (day_close_id, validator_user_id, status, created_at)
     VALUES (?, ?, 'PENDING', NOW())`,
    [close.id, validatorId]
  );

  return res.status(201).json({ success: true, data: { id: result.insertId, validator_user_id: validatorId } });
}

/** GET /validations/pending — ADMIN: tout, MANAGER: son équipe */
async function listPending(req, res) {
  const meId = req.user.id;
  const role = await getRoleCode(meId);

  let rows;
  if (role === 'ADMIN') {
    rows = await db(`
      SELECT v.id, v.day_close_id, v.validator_user_id, v.status, v.created_at,
             dc.user_id, dc.close_date, dc.total_minutes, dc.tasks_done,
             dc.comment AS employee_comment,
             u.first_name, u.last_name, u.email,
             (SELECT COUNT(*) FROM day_close_files f WHERE f.day_close_id = v.day_close_id) AS file_count
      FROM day_close_validations v
      JOIN day_closes dc ON dc.id = v.day_close_id
      JOIN users u ON u.id = dc.user_id
      WHERE v.status='PENDING'
      ORDER BY v.created_at ASC
    `);
  } else if (role === 'MANAGER') {
    rows = await db(`
      SELECT v.id, v.day_close_id, v.validator_user_id, v.status, v.created_at,
             dc.user_id, dc.close_date, dc.total_minutes, dc.tasks_done,
             dc.comment AS employee_comment,
             u.first_name, u.last_name, u.email,
             (SELECT COUNT(*) FROM day_close_files f WHERE f.day_close_id = v.day_close_id) AS file_count
      FROM day_close_validations v
      JOIN day_closes dc ON dc.id = v.day_close_id
      JOIN users u ON u.id = dc.user_id
      WHERE v.status='PENDING'
        AND EXISTS (
          SELECT 1
          FROM team_members tm
          JOIN teams t ON t.id = tm.team_id
          WHERE tm.user_id = dc.user_id
            AND t.manager_user_id = ?
        )
      ORDER BY v.created_at ASC
    `, [meId]);
  } else {
    return res.status(403).json({ success: false, message: 'Accès refusé' });
  }

  res.json({ success: true, data: rows || [] });
}

/** POST /validations/:id/decision { status, comment? } */
async function decide(req, res) {
  const meId = req.user.id;
  const role = await getRoleCode(meId);

  const id = Number(req.params.id);
  const { status, comment = null } = req.body || {};
  if (!['APPROVED','REJECTED'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Statut invalide' });
  }

  const rows = await db(`
    SELECT v.*, dc.user_id
    FROM day_close_validations v
    JOIN day_closes dc ON dc.id = v.day_close_id
    WHERE v.id = ?
  `, [id]);
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Validation introuvable' });

  if (role === 'MANAGER') {
    const ok = await db(`
      SELECT 1
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ? AND t.manager_user_id = ?
      LIMIT 1
    `, [rows[0].user_id, meId]);
    if (!ok[0]) return res.status(403).json({ success: false, message: 'Hors de votre périmètre équipe' });
  } else if (role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'Accès refusé' });
  }

  await db(
    `UPDATE day_close_validations
       SET status = ?, comment = ?, decided_at = NOW()
     WHERE id = ?`,
    [status, comment || null, id]
  );

  const updated = await db(`
    SELECT v.*, dc.user_id, dc.close_date
    FROM day_close_validations v
    JOIN day_closes dc ON dc.id = v.day_close_id
    WHERE v.id = ?
  `, [id]);

  res.json({ success: true, data: updated[0] });
}

/** GET /validations/today/status — statut employé du jour */
async function todayStatus(req, res) {
  const uid = req.user.id;
  const dc = await db(`SELECT * FROM day_closes WHERE user_id=? AND close_date=CURDATE()`, [uid]);
  if (!dc[0]) return res.json({ success: true, data: null });

  const v = await db(`SELECT * FROM day_close_validations WHERE day_close_id=?`, [dc[0].id]);
  const files = await db(`SELECT id, original_name, filename, size, mime, created_at FROM day_close_files WHERE day_close_id=?`, [dc[0].id]);

  res.json({
    success: true,
    data: { close: dc[0], validation: v[0] || null, files: files || [] }
  });
}

module.exports = { submit, listPending, decide, todayStatus };
