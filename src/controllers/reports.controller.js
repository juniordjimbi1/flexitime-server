const { query: db } = require('../config/db');

function ymd(d) {
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseRange(req) {
  let { from, to } = req.query || {};
  const today = new Date();
  const dTo = to ? new Date(to) : today;
  const dFrom = from ? new Date(from) : new Date(today.getTime() - 29 * 86400000); // 30 jours rolling
  if (isNaN(dFrom.getTime()) || isNaN(dTo.getTime())) {
    return { from: ymd(new Date(today.getTime() - 29 * 86400000)), to: ymd(today) };
  }
  if (dFrom > dTo) [from, to] = [ymd(dTo), ymd(dFrom)];
  else { from = ymd(dFrom); to = ymd(dTo); }
  return { from, to };
}

// ADMIN & MANAGER (manager: filtré à ses équipes)
async function overview(req, res) {
  const { from, to } = parseRange(req);

  const [
    usersAll, usersEmp, usersMgr, usersAdm,
    deps, teams,
    openSessions, closesToday
  ] = await Promise.all([
    db(`SELECT COUNT(*) AS c FROM users`),
    db(`SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id=u.role_id AND r.code='EMPLOYEE'`),
    db(`SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id=u.role_id AND r.code='MANAGER'`),
    db(`SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id=u.role_id AND r.code='ADMIN'`),
    db(`SELECT COUNT(*) AS c FROM departments`),
    db(`SELECT COUNT(*) AS c FROM teams`),
    db(`SELECT COUNT(*) AS c FROM sessions WHERE end_time IS NULL`),
    db(`SELECT COUNT(*) AS c FROM day_closes WHERE close_date = CURRENT_DATE()`)
  ]);

  // Temps cumulé (sessions terminées) sur la période
  const timeWhere = req.user.role_code === 'MANAGER'
    ? `WHERE s.end_time IS NOT NULL AND DATE(s.start_time) BETWEEN ? AND ?
       AND t.manager_user_id = ?`
    : `WHERE s.end_time IS NOT NULL AND DATE(s.start_time) BETWEEN ? AND ?`;

  const timeParams = req.user.role_code === 'MANAGER' ? [from, to, req.user.id] : [from, to];

  const [totMinutes] = await db(
    `SELECT COALESCE(SUM(s.duration_minutes),0) AS minutes
       FROM sessions s
       LEFT JOIN tasks tk ON tk.id = s.task_id
       LEFT JOIN teams t ON t.id = tk.team_id
     ${timeWhere}`, timeParams
  );

  // Tâches par statut (sur la période, selon updated_at)
  const tasksWhere = req.user.role_code === 'MANAGER'
    ? `WHERE DATE(t.updated_at) BETWEEN ? AND ? AND tm.manager_user_id = ?`
    : `WHERE DATE(t.updated_at) BETWEEN ? AND ?`;

  const [taskStats] = await db(
    `SELECT
       SUM(CASE WHEN t.status='TODO' THEN 1 ELSE 0 END) AS todo,
       SUM(CASE WHEN t.status='IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN t.status='DONE' THEN 1 ELSE 0 END) AS done
     FROM tasks t
     LEFT JOIN teams tm ON tm.id = t.team_id
     ${tasksWhere}`, req.user.role_code === 'MANAGER' ? [from, to, req.user.id] : [from, to]
  );

  res.json({
    success: true,
    data: {
      range: { from, to },
      users: {
        total: usersAll[0].c,
        employees: usersEmp[0].c,
        managers: usersMgr[0].c,
        admins: usersAdm[0].c,
      },
      structure: { departments: deps[0].c, teams: teams[0].c },
      sessions: { open_now: openSessions[0].c, total_minutes: Number(totMinutes.minutes) || 0 },
      tasks: { todo: taskStats.todo || 0, in_progress: taskStats.in_progress || 0, done: taskStats.done || 0 },
      closes_today: closesToday[0].c,
    }
  });
}

async function timeByTeam(req, res) {
  const { from, to } = parseRange(req);
  const isMgr = req.user.role_code === 'MANAGER';
  const rows = await db(
    `SELECT
        tm.id AS team_id, tm.name AS team_name,
        sd.name AS subdep_name, d.name AS department_name,
        CONCAT(u.first_name,' ',u.last_name) AS manager_name,
        COALESCE(SUM(s.duration_minutes),0) AS minutes
     FROM teams tm
     JOIN subdepartments sd ON sd.id=tm.subdepartment_id
     JOIN departments d ON d.id=sd.department_id
     LEFT JOIN users u ON u.id = tm.manager_user_id
     LEFT JOIN tasks t ON t.team_id = tm.id
     LEFT JOIN sessions s ON s.task_id = t.id AND s.end_time IS NOT NULL AND DATE(s.start_time) BETWEEN ? AND ?
     ${isMgr ? 'WHERE tm.manager_user_id = ?' : ''}
     GROUP BY tm.id, tm.name, sd.name, d.name, manager_name
     ORDER BY d.name, sd.name, tm.name`,
     isMgr ? [from, to, req.user.id] : [from, to]
  );
  res.json({ success: true, data: { range: { from, to }, rows } });
}

async function tasksStats(req, res) {
  const { from, to } = parseRange(req);
  const isMgr = req.user.role_code === 'MANAGER';
  const rows = await db(
    `SELECT
        tm.id AS team_id, tm.name AS team_name,
        sd.name AS subdep_name, d.name AS department_name,
        SUM(CASE WHEN t.status='TODO' THEN 1 ELSE 0 END) AS todo,
        SUM(CASE WHEN t.status='IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN t.status='DONE' THEN 1 ELSE 0 END) AS done
     FROM teams tm
     JOIN subdepartments sd ON sd.id=tm.subdepartment_id
     JOIN departments d ON d.id=sd.department_id
     LEFT JOIN tasks t ON t.team_id = tm.id AND DATE(t.updated_at) BETWEEN ? AND ?
     ${isMgr ? 'WHERE tm.manager_user_id = ?' : ''}
     GROUP BY tm.id, tm.name, sd.name, d.name
     ORDER BY d.name, sd.name, tm.name`,
     isMgr ? [from, to, req.user.id] : [from, to]
  );
  res.json({ success: true, data: { range: { from, to }, rows } });
}

async function dayClosesAgg(req, res) {
  const { from, to } = parseRange(req);
  const isMgr = req.user.role_code === 'MANAGER';

  // Par utilisateur (minutes & nb de clôtures), limité aux équipes du manager si manager
  const rows = await db(
    `SELECT
        u.id AS user_id,
        u.first_name, u.last_name, u.email,
        COALESCE(SUM(dc.total_minutes),0) AS minutes,
        COUNT(dc.id) AS closes,
        GROUP_CONCAT(DISTINCT tm.name ORDER BY tm.name SEPARATOR ', ') AS teams
     FROM users u
     JOIN roles r ON r.id=u.role_id AND r.code='EMPLOYEE'
     LEFT JOIN day_closes dc ON dc.user_id = u.id AND dc.close_date BETWEEN ? AND ?
     LEFT JOIN team_members mem ON mem.user_id = u.id
     LEFT JOIN teams tm ON tm.id = mem.team_id
     ${isMgr ? 'LEFT JOIN teams tm2 ON tm2.id = mem.team_id AND tm2.manager_user_id = ?' : ''}
     ${isMgr ? 'WHERE tm2.id IS NOT NULL' : ''}
     GROUP BY u.id, u.first_name, u.last_name, u.email
     ORDER BY minutes DESC, closes DESC, u.first_name, u.last_name`,
     isMgr ? [from, to, req.user.id] : [from, to]
  );

  res.json({ success: true, data: { range: { from, to }, rows } });
}

module.exports = { overview, timeByTeam, tasksStats, dayClosesAgg };
