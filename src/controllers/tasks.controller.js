// server/src/controllers/tasks.controller.js
const { body, param, query, validationResult } = require('express-validator');
const { query: db } = require('../config/db');

function vErr(res, errors) {
  return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });
}

/* -------------------- Helpers équipe -------------------- */
async function isManagerOfTeam(userId, teamId) {
  if (!teamId) return false;
  const rows = await db(`SELECT id FROM teams WHERE id = ? AND manager_user_id = ? LIMIT 1`, [teamId, userId]);
  return !!rows[0];
}
async function getTaskTeamId(taskId) {
  const r = await db(`SELECT team_id FROM tasks WHERE id = ?`, [taskId]);
  return r[0]?.team_id || null;
}

/* -------------------- Helpers projet -------------------- */
async function projectExists(projectId) {
  if (projectId == null) return false;
  const r = await db(`SELECT id FROM projects WHERE id = ? LIMIT 1`, [projectId]);
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
async function getTaskProjectId(taskId) {
  const r = await db(`SELECT project_id FROM tasks WHERE id = ?`, [taskId]);
  return r[0]?.project_id ?? null;
}

/* -------------------- Utils parse filtres -------------------- */
function parseCSVInt(val) {
  if (val == null || val === '') return [];
  if (Array.isArray(val)) return val.map(Number).filter(Number.isInteger);
  return String(val)
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '')
    .map(n => Number(n))
    .filter(Number.isInteger);
}
function parseCSVStatus(val) {
  const allowed = new Set(['TODO','IN_PROGRESS','BLOCKED','DONE']);
  if (val == null || val === '') return [];
  const arr = Array.isArray(val) ? val : String(val).split(',');
  return arr.map(s => s.trim()).filter(s => allowed.has(s));
}

