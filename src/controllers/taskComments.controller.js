// server/src/controllers/taskComments.controller.js
const { body, param, validationResult } = require('express-validator');
const { query: db } = require('../config/db');

function vErr(res, errors) {
  return res.status(422).json({
    success: false,
    message: 'Validation error',
    details: errors.array(),
  });
}

/* -------- helpers pour l’ACL -------- */
async function getTask(taskId) {
  const rows = await db(
    `SELECT t.id, t.team_id, t.project_id, t.created_by_user_id
       FROM tasks t
      WHERE t.id = ?
      LIMIT 1`,
    [taskId]
  );
  return rows[0] || null;
}

async function userCanAccessTask(user, task) {
  if (!task) return false;

  if (user.role_code === 'ADMIN') return true;

  // Manager de l’équipe de la tâche
  if (user.role_code === 'MANAGER') {
    const rows = await db(
      `SELECT 1
         FROM teams tm
        WHERE tm.id = ? AND tm.manager_user_id = ?
        LIMIT 1`,
      [task.team_id, user.id]
    );
    if (rows[0]) return true;
  }

  // Assigné à la tâche
  const rows = await db(
    `SELECT 1
       FROM task_assignees ta
      WHERE ta.task_id = ? AND ta.user_id = ?
      LIMIT 1`,
    [task.id, user.id]
  );
  if (rows[0]) return true;

  // Créateur de la tâche
  if (task.created_by_user_id === user.id) return true;

  return false;
}

async function userCanAccessProject(user, projectId) {
  if (!projectId) return false;
  if (user.role_code === 'ADMIN') return true;
  const rows = await db(
    `
    SELECT 1
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
    WHERE p.id = ?
      AND (p.manager_id = ? OR p.created_by = ? OR pm.user_id IS NOT NULL)
    LIMIT 1
  `,
    [
      user.id,
      projectId,
      user.id,
      user.id,
    ]
  );
  return !!rows[0];
}

/* -------- Validation -------- */
const val = {
  list: [
    param('taskId').toInt().isInt({ min: 1 }),
    (req, res, next) => {
      const e = validationResult(req);
      if (!e.isEmpty()) return vErr(res, e);
      next();
    },
  ],
  create: [
    param('taskId').toInt().isInt({ min: 1 }),
    body('body').isString().isLength({ min: 1, max: 2000 }),
    (req, res, next) => {
      const e = validationResult(req);
      if (!e.isEmpty()) return vErr(res, e);
      next();
    },
  ],
};

/* -------- lister commentaires -------- */
async function list(req, res) {
  const taskId = Number(req.params.taskId);
  const task = await getTask(taskId);
  if (!task) {
    return res
      .status(404)
      .json({ success: false, message: 'Tâche introuvable' });
  }

  const can = await userCanAccessTask(req.user, task);
  if (!can) {
    return res
      .status(403)
      .json({ success: false, message: 'Accès refusé à cette tâche' });
  }

  const rows = await db(
    `
    SELECT tc.id,
           tc.task_id,
           tc.user_id,
           CONCAT(u.first_name, ' ', u.last_name) AS user_name,
           tc.body,
           tc.created_at
    FROM task_comments tc
    JOIN users u ON u.id = tc.user_id
    WHERE tc.task_id = ?
    ORDER BY tc.created_at ASC
  `,
    [taskId]
  );

  res.json({ success: true, data: rows });
}

/* -------- créer commentaire -------- */
async function create(req, res) {
  const taskId = Number(req.params.taskId);
  const task = await getTask(taskId);
  if (!task) {
    return res
      .status(404)
      .json({ success: false, message: 'Tâche introuvable' });
  }

  const can = await userCanAccessTask(req.user, task);
  if (!can) {
    return res
      .status(403)
      .json({ success: false, message: 'Accès refusé à cette tâche' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) return vErr(res, errors);

  const text = req.body.body || '';
  if (!text.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Le commentaire ne peut pas être vide',
    });
  }

  const result = await db(
    `INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?)`,
    [taskId, req.user.id, text.trim()]
  );

  const rows = await db(
    `
    SELECT tc.id,
           tc.task_id,
           tc.user_id,
           CONCAT(u.first_name, ' ', u.last_name) AS user_name,
           tc.body,
           tc.created_at
    FROM task_comments tc
    JOIN users u ON u.id = tc.user_id
    WHERE tc.id = ?
    LIMIT 1
  `,
    [result.insertId]
  );

  res.status(201).json({ success: true, data: rows[0] });
}

module.exports = {
  val,
  list,
  create,
};
