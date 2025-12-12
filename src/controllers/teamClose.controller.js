const path = require('path');
const fs = require('fs');
const { query: db } = require('../config/db');

function iso(d) { return new Date(d).toISOString().slice(0,10); }

async function getRoleCode(userId) {
  const r = await db(`SELECT r.code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? LIMIT 1`, [userId]);
  return r?.[0]?.code || null;
}
async function assertManagerOwnsTeam(managerId, teamId) {
  const r = await db(`SELECT id FROM teams WHERE id=? AND manager_user_id=?`, [teamId, managerId]);
  return !!(r && r[0]);
}
async function firstAdminId() {
  const r = await db(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='ADMIN' ORDER BY u.id LIMIT 1`);
  return r?.[0]?.id || null;
}

async function preview(req, res) {
  const me = req.user.id;
  const role = await getRoleCode(me);
  const teamId = Number(req.query.team_id || 0);
  const date = req.query.date ? iso(req.query.date) : iso(new Date());

  if (!teamId) return res.status(400).json({ success:false, message:'team_id requis' });
  if (role === 'MANAGER') {
    const ok = await assertManagerOwnsTeam(me, teamId);
    if (!ok) return res.status(403).json({ success:false, message:'Accès refusé' });
  } else if (role !== 'ADMIN') {
    return res.status(403).json({ success:false, message:'Accès refusé' });
  }

  // Membres de l’équipe
  const members = await db(`
    SELECT u.id, u.first_name, u.last_name, u.email
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id=?
    ORDER BY u.last_name, u.first_name
  `, [teamId]);

  const membersIds = members.map(m => m.id);
  const membersTotal = membersIds.length;

  // Closes individuelles du jour
  let submitted = [];
  let agg = { minutes: 0, tasks: 0 };
  if (membersIds.length) {
    const inIds = membersIds.map(()=>'?').join(',');
    submitted = await db(
      `
      SELECT dc.id, dc.user_id, dc.close_date, dc.closed_at, dc.total_minutes, dc.tasks_done,
             v.status AS validation_status
      FROM day_closes dc
      LEFT JOIN day_close_validations v ON v.day_close_id = dc.id
      WHERE dc.user_id IN (${inIds}) AND dc.close_date = ?
      `,
      [...membersIds, date]
    );

    for (const r of (submitted || [])) {
      agg.minutes += Number(r.total_minutes || 0);
      agg.tasks   += Number(r.tasks_done || 0);
    }
  }

  // Clôture d'équipe existante ?
  const existing = await db(
    `SELECT * FROM team_closes WHERE team_id=? AND close_date=? LIMIT 1`,
    [teamId, date]
  );
  let teamClose = existing?.[0] || null;

  // Fichiers et validation existants
  let files = [];
  let validation = null;
  if (teamClose) {
    files = await db(`SELECT id, original_name, filename, size, mime, created_at FROM team_close_files WHERE team_close_id=? ORDER BY id DESC`, [teamClose.id]);
    const v = await db(`SELECT * FROM team_close_validations WHERE team_close_id=? LIMIT 1`, [teamClose.id]);
    validation = v?.[0] || null;
  }

  res.json({
    success: true,
    data: {
      team_close: teamClose,
      date,
      members_total: membersTotal,
      members_submitted: submitted.length,
      total_minutes: agg.minutes,
      tasks_done_total: agg.tasks,
      submitted, // liste des closes individuelles
      files,
      validation
    }
  });
}

async function upsertClose(teamId, managerId, date, comment) {
  // Calcul agrégé du jour
  const members = await db(
    `SELECT user_id FROM team_members WHERE team_id=? ORDER BY user_id`,
    [teamId]
  );
  const ids = (members || []).map(r => r.user_id);
  const membersTotal = ids.length;

  let submitted = [];
  let totalMinutes = 0;
  let tasksDone = 0;

  if (ids.length) {
    const inIds = ids.map(()=>'?').join(',');
    submitted = await db(
      `SELECT total_minutes, tasks_done FROM day_closes WHERE user_id IN (${inIds}) AND close_date=?`,
      [...ids, date]
    );
    for (const r of (submitted || [])) {
      totalMinutes += Number(r.total_minutes || 0);
      tasksDone    += Number(r.tasks_done || 0);
    }
  }

  const membersSubmitted = submitted.length;

  // Upsert team_closes
  const exists = await db(`SELECT id FROM team_closes WHERE team_id=? AND close_date=? LIMIT 1`, [teamId, date]);
  if (exists?.[0]) {
    const id = exists[0].id;
    await db(
      `UPDATE team_closes
          SET members_total=?, members_submitted=?, tasks_done_total=?, total_minutes=?, comment=?, closed_at=NOW(), updated_at=NOW()
        WHERE id=?`,
      [membersTotal, membersSubmitted, tasksDone, totalMinutes, comment || null, id]
    );
    const r = await db(`SELECT * FROM team_closes WHERE id=?`, [id]);
    return r?.[0] || null;
  } else {
    const ins = await db(
      `INSERT INTO team_closes (team_id, manager_user_id, close_date, members_total, members_submitted, tasks_done_total, total_minutes, comment, closed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [teamId, managerId, date, membersTotal, membersSubmitted, tasksDone, totalMinutes, comment || null]
    );
    const r = await db(`SELECT * FROM team_closes WHERE id=?`, [ins.insertId]);
    return r?.[0] || null;
  }
}