/* -------------------- Validators -------------------- */
const val = {
  list: [
    query('team_id').optional().isInt(),
    query('project_id').optional().toInt().isInt({ min: 1 }),
    query('status').optional(), // multi support (comma)

    // ⬇️ IMPORTANT : on ignore les valeurs "vides" ("" / null / 0) 
    query('due_from').optional({ checkFalsy: true }).isISO8601(),
    query('due_to').optional({ checkFalsy: true }).isISO8601(),
    query('assignees').optional({ checkFalsy: true }), // csv users ids
    query('labels').optional({ checkFalsy: true }),    // csv label ids

    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return vErr(res, errors);
      next();
    }
  ],
  create: [
    body('title').trim().isLength({ min: 2, max: 160 }),
    body('description').optional({ nullable: true }).isString(),
    body('priority').optional().isIn(['LOW','MEDIUM','HIGH']),
    body('team_id').optional({ nullable: true }).toInt().isInt({ min: 1 }),
    body('due_date').optional({ nullable: true }).isISO8601().toDate(),
    body('project_id').optional({ nullable: true }).toInt().isInt({ min: 1 }),
    body('status').optional().isIn(['TODO','IN_PROGRESS','DONE','BLOCKED']),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
  update: [
    param('id').toInt().isInt({ min: 1 }),
    body('title').optional().trim().isLength({ min: 2, max: 160 }),
    body('description').optional({ nullable: true }).isString(),
    body('priority').optional().isIn(['LOW','MEDIUM','HIGH']),
    body('status').optional().isIn(['TODO','IN_PROGRESS','DONE','BLOCKED']),
    body('team_id').optional({ nullable: true }).toInt().isInt({ min: 1 }),
    body('due_date').optional({ nullable: true }).isISO8601().toDate(),
    body('project_id').optional({ nullable: true }).custom(v => (v === null || Number.isInteger(v))),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
  assign: [
    param('id').isInt(),
    body('user_ids').isArray({ min: 0 }),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
  unassign: [
    param('id').isInt(),
    param('userId').isInt(),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
  my: [
    query('status').optional(), // multi support
    query('project_id').optional().toInt().isInt({ min: 1 }),
    query('due_from').optional().isISO8601(),
    query('due_to').optional().isISO8601(),
    query('labels').optional(), // csv label ids
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
  status: [
    param('id').isInt(),
    body('status').isIn(['TODO','IN_PROGRESS','DONE','BLOCKED']),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
  time: [
    param('id').toInt().isInt({ min: 1 }),
    (req, res, next) => { const e = validationResult(req); if (!e.isEmpty()) return vErr(res, e); next(); }
  ],
};

/* -------------------- Base SELECT -------------------- */
const TASK_BASE_SELECT = `
SELECT 
  t.id, t.title, t.description, t.status, t.priority, t.team_id, t.project_id, t.due_date, t.created_at, t.updated_at,
  tm.name AS team_name,
  sd.id AS subdepartment_id, sd.name AS subdep_name,
  d.id AS department_id, d.name AS department_name,
  CONCAT(u.first_name,' ',u.last_name) AS created_by_name
FROM tasks t
LEFT JOIN teams tm ON tm.id = t.team_id
LEFT JOIN subdepartments sd ON sd.id = tm.subdepartment_id
LEFT JOIN departments d ON d.id = sd.department_id
JOIN users u ON u.id = t.created_by_user_id
`;

/* -------------------- List tasks (Admin/Manager) -------------------- */
async function listTasks(req, res) {
  const role = req.user.role_code;
  const teamId = req.query.team_id ? Number(req.query.team_id) : null;
  const projectId = req.query.project_id ? Number(req.query.project_id) : null;

  // nouveaux filtres
  const statuses = parseCSVStatus(req.query.status);
  const dueFrom = req.query.due_from ? new Date(req.query.due_from) : null;
  const dueTo   = req.query.due_to ? new Date(req.query.due_to) : null;
  const assignees = parseCSVInt(req.query.assignees);
  const labels = parseCSVInt(req.query.labels);

  if (projectId) {
    const exists = await projectExists(projectId);
    if (!exists) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid project_id' });
    }
    const can = await userCanAccessProject(req.user, projectId);
    if (!can) {
      return res
        .status(403)
        .json({ success: false, message: 'Forbidden: no access to project' });
    }
  }

  const where = [];
  const params = [];
  let join = '';

  // EMPLOYEE : ne peut lister que les tâches des projets dont il est membre
  if (role === 'EMPLOYEE') {
    if (!projectId) {
      return res.status(403).json({
        success: false,
        message: 'Employees can only list tasks inside a project',
      });
    }

    join += ' JOIN project_members pm ON pm.project_id = t.project_id ';
    where.push('pm.user_id = ?');
    params.push(req.user.id);
  }

  if (statuses.length) {
    where.push(`t.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  if (dueFrom) {
    where.push('t.due_date IS NOT NULL AND t.due_date >= ?');
    params.push(req.query.due_from);
  }
  if (dueTo) {
    where.push('t.due_date IS NOT NULL AND t.due_date <= ?');
    params.push(req.query.due_to);
  }

  // Filtre assignees SANS dupliquer les tâches
  if (assignees.length) {
    where.push(`EXISTS (
      SELECT 1
      FROM task_assignees ta_f
      WHERE ta_f.task_id = t.id
        AND ta_f.user_id IN (${assignees.map(() => '?').join(',')})
    )`);
    params.push(...assignees);
  }

  // Filtre labels SANS dupliquer les tâches
  if (labels.length) {
    where.push(`EXISTS (
      SELECT 1
      FROM task_label_links tll
      WHERE tll.task_id = t.id
        AND tll.label_id IN (${labels.map(() => '?').join(',')})
    )`);
    params.push(...labels);
  }

  if (projectId) {
    where.push('t.project_id = ?');
    params.push(projectId);
  }
  if (teamId) {
    where.push('t.team_id = ?');
    params.push(teamId);
  }

  if (role === 'MANAGER') {
    if (projectId) {
      // accès projet déjà vérifié plus haut
    } else {
      where.push('tm.manager_user_id = ?');
      params.push(req.user.id);
    }
  }

  const rows = await db(
    `${TASK_BASE_SELECT} ${join} ${
      where.length ? 'WHERE ' + where.join(' AND ') : ''
    } ORDER BY t.created_at DESC`,
    params
  );

  const withAssignees = await attachAssigneesToTasks(rows);

  res.json({ success: true, data: withAssignees });
}



/* -------------------- Create task (Admin/Manager) -------------------- */
async function createTask(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);

  const { title, description = null, priority = 'MEDIUM', team_id = null, due_date = null } = req.body;
  let { project_id = null, status = 'TODO' } = req.body;

  if (team_id) {
    const teams = await db(`SELECT id, manager_user_id FROM teams WHERE id = ?`, [team_id]);
    if (!teams[0]) return res.status(400).json({ success: false, message: 'team_id invalide' });
    if (req.user.role_code === 'MANAGER' && teams[0].manager_user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Pas manager de cette équipe' });
    }
  }

  if (project_id !== null && project_id !== undefined) {
    project_id = Number(project_id);
    if (!(await projectExists(project_id))) {
      return res.status(400).json({ success: false, message: 'Invalid project_id' });
    }
    if (!(await userCanAccessProject(req.user, project_id))) {
      return res.status(403).json({ success: false, message: 'Forbidden: no access to project' });
    }
  } else {
    project_id = null; // hors projet
  }

    // Échéance par défaut = échéance du projet, si non fournie
  let finalDueDate = due_date;

  if (!finalDueDate && project_id) {
    const proj = await db(
      `SELECT end_date FROM projects WHERE id = ? LIMIT 1`,
      [project_id]
    );
    if (proj[0]?.end_date) {
      finalDueDate = proj[0].end_date;
    }
  }


      const result = await db(
    `INSERT INTO tasks (title, description, status, priority, team_id, project_id, created_by_user_id, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, description, status, priority, team_id || null, project_id, req.user.id, finalDueDate || null]
  );



  const created = await db(`${TASK_BASE_SELECT} WHERE t.id = ?`, [result.insertId]);
  res.status(201).json({ success: true, data: created[0] });
}

/* -------------------- Update task (Admin/Manager) -------------------- */
async function updateTask(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);

  const id = Number(req.params.id);

  const rows = await db(`SELECT id, team_id FROM tasks WHERE id = ?`, [id]);
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Tâche introuvable' });

  const oldTeam = rows[0].team_id;
  if (req.user.role_code === 'MANAGER') {
    let ok = await isManagerOfTeam(req.user.id, oldTeam);
    if (!ok) {
      const currentPid = await getTaskProjectId(id);
      let targetPid = currentPid;

      if (req.body.hasOwnProperty('project_id')) {
        if (req.body.project_id === null) {
          targetPid = currentPid;
        } else {
          targetPid = Number(req.body.project_id);
        }
      }

      if (targetPid) {
        ok = await userCanAccessProject(req.user, targetPid);
      } else {
        ok = false;
      }

      if (!ok) return res.status(403).json({ success: false, message: 'Interdit' });
    }
  }

  const { title, description, priority, status, team_id, due_date } = req.body;
  let { project_id } = req.body;

  if (team_id && req.user.role_code === 'MANAGER') {
    const ok = await isManagerOfTeam(req.user.id, team_id);
    if (!ok) return res.status(403).json({ success: false, message: 'Pas manager de la nouvelle équipe' });
  }

  const fields = [];
  const params = [];

  if (title !== undefined) { fields.push('title = ?'); params.push(title); }
  if (description !== undefined) { fields.push('description = ?'); params.push(description); }
  if (priority !== undefined) { fields.push('priority = ?'); params.push(priority); }
  if (status !== undefined) { fields.push('status = ?'); params.push(status); }
  if (team_id !== undefined) { fields.push('team_id = ?'); params.push(team_id || null); }
  if (due_date !== undefined) { fields.push('due_date = ?'); params.push(due_date || null); }

  if (req.body.hasOwnProperty('project_id')) {
    if (project_id === null) {
      fields.push('project_id = NULL');
    } else {
      project_id = Number(project_id);
      if (!(await projectExists(project_id))) {
        return res.status(400).json({ success: false, message: 'Invalid project_id' });
      }
      if (!(await userCanAccessProject(req.user, project_id))) {
        return res.status(403).json({ success: false, message: 'Forbidden: no access to project' });
      }
      fields.push('project_id = ?'); params.push(project_id);
    }
  }

  if (!fields.length) return res.json({ success: true, data: { id } });

  params.push(id);
  await db(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, params);

  const after = await db(`${TASK_BASE_SELECT} WHERE t.id = ?`, [id]);
  res.json({ success: true, data: after[0] });
}

/* -------------------- Delete task (Admin/Manager) -------------------- */
async function deleteTask(req, res) {
  const id = Number(req.params.id);
  const rows = await db(`SELECT id, team_id FROM tasks WHERE id = ?`, [id]);
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Tâche introuvable' });
  if (req.user.role_code === 'MANAGER') {
    const ok = await isManagerOfTeam(req.user.id, rows[0].team_id);
    if (!ok) return res.status(403).json({ success: false, message: 'Interdit' });
  }
  await db(`DELETE FROM tasks WHERE id = ?`, [id]);
  res.json({ success: true, data: { id } });
}

/* -------------------- Assign (remplace les assignations) -------------------- */
/* -------------------- Assign (remplace les assignations) -------------------- */
async function assignTask(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return vErr(res, errors);

  const id = Number(req.params.id);
  const userIds = Array.isArray(req.body.user_ids)
    ? req.body.user_ids.map(Number).filter((v) => Number.isInteger(v) && v > 0)
    : [];

  // On récupère équipe + projet de la tâche
  const t = await db(
    `SELECT id, team_id, project_id FROM tasks WHERE id = ?`,
    [id]
  );
  if (!t[0]) {
    return res
      .status(404)
      .json({ success: false, message: 'Tâche introuvable' });
  }

  const teamId = t[0].team_id;
  const projectId = t[0].project_id;

  // 1) Vérification des droits manager :
  //    - si tâche liée à une équipe, on garde la règle historique
  if (req.user.role_code === 'MANAGER' && teamId) {
    const ok = await isManagerOfTeam(req.user.id, teamId);
    if (!ok) {
      return res.status(403).json({ success: false, message: 'Interdit' });
    }
  }

  // 2) Validation des assignés
  if (userIds.length) {
    if (teamId) {
      // Cas historique : tâches d'équipe
      // ⚠️ MAJ : on autorise maintenant EMPLOYEE **et MANAGER** dans l'équipe
      const placeholders = userIds.map(() => '?').join(',');
      const rows = await db(
        `SELECT tm.user_id
           FROM team_members tm
           JOIN users u ON u.id = tm.user_id
           JOIN roles r ON r.id = u.role_id AND r.code IN ('EMPLOYEE','MANAGER')
         WHERE tm.team_id = ? AND tm.user_id IN (${placeholders})`,
        [teamId, ...userIds]
      );
      if (rows.length !== userIds.length) {
        return res.status(400).json({
          success: false,
          message:
            "Un ou plusieurs utilisateurs ne sont pas membres (EMPLOYEE ou MANAGER) de cette équipe",
        });
      }
    } else if (projectId) {
      // Nouveau cas : tâches liées uniquement à un projet
      const placeholders = userIds.map(() => '?').join(',');
      const rows = await db(
        `SELECT pm.user_id
           FROM project_members pm
           JOIN users u ON u.id = pm.user_id
           JOIN roles r ON r.id = u.role_id AND r.code IN ('EMPLOYEE','MANAGER')
         WHERE pm.project_id = ? AND pm.user_id IN (${placeholders})`,
        [projectId, ...userIds]
      );
      if (rows.length !== userIds.length) {
        return res.status(400).json({
          success: false,
          message:
            'Certains utilisateurs sélectionnés ne sont pas membres de ce projet',
        });
      }
    } else {
      // Pas d'équipe ni de projet : mode libre → aucun contrôle supplémentaire
    }
  }

  // 3) On remplace les assignés
  await db(`DELETE FROM task_assignees WHERE task_id = ?`, [id]);
  if (userIds.length) {
    const values = userIds.map(() => '(?, ?)').join(',');
    await db(
      `INSERT INTO task_assignees (task_id, user_id) VALUES ${values}`,
      userIds.flatMap((u) => [id, u])
    );
  }

  const assignees = await db(
    `SELECT u.id, u.first_name, u.last_name, u.email
       FROM task_assignees ta
       JOIN users u ON u.id = ta.user_id
     WHERE ta.task_id = ?
     ORDER BY u.first_name, u.last_name`,
    [id]
  );

  return res.json({ success: true, data: { task_id: id, assignees } });
}

async function attachAssigneesToTasks(rows) {
  if (!rows || !rows.length) return rows;

  const taskIds = rows.map((r) => r.id);
  const placeholders = taskIds.map(() => '?').join(',');

  const assRows = await db(
    `
    SELECT 
      ta.task_id,
      u.id AS user_id,
      CONCAT(u.first_name, ' ', u.last_name) AS full_name,
      u.email
    FROM task_assignees ta
    JOIN users u ON u.id = ta.user_id
    WHERE ta.task_id IN (${placeholders})
    `,
    taskIds
  );

  const byTask = {};
  for (const row of assRows) {
    if (!byTask[row.task_id]) byTask[row.task_id] = [];
    byTask[row.task_id].push({
      user_id: row.user_id,
      full_name: row.full_name,
      email: row.email,
    });
  }

  return rows.map((t) => ({
    ...t,
    assignees: byTask[t.id] || [],
  }));
}



/* -------------------- Unassign one -------------------- */
async function unassignOne(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);

  const id = Number(req.params.id);
  const userId = Number(req.params.userId);

  const t = await db(`SELECT id, team_id FROM tasks WHERE id = ?`, [id]);
  if (!t[0]) return res.status(404).json({ success: false, message: 'Tâche introuvable' });
  if (req.user.role_code === 'MANAGER') {
    const ok = await isManagerOfTeam(req.user.id, t[0].team_id);
    if (!ok) return res.status(403).json({ success: false, message: 'Interdit' });
  }

  await db(`DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?`, [id, userId]);
  res.json({ success: true, data: { task_id: id, user_id: userId } });
}

/* -------------------- Mes tâches (Employee) -------------------- */
async function myTasks(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);

  const projectId = req.query.project_id ? Number(req.query.project_id) : null;
  const statuses = parseCSVStatus(req.query.status);
  const dueFrom = req.query.due_from ? new Date(req.query.due_from) : null;
  const dueTo   = req.query.due_to ? new Date(req.query.due_to) : null;
  const labels  = parseCSVInt(req.query.labels);

  const where = ['ta.user_id = ?'];
  const params = [req.user.id];
  let join = ' JOIN task_assignees ta ON ta.task_id = t.id ';

  if (projectId) { where.push('t.project_id = ?'); params.push(projectId); }
  if (statuses.length) { where.push(`t.status IN (${statuses.map(()=>'?').join(',')})`); params.push(...statuses); }
  if (dueFrom) { where.push('t.due_date IS NOT NULL AND t.due_date >= ?'); params.push(req.query.due_from); }
  if (dueTo)   { where.push('t.due_date IS NOT NULL AND t.due_date <= ?'); params.push(req.query.due_to); }
    if (labels.length) {
    where.push(`EXISTS (
      SELECT 1
      FROM task_label_links tll
      WHERE tll.task_id = t.id
        AND tll.label_id IN (${labels.map(() => '?').join(',')})
    )`);
    params.push(...labels);
  }

  const rows = await db(
    `${TASK_BASE_SELECT} ${join}
     WHERE ${where.join(' AND ')}
     ORDER BY t.updated_at DESC`,
    params
  );

  const withAssignees = await attachAssigneesToTasks(rows);

  res.json({ success: true, data: withAssignees });
}


/* -------------------- Update status -------------------- */
async function updateStatus(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return vErr(res, errors);
  }

  const id = Number(req.params.id);
  const { status } = req.body;

  // On récupère aussi project_id pour éviter une requête séparée
  const rows = await db(
    'SELECT id, team_id, project_id FROM tasks WHERE id = ?',
    [id]
  );

  const task = rows[0];
  if (!task) {
    return res
      .status(404)
      .json({ success: false, message: 'Tâche introuvable' });
  }

  const role = req.user.role_code;
  const userId = req.user.id;

  let allowed = false;

  if (role === 'ADMIN') {
    // L’admin peut toujours changer le statut
    allowed = true;
  } else if (role === 'EMPLOYEE') {
    // L’employé doit être assigné à la tâche
    const ok = await db(
      'SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ? LIMIT 1',
      [id, userId]
    );
    if (ok[0]) {
      allowed = true;
    } else {
      return res.status(403).json({
        success: false,
        message: 'Vous devez être assigné à cette tâche',
      });
    }
  } else if (role === 'MANAGER') {
    // Un manager peut modifier :
    // - les tâches de son équipe
    // - ou les tâches d’un projet sur lequel il a des droits
    let ok = false;

    if (task.team_id) {
      ok = await isManagerOfTeam(userId, task.team_id);
    }

    if (!ok && task.project_id) {
      ok = await userCanAccessProject(req.user, task.project_id);
    }

    if (!ok) {
      return res.status(403).json({
        success: false,
        message: 'Interdit',
      });
    }

    allowed = true;
  }

  if (!allowed) {
    // Cas de rôle inconnu / non géré
    return res.status(403).json({
      success: false,
      message: 'Interdit',
    });
  }

  // Mise à jour du statut
  await db('UPDATE tasks SET status = ? WHERE id = ?', [status, id]);

  const after = await db(`${TASK_BASE_SELECT} WHERE t.id = ?`, [id]);
  return res.json({ success: true, data: after[0] });
}


/**
 * GET /tasks/:id/time-tracking
 * Retourne un résumé du temps passé sur une tâche à partir de task_checklist_time_logs.
 */
// [P18] Time tracking pour une tâche (basé sur les sessions)
async function getTimeTracking(req, res) {
  const id = Number(req.params.id);
  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: 'Task id invalide' });
  }

  // Charger la tâche pour vérifier l’accès
  const taskRows = await db(
    `SELECT id, team_id, project_id FROM tasks WHERE id = ?`,
    [id]
  );
  if (!taskRows[0]) {
    return res
      .status(404)
      .json({ success: false, message: 'Tâche introuvable' });
  }
  const task = taskRows[0];

  const role = req.user.role_code;
  const uid = req.user.id;

  let allowed = false;

  if (role === 'ADMIN') {
    allowed = true;
  } else if (role === 'EMPLOYEE') {
    // doit être assigné à la tâche
    const ok = await db(
      `SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ? LIMIT 1`,
      [id, uid]
    );
    allowed = !!ok[0];
  } else if (role === 'MANAGER') {
    // manager de l’équipe OU accès au projet
    if (task.team_id) {
      allowed = await isManagerOfTeam(uid, task.team_id);
    }
    if (!allowed && task.project_id) {
      allowed = await userCanAccessProject(req.user, task.project_id);
    }
  }

  if (!allowed) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  // Récupérer toutes les sessions stoppées associées à cette tâche
  const sessions = await db(
    `SELECT id, user_id, start_time, end_time, duration_minutes
       FROM sessions
      WHERE task_id = ?
        AND duration_minutes IS NOT NULL
      ORDER BY start_time ASC`,
    [id]
  );

  let total = 0;
  const byDay = {};
  const byUser = {};

  for (const s of sessions) {
    const minutes = Number(s.duration_minutes || 0);
    total += minutes;

    const day =
      (s.start_time && s.start_time.toISOString
        ? s.start_time.toISOString().slice(0, 10)
        : null) ||
      (s.end_time && s.end_time.toISOString
        ? s.end_time.toISOString().slice(0, 10)
        : null);

    const keyDay = day || 'N/A';
    byDay[keyDay] = (byDay[keyDay] || 0) + minutes;

    const uidKey = String(s.user_id);
    byUser[uidKey] = (byUser[uidKey] || 0) + minutes;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayMinutes = byDay[todayStr] || 0;

  return res.json({
    success: true,
    data: {
      task_id: id,
      total_minutes: total,
      today_minutes: todayMinutes,
      by_day: byDay,
      by_user: byUser,
    },
  });
}


module.exports = {
  val,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  assignTask,
  unassignOne,
  myTasks,
  updateStatus,
  getTimeTracking,
};

