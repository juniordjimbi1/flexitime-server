// src/controllers/taskChecklist.controller.js
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { query: db } = require('../config/db');
const { hookLapOnDone } = require('./taskChecklistLaps.controller');

/* -------------------- Utils -------------------- */
function vErr(res, errors) {
  return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });
}

async function getTask(taskId) {
  const r = await db(`
    SELECT id, team_id, project_id, created_by_user_id
    FROM tasks
    WHERE id = ?
  `, [taskId]);
  return r[0] || null;
}
async function isAssignee(userId, taskId) {
  const r = await db(`SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ? LIMIT 1`, [taskId, userId]);
  return !!r[0];
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
function isTaskCreator(user, task) {
  return Number(task.created_by_user_id) === Number(user.id);
}

/* -------------------- Validation -------------------- */
const val = {
  list: [
    param('taskId').toInt().isInt({ min: 1 }),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
  create: [
    param('taskId').toInt().isInt({ min: 1 }),
    body('content').trim().isLength({ min: 1, max: 500 }),
    body('is_private').optional({ nullable: true }).isBoolean().toBoolean(),
    body('is_done').optional({ nullable: true }).isBoolean().toBoolean(),
    body('sort_order').optional({ nullable: true }).isInt({ min: 0 }).toInt(),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
  update: [
    param('taskId').toInt().isInt({ min: 1 }),
    param('itemId').toInt().isInt({ min: 1 }),
    body('content').optional().trim().isLength({ min: 1, max: 500 }),
    body('is_private').optional({ nullable: true }).isBoolean().toBoolean(),
    body('is_done').optional({ nullable: true }).isBoolean().toBoolean(),
    body('sort_order').optional({ nullable: true }).isInt({ min: 0 }).toInt(),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
  remove: [
    param('taskId').toInt().isInt({ min: 1 }),
    param('itemId').toInt().isInt({ min: 1 }),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
  reorder: [
    param('taskId').toInt().isInt({ min: 1 }),
    body('orders').isArray({ min: 1 }),
    body('orders.*.id').isInt({ min: 1 }),
    body('orders.*.sort_order').isInt({ min: 0 }),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
};

/* -------------------- RBAC lecture / écriture -------------------- */
/**
 * Lecture:
 *  - EMPLOYEE assigné -> full (public + privé)
 *  - MANAGER / ADMIN -> seulement public
 * Écriture (public):
 *  - ADMIN -> oui
 *  - MANAGER -> oui si manager de l’équipe OU (tâche sans équipe ET accès au projet) OU créateur de la tâche
 *  - EMPLOYEE assigné -> oui
 * Écriture (privé):
 *  - Uniquement EMPLOYEE assigné
 */
async function canReadAllItems(user, task) {
  if (user.role_code === 'EMPLOYEE') {
    return isAssignee(user.id, task.id);
  }
  return false; // Manager/Admin: public only
}
async function canWritePrivate(user, task) {
  if (user.role_code === 'EMPLOYEE') {
    return isAssignee(user.id, task.id);
  }
  return false;
}
async function canWritePublic(user, task) {
  if (user.role_code === 'ADMIN') return true;
  if (user.role_code === 'MANAGER') {
    if (await isManagerOfTeam(user.id, task.team_id)) return true;
    if (!task.team_id && task.project_id && await userCanAccessProject(user, task.project_id)) return true;
    if (isTaskCreator(user, task)) return true; // ✅ créateur autorisé
    return false;
  }
  // EMPLOYEE assigné peut aussi écrire public
  return isAssignee(user.id, task.id);
}

/* -------------------- List -------------------- */
async function list(req, res) {
  const taskId = Number(req.params.taskId);
  const task = await getTask(taskId);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

  const full = await canReadAllItems(req.user, task); // true => include private
  const where = [`tci.task_id = ?`];
  const params = [taskId];
  if (!full) { where.push('tci.is_private = 0'); }

  const rows = await db(`
    SELECT tci.id, tci.task_id, tci.content, tci.is_private, tci.is_done, tci.sort_order,
           tci.created_by, tci.created_at, tci.updated_at,
           CONCAT(u.first_name,' ',u.last_name) AS created_by_name
    FROM task_checklist_items tci
    LEFT JOIN users u ON u.id = tci.created_by
    WHERE ${where.join(' AND ')}
    ORDER BY tci.sort_order ASC, tci.id ASC
  `, params);

  // Progression (sur tous les items visibles par l'utilisateur)
  const total = rows.length;
  const done = rows.filter(i => i.is_done).length;
  const progress = total ? Math.round((done / total) * 100) : 0;

  res.json({ success: true, data: rows, meta: { total, done, progress, visibility: full ? 'all' : 'public' } });
}

/* -------------------- Create -------------------- */
async function create(req, res) {
  const taskId = Number(req.params.taskId);
  const task = await getTask(taskId);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

  const { content } = req.body;
  const is_private_req = req.body.is_private === true;
  const is_done = req.body.is_done === true;

  // Droits écriture
  const allowPrivate = await canWritePrivate(req.user, task);
  const allowPublic  = await canWritePublic(req.user, task);
  if (!allowPublic) return res.status(403).json({ success: false, message: 'Forbidden' });
  if (is_private_req && !allowPrivate) return res.status(403).json({ success: false, message: 'Cannot create private item' });

  // sort_order: max + 1 si non fourni
  let sort_order = Number.isInteger(req.body.sort_order) ? req.body.sort_order : null;
  if (sort_order === null) {
    const r = await db(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM task_checklist_items WHERE task_id = ?`, [taskId]);
    sort_order = (r[0]?.m ?? -1) + 1;
  }

  const ins = await db(`
    INSERT INTO task_checklist_items (task_id, content, is_private, is_done, sort_order, created_by)
    VALUES (?,?,?,?,?,?)
  `, [taskId, content, is_private_req ? 1 : 0, is_done ? 1 : 0, sort_order, req.user.id]);

  const row = (await db(`
    SELECT id, task_id, content, is_private, is_done, sort_order, created_by, created_at, updated_at
    FROM task_checklist_items WHERE id = ?
  `, [ins.insertId]))[0];

  res.status(201).json({ success: true, data: row });
}

/* -------------------- Update -------------------- */
async function update(req, res) {
  const taskId = Number(req.params.taskId);
  const itemId = Number(req.params.itemId);
  const task = await getTask(taskId);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

  const item = (await db(`SELECT * FROM task_checklist_items WHERE id = ? AND task_id = ?`, [itemId, taskId]))[0];
  if (!item) return res.status(404).json({ success: false, message: 'Checklist item not found' });

  const allowPrivate = await canWritePrivate(req.user, task);
  const allowPublic  = await canWritePublic(req.user, task);

  if (!allowPublic) return res.status(403).json({ success: false, message: 'Forbidden' });
  // Interdire à Admin/Manager de toucher un item privé
  if (item.is_private && !allowPrivate) return res.status(403).json({ success: false, message: 'Cannot edit private item' });

  const fields = [];
  const params = [];

  if (req.body.content !== undefined) { fields.push('content = ?'); params.push(req.body.content); }
  if (req.body.is_done !== undefined) { fields.push('is_done = ?'); params.push(req.body.is_done ? 1 : 0); }
  if (req.body.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(req.body.sort_order); }

  if (req.body.is_private !== undefined) {
    // Seul l'EMPLOYEE assigné peut modifier la confidentialité
    if (!allowPrivate) return res.status(403).json({ success: false, message: 'Cannot set is_private' });
    fields.push('is_private = ?'); params.push(req.body.is_private ? 1 : 0);
  }

  if (!fields.length) return res.json({ success: true, data: item });

  params.push(itemId);
  await db(`UPDATE task_checklist_items SET ${fields.join(', ')} WHERE id = ?`, params);

  const updated = (await db(`
    SELECT id, task_id, content, is_private, is_done, sort_order, created_by, created_at, updated_at
    FROM task_checklist_items WHERE id = ?
  `, [itemId]))[0];

  res.json({ success: true, data: updated });
}

/* -------------------- Delete -------------------- */
async function remove(req, res) {
  const taskId = Number(req.params.taskId);
  const itemId = Number(req.params.itemId);
  const task = await getTask(taskId);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

  const item = (await db(`SELECT * FROM task_checklist_items WHERE id = ? AND task_id = ?`, [itemId, taskId]))[0];
  if (!item) return res.status(404).json({ success: false, message: 'Checklist item not found' });

  const allowPrivate = await canWritePrivate(req.user, task);
  const allowPublic  = await canWritePublic(req.user, task);
  if (!allowPublic) return res.status(403).json({ success: false, message: 'Forbidden' });
  if (item.is_private && !allowPrivate) return res.status(403).json({ success: false, message: 'Cannot delete private item' });

  await db(`DELETE FROM task_checklist_items WHERE id = ?`, [itemId]);
  res.json({ success: true, data: { id: itemId } });
}

/* -------------------- Reorder (batch) -------------------- */
async function reorder(req, res) {
  const taskId = Number(req.params.taskId);
  const task = await getTask(taskId);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

  // Besoin d'au moins droits d'écriture "public" (manager/admin/assignee)
  const allowPublic  = await canWritePublic(req.user, task);
  if (!allowPublic) return res.status(403).json({ success: false, message: 'Forbidden' });

  const updates = req.body.orders;
  for (const u of updates) {
    await db(`UPDATE task_checklist_items SET sort_order = ? WHERE id = ? AND task_id = ?`, [u.sort_order, u.id, taskId]);
  }
  const rows = await db(`
    SELECT id, task_id, content, is_private, is_done, sort_order, created_by, created_at, updated_at
    FROM task_checklist_items
    WHERE task_id = ?
    ORDER BY sort_order ASC, id ASC
  `, [taskId]);

  res.json({ success: true, data: rows });
}

module.exports = {
  val,
  list,
  create,
  update,
  remove,
  reorder,
};


/* [P18] Hook lap creation when an item is marked done */
const _orig_update = update;
update = async function(req, res) {
  const wasDoneToggle = (req?.body && (req.body.is_done === true));
  const taskId = Number(req.params.taskId || req.params.id);
  const itemId = Number(req.params.itemId);
  await _orig_update(req, res);
  try {
    if (wasDoneToggle && res?.statusCode === 200) {
      await hookLapOnDone({ userId: req.user.id, taskId, itemId });
    }
  } catch (e) { /* swallow */ }
};
