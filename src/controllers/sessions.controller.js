const { query: db } = require('../config/db');

/**
 * Helpers repris de tasks.controller.js
 * (pas d'import croisé pour éviter les cycles)
 */
async function isManagerOfTeam(userId, teamId) {
  if (!teamId) return false;
  const rows = await db(
    'SELECT id FROM teams WHERE id = ? AND manager_user_id = ? LIMIT 1',
    [teamId, userId]
  );
  return !!rows[0];
}

async function userCanAccessProject(user, projectId) {
  if (!projectId) return false;
  if (user.role_code === 'ADMIN') return true;
  const rows = await db(
    `
    SELECT 1
    FROM projects p
    LEFT JOIN project_members pm
      ON pm.project_id = p.id
     AND pm.user_id = ?
    WHERE p.id = ?
      AND (
        p.manager_id = ?
        OR p.created_by = ?
        OR pm.user_id IS NOT NULL
      )
    LIMIT 1
  `,
    [user.id, projectId, user.id, user.id]
  );
  return !!rows[0];
}

async function isAssignee(userId, taskId) {
  if (!taskId) return false;
  const rows = await db(
    'SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ? LIMIT 1',
    [taskId, userId]
  );
  return !!rows[0];
}

/**
 * GET /sessions/my?date=YYYY-MM-DD
 * Liste les sessions de l'utilisateur courant (option date)
 */
async function listMy(req, res) {
  const uid = req.user.id;
  const { date } = req.query || {};
  const params = [uid];
  let whereDate = '';
  if (date) {
    whereDate = ' AND DATE(s.start_time) = ?';
    params.push(date);
  }

  const rows = await db(
    `
    SELECT
      s.id,
      s.user_id,
      s.task_id,
      s.start_time,
      s.end_time,
      s.duration_minutes,
      t.title        AS task_title,
      t.project_id   AS task_project_id,
      t.team_id      AS task_team_id
    FROM sessions s
    LEFT JOIN tasks t ON t.id = s.task_id
    WHERE s.user_id = ?
      ${whereDate}
    ORDER BY s.start_time DESC
  `,
    params
  );

  return res.json({ success: true, data: rows });
}

/**
 * GET /sessions/my/open
 * Retourne la session ouverte de l'utilisateur (s'il y en a une)
 */
async function getOpen(req, res) {
  const uid = req.user.id;
  const rows = await db(
    `
    SELECT
      s.id,
      s.user_id,
      s.task_id,
      s.start_time,
      s.end_time,
      s.duration_minutes
    FROM sessions s
    WHERE s.user_id = ?
      AND s.end_time IS NULL
    ORDER BY s.start_time DESC
    LIMIT 1
  `,
    [uid]
  );

  return res.json({ success: true, data: rows[0] || null });
}

/**
 * POST /sessions/start
 * body: { task_id?: number }
 *
 * - Un seul timer ouvert par utilisateur
 * - RBAC:
 *   - ADMIN: ok sur toutes les tâches
 *   - MANAGER: ok si manager de l'équipe OU accès au projet
 *   - EMPLOYEE: ok seulement si assigné à la tâche
 * - Si task_id fourni et que la tâche n'est pas DONE, on la passe en IN_PROGRESS
 */
async function start(req, res) {
  const uid = req.user.id;
  const user = req.user;
  const { task_id = null } = req.body || {};

  // Vérifier qu'aucune session ouverte n'existe déjà
  const openRows = await db(
    'SELECT id FROM sessions WHERE user_id = ? AND end_time IS NULL LIMIT 1',
    [uid]
  );
  if (openRows[0]) {
    return res.status(400).json({
      success: false,
      message: 'Une session est déjà en cours',
    });
  }

  let task = null;

  if (task_id) {
    const rows = await db(
      `
      SELECT id, team_id, project_id, status
      FROM tasks
      WHERE id = ?
      LIMIT 1
    `,
      [task_id]
    );
    if (!rows[0]) {
      return res
        .status(404)
        .json({ success: false, message: 'Tâche introuvable' });
    }
    task = rows[0];

    // RBAC spécifique à la tâche
    if (user.role_code === 'EMPLOYEE') {
      const ok = await isAssignee(uid, task_id);
      if (!ok) {
        return res.status(403).json({
          success: false,
          message: 'Vous devez être assigné à cette tâche pour démarrer une session',
        });
      }
    } else if (user.role_code === 'MANAGER') {
      let ok = false;

      // Manager d'équipe ?
      if (task.team_id) {
        ok = await isManagerOfTeam(uid, task.team_id);
      }

      // Sinon, accès au projet ?
      if (!ok && task.project_id) {
        ok = await userCanAccessProject(user, task.project_id);
      }

      if (!ok) {
        return res.status(403).json({
          success: false,
          message: "Vous n'avez pas les droits sur cette tâche",
        });
      }
    }
    // ADMIN: ok par défaut
  }

  // Créer la session
  const insertRes = await db(
    `
    INSERT INTO sessions (user_id, task_id, start_time, created_at)
    VALUES (?, ?, NOW(), NOW())
  `,
    [uid, task_id || null]
  );

  const sid = insertRes.insertId;

  // Si une tâche est associée et pas encore DONE, la passer en IN_PROGRESS
  if (task && task.status !== 'DONE') {
    await db(
      `
      UPDATE tasks
      SET status = 'IN_PROGRESS'
      WHERE id = ?
        AND status <> 'DONE'
    `,
      [task_id]
    );
  }

  const created = await db(
    `
    SELECT
      id,
      user_id,
      task_id,
      start_time,
      end_time,
      duration_minutes
    FROM sessions
    WHERE id = ?
  `,
    [sid]
  );

  return res.status(201).json({ success: true, data: created[0] });
}

/**
 * POST /sessions/stop
 * body: { session_id }
 *
 * - Seul le propriétaire de la session peut l'arrêter (ADMIN compris)
 */
async function stop(req, res) {
  const uid = req.user.id;
  const { session_id } = req.body || {};

  if (!session_id) {
    return res
      .status(400)
      .json({ success: false, message: 'session_id requis' });
  }

  const rows = await db(
    `
    SELECT
      id,
      user_id,
      task_id,
      start_time,
      end_time,
      duration_minutes
    FROM sessions
    WHERE id = ?
    LIMIT 1
  `,
    [session_id]
  );

  const session = rows[0];
  if (!session) {
    return res
      .status(404)
      .json({ success: false, message: 'Session introuvable' });
  }

  if (session.user_id !== uid) {
    return res.status(403).json({
      success: false,
      message: 'Vous ne pouvez arrêter que vos propres sessions',
    });
  }

  if (session.end_time) {
    return res.status(400).json({
      success: false,
      message: 'Cette session est déjà terminée',
    });
  }

  // Calcul de la durée en minutes
  const durationRows = await db(
    `
    SELECT TIMESTAMPDIFF(
      MINUTE,
      start_time,
      NOW()
    ) AS diff
    FROM sessions
    WHERE id = ?
  `,
    [session_id]
  );
  const duration = durationRows[0]?.diff ?? null;

  await db(
    `
    UPDATE sessions
    SET end_time = NOW(),
        duration_minutes = ?
    WHERE id = ?
  `,
    [duration, session_id]
  );

  const updated = await db(
    `
    SELECT
      id,
      user_id,
      task_id,
      start_time,
      end_time,
      duration_minutes
    FROM sessions
    WHERE id = ?
  `,
    [session_id]
  );

  return res.json({ success: true, data: updated[0] });
}

module.exports = { listMy, getOpen, start, stop };
