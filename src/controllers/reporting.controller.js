// server/src/controllers/reporting.controller.js
const { query: db } = require('../config/db');

// Helpers rôle/portée
async function getRoleCode(userId) {
  const r = await db(`SELECT r.code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? LIMIT 1`, [userId]);
  return r?.[0]?.code || null;
}

async function getManagedTeamIds(managerId) {
  const rows = await db(`SELECT id FROM teams WHERE manager_user_id=?`, [managerId]);
  return (rows || []).map(r => r.id);
}

function parseRange(q) {
  // par défaut: mois courant
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const first = `${yyyy}-${mm}-01`;
  return {
    from: q.from || first,
    to: q.to || `${yyyy}-${mm}-31`,
  };
}

/**
 * GET /reporting/projects/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=&projectId=
 * KPIs:
 *  - total_minutes (sessions)
 *  - sessions_count
 *  - distinct_users
 *  - tasks_done (nb tâches status='DONE' liées aux sessions dans la période)
 *  - breakdown par projet
 *
 * Notes techniques:
 *  - filtre par période appliqué sur sessions.start_time (ou end_time si non null)
 *  - "DONE" calculé sur tasks.status='DONE' et présence d'au moins une session dans la période
 *  - RBAC:
 *      ADMIN: tout
 *      MANAGER: restreint à ses équipes
 *      EMPLOYEE: 403 (pas de reporting global)
 */
async function projectsSummary(req, res) {
  const uid = req.user.id;
  const role = await getRoleCode(uid);
  if (role === 'EMPLOYEE') return res.status(403).json({ success: false, message: 'Accès refusé' });

  const { from, to } = parseRange(req.query);
  const teamId = req.query.teamId ? Number(req.query.teamId) : null;
  const projectId = req.query.projectId ? Number(req.query.projectId) : null;

  let scopeTeamIds = null;
  if (role === 'MANAGER') {
    scopeTeamIds = await getManagedTeamIds(uid);
    if (!scopeTeamIds.length) return res.json({ success: true, data: { total: {}, projects: [] } });
  }

  // Base WHERE pour sessions (période)
  const where = [];
  const params = [];

  // période: session si start_time entre from et to OR end_time entre from et to
  where.push(`(
    (DATE(s.start_time) BETWEEN ? AND ?)
     OR (s.end_time IS NOT NULL AND DATE(s.end_time) BETWEEN ? AND ?)
  )`);
  params.push(from, to, from, to);

  // jointure tasks -> filtre project/team
  if (projectId) { where.push(`t.project_id = ?`); params.push(projectId); }
  if (teamId)    { where.push(`t.team_id = ?`);    params.push(teamId);  }

  // RBAC manager scope
  if (scopeTeamIds && scopeTeamIds.length) {
    where.push(`t.team_id IN (${scopeTeamIds.map(()=>'?').join(',')})`);
    params.push(...scopeTeamIds);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Agrégats globaux
  const totalRows = await db(
    `
    SELECT 
      COALESCE(SUM(s.duration_minutes), 0) AS total_minutes,
      COUNT(*) AS sessions_count,
      COUNT(DISTINCT s.user_id) AS distinct_users
    FROM sessions s
    JOIN tasks t ON t.id = s.task_id
    ${whereSql}
    `,
    params
  );
  const total = totalRows?.[0] || { total_minutes: 0, sessions_count: 0, distinct_users: 0 };

  // DONE: nb de tâches DONE associées à au moins une session dans la période
  const doneRows = await db(
    `
    SELECT COUNT(DISTINCT t.id) AS tasks_done
    FROM sessions s
    JOIN tasks t ON t.id = s.task_id
    ${whereSql} AND t.status='DONE'
    `,
    params
  );
  total.tasks_done = Number(doneRows?.[0]?.tasks_done || 0);

  // Breakdown par projet
  const projects = await db(
    `
    SELECT 
      p.id AS project_id,
      p.name AS project_name,
      COALESCE(SUM(s.duration_minutes), 0) AS total_minutes,
      COUNT(*) AS sessions_count,
      COUNT(DISTINCT s.user_id) AS distinct_users,
      -- DONE par projet
      (
        SELECT COUNT(DISTINCT t2.id)
        FROM sessions s2
        JOIN tasks t2 ON t2.id = s2.task_id
        WHERE 
          (${where.join(' AND ')}) 
          AND t2.status='DONE' 
          AND t2.project_id = p.id
      ) AS tasks_done
    FROM sessions s
    JOIN tasks t ON t.id = s.task_id
    JOIN projects p ON p.id = t.project_id
    ${whereSql}
    GROUP BY p.id, p.name
    ORDER BY total_minutes DESC, sessions_count DESC, p.name ASC
    `,
    params
  );

  res.json({
    success: true,
    data: { total, projects, range: { from, to }, filters: { teamId, projectId } }
  });
}

module.exports = { projectsSummary };
