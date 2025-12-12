const { query: db } = require('../config/db');


const WHERE_TODAY = `
  (t.due_date = CURDATE() OR (t.due_date IS NULL AND DATE(t.created_at) = CURDATE()))
`;

async function guardTasksToday(req, res, next) {
  const uid = req.user.id;
  const { task_id = null } = req.body || {};

  if (task_id) {
    const rows = await db(
      `SELECT project_id FROM tasks WHERE id = ? LIMIT 1`,
      [task_id]
    );
    const task = rows && rows[0];

    if (task && task.project_id !== null) {
      // Tâche liée à un projet -> on laisse passer, la logique
      // de "tâches du jour" reste réservée aux tâches hors projet.
      return next();
    }
  }

  // Dernière clôture du jour (si existe)
  const closedRows = await db(
    `SELECT closed_at
       FROM day_closes
      WHERE user_id=? AND close_date=CURDATE()
      ORDER BY closed_at DESC
      LIMIT 1`,
    [uid]
  );
  const closedAt =
    closedRows && closedRows[0] ? closedRows[0].closed_at : null;

  // Y a-t-il au moins une tâche du jour assignée non DONE ?
  const remainingRows = await db(
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
  const remaining = (remainingRows && remainingRows[0] && Number(remainingRows[0].remaining)) || 0;

  if (remaining === 0) {
    return res.status(409).json({
      success: false,
      message: 'Aucune tâche disponible pour aujourd’hui (ou toutes terminées).'
    });
  }

  // Si déjà clôturé : n'autoriser que s'il y a du "nouveau" depuis la clôture
  if (closedAt) {
    const newRows = await db(
      `
      SELECT COUNT(*) AS c
      FROM tasks t
      JOIN task_assignees ta ON ta.task_id = t.id
      WHERE ta.user_id = ?
        AND ${WHERE_TODAY}
        AND t.status IN ('TODO','IN_PROGRESS')
        AND (
             COALESCE(t.created_at,   '1970-01-01') > ?
          OR COALESCE(t.updated_at,   '1970-01-01') > ?
          OR COALESCE(ta.created_at,  '1970-01-01') > ?
          OR COALESCE(ta.updated_at,  '1970-01-01') > ?
        )
      `,
      [uid, closedAt, closedAt, closedAt, closedAt]
    );
    const newAfterClose = (newRows && newRows[0] && Number(newRows[0].c)) > 0;
    if (!newAfterClose) {
      return res.status(409).json({
        success: false,
        message: 'Journée déjà clôturée (aucune nouvelle tâche depuis la clôture).'
      });
    }
  }

  

  return next();
}

module.exports = { guardTasksToday };
