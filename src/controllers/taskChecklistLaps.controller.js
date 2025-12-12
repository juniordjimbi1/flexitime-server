// server/src/controllers/taskChecklistLaps.controller.js
const { query: db } = require('../config/db');

/**
 * GET /tasks/:taskId/checklist/:itemId/laps?page=&limit=
 * Simple historique des laps (segments de travail) pour un item de checklist.
 */
async function listByItem(req, res) {
  const taskId = Number(req.params.taskId);
  const itemId = Number(req.params.itemId);
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
  const offset = (page - 1) * limit;

  const totalRows = await db(
    'SELECT COUNT(*) AS n FROM task_checklist_laps WHERE task_id = ? AND task_checklist_item_id = ?',
    [taskId, itemId]
  );
  const total = Number(totalRows?.[0]?.n || 0);

  // Agrégat de temps pour cet item (somme des durées de tous les laps)
  const sumRows = await db(
    'SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds FROM task_checklist_laps WHERE task_id = ? AND task_checklist_item_id = ?',
    [taskId, itemId]
  );
  const totalSeconds = Number(sumRows?.[0]?.total_seconds || 0);
  const totalMinutes = Math.round(totalSeconds / 60);
  
  const rows = await db(
    `SELECT
       id,
       task_checklist_item_id,
       task_id,
       user_id,
       session_id,
       started_at,
       ended_at,
       duration_seconds,
       created_at
     FROM task_checklist_laps
     WHERE task_id = ? AND task_checklist_item_id = ?
     ORDER BY started_at ASC
     LIMIT ? OFFSET ?`,
    [taskId, itemId, limit, offset]
  );

   return res.json({
    success: true,
    data: {
      total,
      page,
      limit,
      items: rows,
      total_seconds: totalSeconds,
      total_minutes: totalMinutes,
    },
  });
}


/**
 * Hook appelé quand un item de checklist passe à is_done = true.
 *
 * Règle :
 *  - On ne logge que si l'utilisateur a une session OUVERTE
 *    pour cette tâche (session.task_id = taskId, end_time IS NULL).
 *  - On découpe le temps en "laps" :
 *      - started_at = start_time de la session OU dernier ended_at d'un lap précédent
 *      - ended_at   = NOW()
 *      - duration_seconds = TIMESTAMPDIFF(SECOND, started_at, NOW())
 *  - On alimente aussi task_checklist_time_logs pour avoir des minutes par jour.
 *
 *  Cette logique est réservée aux tâches de PROJET :
 *    - si tasks.project_id IS NULL, on ne crée rien (hors projet -> flux journée).
 */
async function hookLapOnDone({ userId, taskId, itemId }) {
  if (!userId || !taskId || !itemId) return;

  // 1) Vérifier que la tâche est bien liée à un projet
  const taskRows = await db(
    'SELECT id, project_id FROM tasks WHERE id = ? LIMIT 1',
    [taskId]
  );
  const task = taskRows?.[0];
  if (!task || task.project_id == null) {
    // Tâche hors projet : on ne traque pas le temps au niveau checklist
    return;
  }

  // 2) Chercher une session ouverte pour cet utilisateur sur CETTE tâche
  const sessionRows = await db(
    `SELECT id, start_time
     FROM sessions
     WHERE user_id = ?
       AND task_id = ?
       AND end_time IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [userId, taskId]
  );
  const session = sessionRows?.[0];
  if (!session) {
    // Pas de session en cours -> pas de log
    return;
  }

  // 3) Déterminer le point de départ du segment :
  //    - dernier lap existant pour cette session & cette tâche
  //    - sinon, start_time de la session
  const lastLapRows = await db(
    `SELECT ended_at
     FROM task_checklist_laps
     WHERE task_id = ?
       AND user_id = ?
       AND session_id = ?
     ORDER BY ended_at DESC
     LIMIT 1`,
    [taskId, userId, session.id]
  );
  const lastLap = lastLapRows?.[0];
  const startedFrom = lastLap?.ended_at || session.start_time;

  // 4) Créer un lap + calculer la durée en secondes
  const durationRows = await db(
    'SELECT TIMESTAMPDIFF(SECOND, ?, NOW()) AS seconds, CURDATE() AS log_date',
    [startedFrom]
  );
  const durationSeconds = Math.max(
    0,
    Number(durationRows?.[0]?.seconds || 0)
  );
  const logDate = durationRows?.[0]?.log_date;

  if (!durationSeconds) {
    // Si la durée est 0, on évite d'insérer du bruit
    return;
  }

  await db(
    `INSERT INTO task_checklist_laps
       (task_checklist_item_id, task_id, user_id, session_id, started_at, ended_at, duration_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, NOW(), ?, NOW())`,
    [itemId, taskId, userId, session.id, startedFrom, durationSeconds]
  );

  // 5) Enregistrer également un log agrégé en minutes dans task_checklist_time_logs
  const minutesSpent = Math.max(1, Math.round(durationSeconds / 60));

  await db(
    `INSERT INTO task_checklist_time_logs
       (task_id, checklist_item_id, user_id, session_id, log_date, minutes_spent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [taskId, itemId, userId, session.id, logDate, minutesSpent]
  );
}

module.exports = { listByItem, hookLapOnDone };
