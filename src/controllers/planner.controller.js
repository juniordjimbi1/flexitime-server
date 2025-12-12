// server/src/controllers/planner.controller.js
const { body, query, validationResult } = require('express-validator');
const { query: db } = require('../config/db');

/* --------- helpers génériques ---------- */
function vErr(res, errors) {
  return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });
}
function asDate(d) {
  const x = new Date(d);
  return isNaN(x.getTime()) ? null : new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
}
function ymd(d) {
  return d.toISOString().slice(0,10);
}

/* --------- helpers RBAC tâches/projets ---------- */
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
async function canManageTask(user, taskId) {
  if (user.role_code === 'ADMIN') return true;
  const r = await db(`SELECT team_id, project_id FROM tasks WHERE id = ?`, [taskId]);
  if (!r[0]) return false;
  const { team_id, project_id } = r[0];
  if (await isManagerOfTeam(user.id, team_id)) return true;
  if (!team_id && project_id && await userCanAccessProject(user, project_id)) return true;
  return false;
}

/* --------- validation ---------- */
const val = {
  bulkPlan: [
    body('task_ids').isArray({ min: 1 }),
    body('task_ids.*').isInt({ min: 1 }).toInt(),
    body('mode').isIn(['DAYS', 'WEEKDAYS', 'ODD_WEEKS', 'EVEN_WEEKS']),
    body('start_date').isISO8601().withMessage('start_date required (YYYY-MM-DD)'),
    body('end_date').isISO8601().withMessage('end_date required (YYYY-MM-DD)'),
    body('days').optional().isArray().withMessage('days must be array of integers 1..7'),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
  listPlans: [
    query('start_date').isISO8601().withMessage('start_date required (YYYY-MM-DD)'),
    query('end_date').isISO8601().withMessage('end_date required (YYYY-MM-DD)'),
    query('project_id').optional().toInt().isInt({ min: 1 }),
    query('team_id').optional().toInt().isInt({ min: 1 }),
    query('status').optional().isIn(['TODO','IN_PROGRESS','BLOCKED','DONE']),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ]
};

/* --------- génération des dates ---------- */
function* iterDates(from, to) {
  const d = new Date(from);
  while (d <= to) {
    yield new Date(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}
function isoWeekNumber(dateUTC) {
  const d = new Date(Date.UTC(dateUTC.getUTCFullYear(), dateUTC.getUTCMonth(), dateUTC.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

/* --------- contrôleur: BULK PLAN ---------- */
async function bulkPlan(req, res) {
  const { task_ids, mode } = req.body;
  const start = asDate(req.body.start_date);
  const end = asDate(req.body.end_date);
  const days = Array.isArray(req.body.days) ? req.body.days.map(Number) : [];

  if (!start || !end || start > end) {
    return res.status(422).json({ success: false, message: 'Invalid date range' });
  }

  for (const tid of task_ids) {
    const ok = await canManageTask(req.user, tid);
    if (!ok) return res.status(403).json({ success: false, message: `Interdit sur task ${tid}` });
  }

  const planned = [];
  for (const d of iterDates(start, end)) {
    const dow = (d.getUTCDay() || 7);
    if (mode === 'DAYS') {
      if (days.length && !days.includes(dow)) continue;
    } else if (mode === 'WEEKDAYS') {
      if (dow < 1 || dow > 5) continue;
    } else if (mode === 'ODD_WEEKS' || mode === 'EVEN_WEEKS') {
      const w = isoWeekNumber(d);
      const isOdd = (w % 2 === 1);
      if (mode === 'ODD_WEEKS' && !isOdd) continue;
      if (mode === 'EVEN_WEEKS' && isOdd) continue;
      if (dow < 1 || dow > 5) continue;
    }
    planned.push(ymd(d));
  }

  if (planned.length === 0) {
    return res.json({ success: true, data: { inserted: 0, duplicates: 0, dates: [], task_ids } });
  }

  let inserted = 0, duplicates = 0;
  for (const tid of task_ids) {
    const values = planned.map(() => '(?,?,?)').join(',');
    const params = planned.flatMap(date => [tid, date, req.user.id]);
    try {
      await db(`INSERT IGNORE INTO task_plans (task_id, planned_date, created_by) VALUES ${values}`, params);
      const r = await db(
        `SELECT COUNT(*) AS c FROM task_plans WHERE task_id = ? AND planned_date IN (${planned.map(()=>'?').join(',')})`,
        [tid, ...planned]
      );
      const count = r[0]?.c || 0;
      inserted += count;
    } catch (e) { /* ignore */ }
  }
  const totalWanted = planned.length * task_ids.length;
  if (inserted <= totalWanted) duplicates = totalWanted - inserted;

  res.json({ success: true, data: { inserted, duplicates, dates: planned, task_ids } });
}

/* --------- contrôleur: LIST PLANS ---------- */
async function listPlans(req, res) {
  const start = asDate(req.query.start_date);
  const end = asDate(req.query.end_date);
  if (!start || !end || start > end) {
    return res.status(422).json({ success: false, message: 'Invalid date range' });
  }
  const projectId = req.query.project_id ? Number(req.query.project_id) : null;
  const teamId = req.query.team_id ? Number(req.query.team_id) : null;
  const status = req.query.status || null;

  if (projectId && !(await userCanAccessProject(req.user, projectId))) {
    return res.status(403).json({ success: false, message: 'Forbidden: no access to project' });
  }

  const where = ['tp.planned_date BETWEEN ? AND ?'];
  const params = [ymd(start), ymd(end)];

  if (projectId) { where.push('t.project_id = ?'); params.push(projectId); }
  if (teamId)    { where.push('t.team_id = ?');    params.push(teamId); }
  if (status)    { where.push('t.status = ?');     params.push(status); }

  // RBAC Manager: restreindre aux équipes qu'il gère OU tâches sans équipe mais projet accessible
  if (req.user.role_code === 'MANAGER' && !projectId) {
    where.push(`(
      t.team_id IN (SELECT id FROM teams WHERE manager_user_id = ?)
      OR (t.team_id IS NULL AND t.project_id IN (
        SELECT p.id FROM projects p
        LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
        WHERE (p.manager_id = ? OR p.created_by = ? OR pm.user_id IS NOT NULL)
      ))
    )`);
    params.push(req.user.id, req.user.id, req.user.id, req.user.id);
  }

  const rows = await db(`
    SELECT
      tp.planned_date,
      t.id AS task_id,
      t.title,
      t.status,
      t.priority,
      t.project_id,
      t.team_id,
      tm.name AS team_name
    FROM task_plans tp
    JOIN tasks t ON t.id = tp.task_id
    LEFT JOIN teams tm ON tm.id = t.team_id
    WHERE ${where.join(' AND ')}
    ORDER BY tp.planned_date ASC, tm.name ASC, t.title ASC
  `, params);

  res.json({ success: true, data: rows });
}

module.exports = { val, bulkPlan, listPlans };
