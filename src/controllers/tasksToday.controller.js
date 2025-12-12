const { query: db } = require('../config/db');

const WHERE_TODAY = `
  (t.due_date = CURDATE() OR (t.due_date IS NULL AND DATE(t.created_at) = CURDATE()))
`;

async function getLastCloseAt(uid) {
  const rows = await db(
    `SELECT closed_at
       FROM day_closes
      WHERE user_id=? AND close_date=CURDATE()
      ORDER BY closed_at DESC
      LIMIT 1`,
    [uid]
  );
  return (rows && rows[0] && rows[0].closed_at) || null;
}

async function myToday(req, res) {
  const uid = req.user.id;
  const rows = await db(
    `
    SELECT
      t.id, t.title, t.description, t.status, t.due_date,
      t.team_id,
      d.name  AS department_name,
      sd.name AS subdep_name,
      tm.name AS team_name
    FROM tasks t
    JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
    LEFT JOIN teams tm ON tm.id = t.team_id
    LEFT JOIN subdepartments sd ON sd.id = tm.subdepartment_id
    LEFT JOIN departments d ON d.id = sd.department_id
    WHERE ${WHERE_TODAY}
    ORDER BY t.status, t.due_date, t.updated_at DESC
    `,
    [uid]
  );
  res.json({ success: true, data: rows || [] });
}

async function myTodayWithTime(req, res) {
  const uid = req.user.id;
  const rows = await db(
    `
    SELECT
      t.id, t.title, t.description, t.status, t.due_date,
      t.team_id,
      d.name  AS department_name,
      sd.name AS subdep_name,
      tm.name AS team_name,
      COALESCE(SUM(CASE WHEN DATE(s.start_time)=CURDATE() THEN s.duration_minutes ELSE 0 END), 0) AS minutes_spent_today
    FROM tasks t
    JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
    LEFT JOIN teams tm ON tm.id = t.team_id
    LEFT JOIN subdepartments sd ON sd.id = tm.subdepartment_id
    LEFT JOIN departments d ON d.id = sd.department_id
    LEFT JOIN sessions s ON s.task_id = t.id AND s.user_id = ?
    WHERE ${WHERE_TODAY}
    GROUP BY t.id
    ORDER BY t.status, t.due_date, MAX(t.updated_at) DESC
    `,
    [uid, uid]
  );
  res.json({ success: true, data: rows || [] });
}

async function myTodayAvailability(req, res) {
  const uid = req.user.id;

  // volumes du jour
  const totalRows = await db(
    `
    SELECT COUNT(*) AS total
    FROM tasks t
    JOIN task_assignees ta ON ta.task_id = t.id
    WHERE ta.user_id = ?
      AND ${WHERE_TODAY}
    `,
    [uid]
  );

  const remRows = await db(
    `
    SELECT COUNT(*) AS remaining
    FROM tasks t
    JOIN task_assignees ta ON ta.task_id = t.id
    WHERE ta.user_id = ?
      AND ${WHERE_TODAY}
      AND t.status IN ('TODO','IN_PROGRESS')
    `,
    [uid]
  );

  const total = (totalRows && totalRows[0] && Number(totalRows[0].total)) || 0;
  const remaining = (remRows && remRows[0] && Number(remRows[0].remaining)) || 0;

  // dernière clôture
  const closedAt = await getLastCloseAt(uid);

  // nouveautés depuis la clôture : SESSIONS OU TÂCHES/ASSIGNATIONS
  let newAfterClose = false;
  if (closedAt) {
    // sessions du jour démarrées/terminées après closed_at
    const sess = await db(
      `
      SELECT COUNT(*) AS c
      FROM sessions
      WHERE user_id=?
        AND DATE(start_time)=CURDATE()
        AND (start_time > ? OR (end_time IS NOT NULL AND end_time > ?))
      `,
      [uid, closedAt, closedAt]
    );
    const sessionsAfter = (sess && sess[0] && Number(sess[0].c)) > 0;

    // tâches OU assignations créées/MAJ après closed_at
    const tchg = await db(
      `
      SELECT COUNT(*) AS c
      FROM tasks t
      JOIN task_assignees ta ON ta.task_id = t.id
      WHERE ta.user_id = ?
        AND ${WHERE_TODAY}
        AND (
             COALESCE(t.created_at,  '1970-01-01') > ?
          OR COALESCE(t.updated_at,  '1970-01-01') > ?
          OR COALESCE(ta.created_at, '1970-01-01') > ?
          OR COALESCE(ta.updated_at, '1970-01-01') > ?
        )
      `,
      [uid, closedAt, closedAt, closedAt, closedAt]
    );
    const tasksOrAssignAfter = (tchg && tchg[0] && Number(tchg[0].c)) > 0;

    newAfterClose = sessionsAfter || tasksOrAssignAfter;
  }

  res.json({
    success: true,
    data: {
      total_today: total,
      remaining_today: remaining,
      has_tasks: total > 0,
      has_remaining: remaining > 0,
      already_closed: !!closedAt,
      new_after_close: newAfterClose
    }
  });
}

module.exports = { myToday, myTodayWithTime, myTodayAvailability };
