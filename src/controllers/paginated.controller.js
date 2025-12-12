// server/src/controllers/paginated.controller.js
const { query: db } = require('../config/db');
const { parsePagination, meta } = require('../utils/pagination');

async function getRoleCode(userId) {
  const r = await db(`SELECT r.code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? LIMIT 1`, [userId]);
  return r?.[0]?.code || null;
}
async function managedTeamIds(managerId) {
  const rows = await db(`SELECT id FROM teams WHERE manager_user_id=?`, [managerId]);
  return (rows || []).map(r => r.id);
}

// GET /paged/sessions/my
async function sessionsMy(req, res) {
  const uid = req.user.id;
  const { page, limit, offset } = parsePagination(req);
  const where = ['s.user_id=?'];
  const params = [uid];

  if (req.query.q) {
    where.push('(t.title LIKE ?)');
    params.push(`%${req.query.q.trim()}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRows = await db(
    `SELECT COUNT(*) AS n
       FROM sessions s
       JOIN tasks t ON t.id = s.task_id
      ${whereSql}`,
    params
  );
  const total = Number(totalRows?.[0]?.n || 0);

  const rows = await db(
    `
    SELECT
      s.id,
      s.task_id,
      s.user_id,
      s.started_at,
      s.ended_at,
      s.total_seconds,
      t.title AS task_title
    FROM sessions s
    JOIN tasks t ON t.id = s.task_id
    ${whereSql}
    ORDER BY s.started_at DESC
    LIMIT ? OFFSET ?
  `,
    [...params, limit, offset]
  );

  res.json({ success: true, data: rows, meta: meta(total, page, limit) });
}

// GET /paged/projects
async function projects(req, res) {
  const { page, limit, offset } = parsePagination(req);
  const q = (req.query.q || '').trim();
  const where = [];
  const params = [];
  if (q) { where.push(`(p.name LIKE ?)`); params.push(`%${q}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRows = await db(`SELECT COUNT(*) AS n FROM projects p ${whereSql}`, params);
  const total = Number(totalRows?.[0]?.n || 0);

  const rows = await db(
    `
    SELECT
      p.id,
      p.name,
      p.code,
      p.status,
      p.start_date,
      p.due_date,
      p.manager_id
    FROM projects p
    ${whereSql}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `,
    [...params, limit, offset]
  );

  res.json({ success: true, data: rows, meta: meta(total, page, limit) });
}

// GET /paged/projects/:id/members
async function projectMembers(req, res) {
  const { page, limit, offset } = parsePagination(req);
  const pid = Number(req.params.id);
  const totalRows = await db(`SELECT COUNT(*) AS n FROM project_members pm WHERE pm.project_id=?`, [pid]);
  const total = Number(totalRows?.[0]?.n || 0);

  const rows = await db(
    `SELECT pm.user_id,
            CONCAT(u.first_name, ' ', u.last_name) AS full_name,
            u.email,
            r.code AS role_code
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       JOIN roles r ON r.id = u.role_id
      WHERE pm.project_id=?
      ORDER BY u.last_name ASC, u.first_name ASC
      LIMIT ? OFFSET ?`,
    [pid, limit, offset]
  );
  res.json({ success: true, data: rows, meta: meta(total, page, limit) });
}

// GET /paged/teams?departmentId=
async function teams(req, res) {
  const { page, limit, offset } = parsePagination(req);
  const depId = req.query.departmentId ? Number(req.query.departmentId) : null;

  const role = await getRoleCode(req.user.id);
  let scopeTeamIds = null;

  if (role === 'MANAGER') {
    scopeTeamIds = await managedTeamIds(req.user.id);
    if (!scopeTeamIds.length) {
      return res.json({ success: true, data: [], meta: meta(0, page, limit) });
    }
  }

  const where = [];
  const params = [];

  if (depId) {
    where.push('t.subdepartment_id IN (SELECT id FROM subdepartments WHERE department_id = ?)');
    params.push(depId);
  }

  if (scopeTeamIds && scopeTeamIds.length) {
    where.push(`t.id IN (${scopeTeamIds.map(() => '?').join(',')})`);
    params.push(...scopeTeamIds);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRows = await db(`SELECT COUNT(*) AS n FROM teams t ${whereSql}`, params);
  const total = Number(totalRows?.[0]?.n || 0);

  const rows = await db(
    `SELECT t.id, t.name, t.department_id
       FROM teams t
      ${whereSql}
      ORDER BY t.name ASC, t.id ASC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ success: true, data: rows, meta: meta(total, page, limit) });
}

// GET /paged/dayclose/:id/files
async function dayCloseFiles(req, res) {
  const { page, limit, offset } = parsePagination(req);
  const closeId = Number(req.params.id);

  const totalRows = await db(
    `SELECT COUNT(*) AS n
       FROM dayclose_files f
      WHERE f.dayclose_id = ?`,
    [closeId]
  );
  const total = Number(totalRows?.[0]?.n || 0);

  const rows = await db(
    `
    SELECT
      f.id,
      f.dayclose_id,
      f.filename,
      f.original_name,
      f.mime_type,
      f.size_bytes,
      f.created_at
    FROM dayclose_files f
    WHERE f.dayclose_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `,
    [closeId, limit, offset]
  );

  res.json({ success: true, data: rows, meta: meta(total, page, limit) });
}

// GET /paged/teamclose/:id/files
async function teamCloseFiles(req, res) {
  const { page, limit, offset } = parsePagination(req);
  const closeId = Number(req.params.id);

  const totalRows = await db(
    `SELECT COUNT(*) AS n
       FROM teamclose_files f
      WHERE f.teamclose_id = ?`,
    [closeId]
  );
  const total = Number(totalRows?.[0]?.n || 0);

  const rows = await db(
    `
    SELECT
      f.id,
      f.teamclose_id,
      f.filename,
      f.original_name,
      f.mime_type,
      f.size_bytes,
      f.created_at
    FROM teamclose_files f
    WHERE f.teamclose_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `,
    [closeId, limit, offset]
  );

  res.json({ success: true, data: rows, meta: meta(total, page, limit) });
}

// GET /paged/team-validations/pending  (ADMIN only)
async function teamValidationsPending(req, res) {
  const { page, limit, offset } = parsePagination(req);

  const totalRows = await db(
    `SELECT COUNT(*) AS n
       FROM team_validations tv
      WHERE tv.status = 'PENDING'`
  );
  const total = Number(totalRows?.[0]?.n || 0);

  const rows = await db(
    `
    SELECT
      tv.id,
      tv.team_id,
      tv.dayclose_id,
      tv.status,
      tv.created_at
    FROM team_validations tv
    WHERE tv.status = 'PENDING'
    ORDER BY tv.created_at ASC
    LIMIT ? OFFSET ?
  `,
    [limit, offset]
  );

  res.json({ success: true, data: rows, meta: meta(total, page, limit) });
}

module.exports = {
  sessionsMy,
  projects,
  projectMembers,
  teams,
  dayCloseFiles,
  teamCloseFiles,
  teamValidationsPending,
};
