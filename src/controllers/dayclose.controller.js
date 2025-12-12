const { query: db } = require('../config/db');

// Définition "tâches du jour" : due_date = aujourd’hui OU (due_date IS NULL ET created_at aujourd’hui)
const WHERE_TODAY = `
  (t.due_date = CURDATE() OR (t.due_date IS NULL AND DATE(t.created_at) = CURDATE()))
`;

async function hasOpenSession(uid) {
  const rows = await db(`
    SELECT id FROM sessions
    WHERE user_id=? AND end_time IS NULL
    LIMIT 1
  `, [uid]);
  return !!(rows && rows[0]);
}

async function computeTodayTotals(uid) {
  // temps total du jour
  const minsRow = await db(`
    SELECT COALESCE(SUM(duration_minutes),0) AS m
    FROM sessions
    WHERE user_id=? AND DATE(start_time)=CURDATE()
  `, [uid]);
  const totalMinutes = Number(minsRow?.[0]?.m || 0);

  // tâches DONE du jour (assignées à l’employé)
  const doneRow = await db(`
    SELECT COUNT(*) AS c
    FROM tasks t
    JOIN task_assignees ta ON ta.task_id = t.id
    WHERE ta.user_id=?
      AND ${WHERE_TODAY}
      AND t.status='DONE'
  `, [uid]);
  const tasksDone = Number(doneRow?.[0]?.c || 0);

  return { totalMinutes, tasksDone };
}

async function lastClose(uid) {
  const rows = await db(`
    SELECT id, close_date, closed_at, total_minutes, tasks_done
    FROM day_closes
    WHERE user_id=? AND close_date=CURDATE()
    ORDER BY closed_at DESC
    LIMIT 1
  `, [uid]);
  return rows?.[0] || null;
}

async function hasNewWorkSince(uid, ts) {
  if (!ts) return true; // sécu

  // Nouvelles sessions (ou mises à jour) depuis la dernière clôture
  const sess = await db(`
    SELECT COUNT(*) AS c
    FROM sessions
    WHERE user_id=?
      AND DATE(start_time)=CURDATE()
      AND (start_time > ? OR (end_time IS NOT NULL AND end_time > ?))
  `, [uid, ts, ts]);
  const sessionsAfter = Number(sess?.[0]?.c || 0) > 0;

  // Nouvelles tâches (créées/modifiées) depuis la clôture, non DONE prises en compte pour recalcul ou DONE en plus
  const tasks = await db(`
    SELECT COUNT(*) AS c
    FROM tasks t
    JOIN task_assignees ta ON ta.task_id = t.id
    WHERE ta.user_id=?
      AND ${WHERE_TODAY}
      AND (t.created_at > ? OR t.updated_at > ?)
  `, [uid, ts, ts]);
  const tasksAfter = Number(tasks?.[0]?.c || 0) > 0;

  return sessionsAfter || tasksAfter;
}

/** GET /day-close/preview */
async function preview(req, res) {
  const uid = req.user.id;

  const open = await hasOpenSession(uid);
  const lc = await lastClose(uid);
  const { totalMinutes, tasksDone } = await computeTodayTotals(uid);

  res.json({
    success: true,
    data: {
      date: new Date().toISOString().slice(0,10),
      open_session: open,
      already_closed: !!lc,
      last_closed_at: lc?.closed_at || null,
      total_minutes: totalMinutes,
      tasks_done: tasksDone
    }
  });
}

/** POST /day-close  { date?, comment? } — crée OU met à jour la clôture du jour */
async function closeDay(req, res) {
  const uid = req.user.id;
  const { comment = null } = req.body || {};

  // 1) Pas de session ouverte
  if (await hasOpenSession(uid)) {
    return res.status(409).json({ success: false, message: 'Arrête d’abord ta session.' });
  }

  // 2) Totaux du jour
  const { totalMinutes, tasksDone } = await computeTodayTotals(uid);

  // 3) Existe-t-il déjà une clôture ?
  const lc = await lastClose(uid);

  if (!lc) {
    // Création
    const result = await db(`
      INSERT INTO day_closes (user_id, close_date, total_minutes, tasks_done, comment, closed_at)
      VALUES (?, CURDATE(), ?, ?, ?, NOW())
    `, [uid, totalMinutes, tasksDone, comment]);
    const created = await db(`SELECT * FROM day_closes WHERE id=?`, [result.insertId]);
    return res.status(201).json({ success: true, data: created?.[0] || null });
  }

  // 4) Re-clôture : autorisée seulement si du nouveau depuis last closed_at
  const newSince = await hasNewWorkSince(uid, lc.closed_at);
  if (!newSince) {
    return res.status(409).json({
      success: false,
      message: 'Journée déjà clôturée (aucune nouvelle activité depuis la dernière clôture).'
    });
  }

  // Mettre à jour la clôture existante (re-clôture)
  await db(`
    UPDATE day_closes
       SET total_minutes=?, tasks_done=?, comment=?, closed_at=NOW()
     WHERE id=?
  `, [totalMinutes, tasksDone, comment, lc.id]);

  const updated = await db(`SELECT * FROM day_closes WHERE id=?`, [lc.id]);
  return res.json({ success: true, data: updated?.[0] || null });
}

/** GET /day-close/my */
async function myCloses(req, res) {
  const uid = req.user.id;
  const rows = await db(`
    SELECT id, close_date, total_minutes, tasks_done, closed_at, comment
    FROM day_closes
    WHERE user_id=?
    ORDER BY close_date DESC, closed_at DESC
    LIMIT 60
  `, [uid]);
  res.json({ success: true, data: rows || [] });
}

module.exports = { preview, closeDay, myCloses };
