// server/src/controllers/labels.controller.js
const { body, param, query, validationResult } = require('express-validator');
const { query: db } = require('../config/db');

function vErr(res, errors) {
  return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });
}

async function isManagerOfTeam(userId, teamId) {
  if (!teamId) return false;
  const r = await db(`SELECT 1 FROM teams WHERE id = ? AND manager_user_id = ? LIMIT 1`, [teamId, userId]);
  return !!r[0];
}
async function userCanAccessProject(user, projectId) {
  if (!projectId) return false;
  if (user.role_code === 'ADMIN') return true;
  const rows = await db(`
    SELECT 1
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
    WHERE p.id = ?
      AND (p.manager_id = ? OR p.created_by = ? OR pm.user_id IS NOT NULL)
    LIMIT 1
  `, [user.id, projectId, user.id, user.id]);
  return !!rows[0];
}
async function canSeeTask(user, taskId) {
  // ADMIN: ok ; MANAGER: ok si équipe gérée ou projet accessible ; EMPLOYEE: ok si assigné
  const t = await db(`SELECT team_id, project_id FROM tasks WHERE id = ?`, [taskId]);
  if (!t[0]) return false;
  const { team_id, project_id } = t[0];
  if (user.role_code === 'ADMIN') return true;
  if (user.role_code === 'MANAGER') {
    if (await isManagerOfTeam(user.id, team_id)) return true;
    if (!team_id && project_id && await userCanAccessProject(user, project_id)) return true;
    return false;
  }
  // EMPLOYEE
  const a = await db(`SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ? LIMIT 1`, [taskId, user.id]);
  return !!a[0];
}

const val = {
  create: [
    body('name').trim().isLength({ min: 1, max: 64 }),
    body('color').optional({ nullable: true }).isString().isLength({ max: 16 }),
    (req,res,next)=>{ const e = validationResult(req); if(!e.isEmpty()) return vErr(res, e); next(); }
  ],
  update: [
    param('id').toInt().isInt({ min: 1 }),
    body('name').optional().trim().isLength({ min: 1, max: 64 }),
    body('color').optional({ nullable: true }).isString().isLength({ max: 16 }),
    (req,res,next)=>{ const e = validationResult(req); if(!e.isEmpty()) return vErr(res, e); next(); }
  ],
  remove: [
    param('id').toInt().isInt({ min: 1 }),
    (req,res,next)=>{ const e = validationResult(req); if(!e.isEmpty()) return vErr(res, e); next(); }
  ],
  link: [
    param('taskId').toInt().isInt({ min: 1 }),
    body('label_ids').isArray({ min: 1 }),
    body('label_ids.*').toInt().isInt({ min: 1 }),
    (req,res,next)=>{ const e = validationResult(req); if(!e.isEmpty()) return vErr(res, e); next(); }
  ],
  unlink: [
    param('taskId').toInt().isInt({ min: 1 }),
    param('labelId').toInt().isInt({ min: 1 }),
    (req,res,next)=>{ const e = validationResult(req); if(!e.isEmpty()) return vErr(res, e); next(); }
  ],
};

async function list(req, res) {
  const rows = await db(`SELECT id, name, color, created_at FROM labels ORDER BY name ASC`);
  res.json({ success: true, data: rows });
}

async function create(req, res) {
  const { name, color = null } = req.body;
  const r = await db(`INSERT INTO labels (name, color) VALUES (?, ?)`, [name, color || null]);
  const row = await db(`SELECT id, name, color, created_at FROM labels WHERE id = ?`, [r.insertId]);
  res.status(201).json({ success: true, data: row[0] });
}

async function update(req, res) {
  const id = Number(req.params.id);
  const fields = []; const params = [];
  if (req.body.name !== undefined) { fields.push('name = ?'); params.push(req.body.name); }
  if (req.body.color !== undefined) { fields.push('color = ?'); params.push(req.body.color || null); }
  if (!fields.length) return res.json({ success: true, data: { id } });
  params.push(id);
  await db(`UPDATE labels SET ${fields.join(', ')} WHERE id = ?`, params);
  const row = await db(`SELECT id, name, color, created_at FROM labels WHERE id = ?`, [id]);
  res.json({ success: true, data: row[0] });
}

async function remove(req, res) {
  const id = Number(req.params.id);
  await db(`DELETE FROM labels WHERE id = ?`, [id]); // CASCADE via task_label_links FK
  res.json({ success: true, data: { id } });
}

async function listByTask(req, res) {
  const taskId = Number(req.params.taskId);
  if (!(await canSeeTask(req.user, taskId))) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  const rows = await db(`
    SELECT l.id, l.name, l.color
    FROM task_label_links tll
    JOIN labels l ON l.id = tll.label_id
    WHERE tll.task_id = ?
    ORDER BY l.name ASC
  `, [taskId]);
  res.json({ success: true, data: rows });
}

async function addToTask(req, res) {
  const taskId = Number(req.params.taskId);
  // Admin/Manager uniquement (requireRole déjà appliqué)
  const ids = req.body.label_ids.map(Number);
  if (!ids.length) return res.status(400).json({ success: false, message: 'label_ids requis' });

  // sécurité minimale: la tâche doit être gérable par l’appelant (sinon un manager pourrait taguer une tâche hors périmètre)
  if (req.user.role_code === 'MANAGER') {
    const t = await db(`SELECT team_id, project_id FROM tasks WHERE id = ?`, [taskId]);
    if (!t[0]) return res.status(404).json({ success: false, message: 'Tâche introuvable' });
    const { team_id, project_id } = t[0];
    const ok = await isManagerOfTeam(req.user.id, team_id) || (!team_id && project_id && await userCanAccessProject(req.user, project_id));
    if (!ok) return res.status(403).json({ success: false, message: 'Interdit' });
  }

  const values = ids.map(()=> '(?, ?)').join(',');
  await db(`INSERT IGNORE INTO task_label_links (task_id, label_id) VALUES ${values}`, ids.flatMap(id=>[taskId, id]));
  const rows = await db(`
    SELECT l.id, l.name, l.color
    FROM task_label_links tll
    JOIN labels l ON l.id = tll.label_id
    WHERE tll.task_id = ?
    ORDER BY l.name ASC
  `, [taskId]);
  res.json({ success: true, data: rows });
}

async function removeFromTask(req, res) {
  const taskId = Number(req.params.taskId);
  const labelId = Number(req.params.labelId);

  if (req.user.role_code === 'MANAGER') {
    const t = await db(`SELECT team_id, project_id FROM tasks WHERE id = ?`, [taskId]);
    if (!t[0]) return res.status(404).json({ success: false, message: 'Tâche introuvable' });
    const { team_id, project_id } = t[0];
    const ok = await isManagerOfTeam(req.user.id, team_id) || (!team_id && project_id && await userCanAccessProject(req.user, project_id));
    if (!ok) return res.status(403).json({ success: false, message: 'Interdit' });
  }

  await db(`DELETE FROM task_label_links WHERE task_id = ? AND label_id = ?`, [taskId, labelId]);
  const rows = await db(`
    SELECT l.id, l.name, l.color
    FROM task_label_links tll
    JOIN labels l ON l.id = tll.label_id
    WHERE tll.task_id = ?
    ORDER BY l.name ASC
  `, [taskId]);
  res.json({ success: true, data: rows });
}

module.exports = { val, list, create, update, remove, listByTask, addToTask, removeFromTask };