// POST /manager/team-close  { team_id, date?, comment? }  → upsert + créer/MAJ validation(PENDING)
async function closeTeam(req, res) {
  const me = req.user.id;
  const role = await getRoleCode(me);
  const { team_id, date = null, comment = null } = req.body || {};
  const teamId = Number(team_id || 0);
  const day = date ? iso(date) : iso(new Date());

  if (!teamId) return res.status(400).json({ success:false, message:'team_id requis' });
  if (role === 'MANAGER') {
    const ok = await assertManagerOwnsTeam(me, teamId);
    if (!ok) return res.status(403).json({ success:false, message:'Accès refusé' });
  } else if (role !== 'ADMIN') {
    return res.status(403).json({ success:false, message:'Accès refusé' });
  }

  const tc = await upsertClose(teamId, me, day, comment);

  // upsert validation → PENDING vers Admin
  const v = await db(`SELECT id, status FROM team_close_validations WHERE team_close_id=?`, [tc.id]);
  if (v?.[0]) {
    if (v[0].status !== 'PENDING') {
      await db(`UPDATE team_close_validations SET status='PENDING', comment=NULL, decided_at=NULL WHERE id=?`, [v[0].id]);
    }
  } else {
    const adminId = await firstAdminId();
    await db(
      `INSERT INTO team_close_validations (team_close_id, validator_user_id, status, created_at)
       VALUES (?, ?, 'PENDING', NOW())`,
      [tc.id, adminId]
    );
  }

  const fresh = await db(`SELECT * FROM team_closes WHERE id=?`, [tc.id]);
  res.status(201).json({ success:true, data: fresh?.[0] || null });
}

/** ===== FICHIERS (uploads) ===== */

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'team_closes');
function ensureDir() { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); }

async function listFiles(req, res) {
  const me = req.user.id;
  const role = await getRoleCode(me);
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ success:false, message:'id requis' });

  // sécurité – MANAGER doit être propriétaire
  const tc = await db(`SELECT team_id, manager_user_id FROM team_closes WHERE id=?`, [id]);
  if (!tc?.[0]) return res.status(404).json({ success:false, message:'Clôture équipe introuvable' });
  if (role === 'MANAGER' && Number(tc[0].manager_user_id) !== Number(me)) {
    return res.status(403).json({ success:false, message:'Accès refusé' });
  }

  const rows = await db(`SELECT id, original_name, filename, size, mime, created_at FROM team_close_files WHERE team_close_id=? ORDER BY id DESC`, [id]);
  res.json({ success:true, data: rows || [] });
}

async function uploadFile(req, res) {
  const me = req.user.id;
  const role = await getRoleCode(me);
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ success:false, message:'id requis' });

  const tc = await db(`SELECT team_id, manager_user_id FROM team_closes WHERE id=?`, [id]);
  if (!tc?.[0]) return res.status(404).json({ success:false, message:'Clôture équipe introuvable' });
  if (role === 'MANAGER' && Number(tc[0].manager_user_id) !== Number(me)) {
    return res.status(403).json({ success:false, message:'Accès refusé' });
  }

  if (!req.file) return res.status(400).json({ success:false, message:'Aucun fichier' });

  await db(
    `INSERT INTO team_close_files (team_close_id, original_name, filename, size, mime, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [id, req.file.originalname, req.file.filename, req.file.size, req.file.mimetype]
  );

  res.status(201).json({ success:true });
}

async function serveFile(req, res) {
  ensureDir();
  const filename = req.params.filename;
  const full = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(full)) return res.status(404).send('Not found');
  res.sendFile(full);
}

module.exports = {
  preview,
  closeTeam,
  listFiles,
  uploadFile,
  serveFile
};
