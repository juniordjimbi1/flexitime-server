const { query: db } = require('../config/db');

/** Utils */
function iso(d) { return new Date(d).toISOString().slice(0,10); }
const WEEKDAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

/** Vérifie rôle MANAGER ou ADMIN */
async function getRoleCode(userId) {
  const r = await db(`
    SELECT r.code
    FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = ? LIMIT 1
  `, [userId]);
  return r?.[0]?.code || null;
}

/** Vérifie que l'utilisateur est dans l'équipe d'un manager */
async function isMemberOfMyTeam(managerId, userId) {
  const r = await db(`
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ? AND t.manager_user_id = ?
    LIMIT 1
  `, [userId, managerId]);
  return !!r?.[0];
}

/** Récupère une tâche base (pour dupliquer / utiliser comme modèle) */
async function getTaskById(id) {
  const r = await db(`SELECT * FROM tasks WHERE id=? LIMIT 1`, [id]);
  return r?.[0] || null;
}

/** Liste des brouillons = tâches sans due_date et sans assignés */
async function listDrafts(req, res) {
  const me = req.user;
  const role = await getRoleCode(me.id);

  // Admin : tous; Manager : uniquement celles liées à ses équipes OU sans team (NULL)
  let rows;
  if (role === 'ADMIN') {
    rows = await db(`
      SELECT t.*, tm.name AS team_name, sd.name AS subdep, d.name AS dep
      FROM tasks t
      LEFT JOIN teams tm ON tm.id = t.team_id
      LEFT JOIN subdepartments sd ON sd.id = tm.subdepartment_id
      LEFT JOIN departments d ON d.id = sd.department_id
      WHERE t.due_date IS NULL
        AND NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id)
      ORDER BY t.updated_at DESC, t.id DESC
    `);
  } else if (role === 'MANAGER') {
    rows = await db(`
      SELECT t.*, tm.name AS team_name, sd.name AS subdep, d.name AS dep
      FROM tasks t
      LEFT JOIN teams tm ON tm.id = t.team_id
      LEFT JOIN subdepartments sd ON sd.id = tm.subdepartment_id
      LEFT JOIN departments d ON d.id = sd.department_id
      WHERE t.due_date IS NULL
        AND NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id)
        AND (t.team_id IS NULL OR EXISTS (
          SELECT 1 FROM teams t2 WHERE t2.id = t.team_id AND t2.manager_user_id = ?
        ))
      ORDER BY t.updated_at DESC, t.id DESC
    `, [me.id]);
  } else {
    return res.status(403).json({ success: false, message: 'Accès refusé' });
  }

  res.json({ success: true, data: rows || [] });
}

/** Création d’un brouillon : pas d’assignation, pas de due_date */
async function createDraft(req, res) {
  const me = req.user;
  const role = await getRoleCode(me.id);
  if (!['ADMIN','MANAGER'].includes(role)) {
    return res.status(403).json({ success: false, message: 'Accès refusé' });
  }

  const { title, description = null, team_id = null } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, message: 'Titre requis' });
  }

  const result = await db(`
    INSERT INTO tasks (title, description, status, team_id, due_date, created_at, updated_at)
    VALUES (?, ?, 'TODO', ?, NULL, NOW(), NOW())
  `, [title.trim(), description || null, team_id || null]);
  const created = await getTaskById(result.insertId);
  res.status(201).json({ success: true, data: created });
}

/** Programme une tâche pour un jour donné (crée une tâche avec due_date + assignés) */
async function scheduleOneDay(req, res) {
  const me = req.user;
  const role = await getRoleCode(me.id);
  if (!['ADMIN','MANAGER'].includes(role)) {
    return res.status(403).json({ success: false, message: 'Accès refusé' });
  }

  const {
    from_task_id = null, // facultatif: modèle existant
    title = null, description = null,
    team_id = null,
    due_date,                              // YYYY-MM-DD requis
    assignees = []                         // array d'user_id
  } = req.body || {};

  if (!due_date) return res.status(400).json({ success: false, message: 'due_date requis (YYYY-MM-DD)' });
  if (!Array.isArray(assignees) || assignees.length === 0) {
    return res.status(400).json({ success: false, message: 'Assignez au moins un membre' });
  }

  let base = null;
  if (from_task_id) {
    base = await getTaskById(from_task_id);
    if (!base) return res.status(404).json({ success: false, message: 'Tâche modèle introuvable' });
  }

  const tTitle = (title ?? base?.title ?? '').trim();
  if (!tTitle) return res.status(400).json({ success: false, message: 'Titre requis' });

  const tDesc = description ?? base?.description ?? null;
  const tTeam = team_id ?? base?.team_id ?? null;

  // Côté manager : sécurité, vérifier que chaque assignee est bien dans son équipe si team est défini
  if (role === 'MANAGER') {
    for (const uid of assignees) {
      const ok = await isMemberOfMyTeam(me.id, uid);
      if (!ok) return res.status(403).json({ success: false, message: `Utilisateur ${uid} hors de votre équipe` });
    }
  }

  // Créer la tâche du jour
  const ins = await db(`
    INSERT INTO tasks (title, description, status, team_id, due_date, created_at, updated_at)
    VALUES (?, ?, 'TODO', ?, ?, NOW(), NOW())
  `, [tTitle, tDesc, tTeam, iso(due_date)]);

  const newTaskId = ins.insertId;

  // Assignations multiples
  for (const uid of assignees) {
    await db(`INSERT INTO task_assignees (task_id, user_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())`, [newTaskId, uid]);
  }

  const created = await getTaskById(newTaskId);
  res.status(201).json({ success: true, data: created });
}

/** Programme une semaine : crée une tâche par jour sélectionné dans la semaine */
async function scheduleWeek(req, res) {
  const me = req.user;
  const role = await getRoleCode(me.id);
  if (!['ADMIN','MANAGER'].includes(role)) {
    return res.status(403).json({ success: false, message: 'Accès refusé' });
  }

  const {
    from_task_id = null,
    title = null, description = null,
    team_id = null,
    week_start,                     // YYYY-MM-DD, lundi (ou n'importe → on normalise)
    days = [],                      // ex: ['MON','WED','FRI']
    assignees = []
  } = req.body || {};

  if (!week_start) return res.status(400).json({ success: false, message: 'week_start requis' });
  if (!Array.isArray(days) || days.length === 0) {
    return res.status(400).json({ success: false, message: 'Sélectionnez au moins un jour' });
  }
  if (!Array.isArray(assignees) || assignees.length === 0) {
    return res.status(400).json({ success: false, message: 'Assignez au moins un membre' });
  }

  // Normalisation des jours
  const wanted = new Set(days.map(s => String(s).toUpperCase()));
  const validDays = WEEKDAYS.filter(d => wanted.has(d));
  if (validDays.length === 0) return res.status(400).json({ success: false, message: 'Jours invalides' });

  let base = null;
  if (from_task_id) {
    base = await getTaskById(from_task_id);
    if (!base) return res.status(404).json({ success: false, message: 'Tâche modèle introuvable' });
  }

  const tTitle = (title ?? base?.title ?? '').trim();
  if (!tTitle) return res.status(400).json({ success: false, message: 'Titre requis' });

  const tDesc = description ?? base?.description ?? null;
  const tTeam = team_id ?? base?.team_id ?? null;

  // Sécurité manager : assignees appartiennent à ses équipes
  if (role === 'MANAGER') {
    for (const uid of assignees) {
      const ok = await isMemberOfMyTeam(me.id, uid);
      if (!ok) return res.status(403).json({ success: false, message: `Utilisateur ${uid} hors de votre équipe` });
    }
  }

  // Calcule les dates de la semaine à partir de week_start
  const start = new Date(week_start);
  if (isNaN(start.getTime())) return res.status(400).json({ success: false, message: 'week_start invalide' });

  // On crée une map weekday->offset depuis start (en supposant start=Lundi)
  const OFFSETS = { MON:0, TUE:1, WED:2, THU:3, FRI:4, SAT:5, SUN:6 };

  const createdTasks = [];

  for (const wd of validDays) {
    const d = new Date(start);
    d.setDate(d.getDate() + OFFSETS[wd]);

    // Crée la tâche du jour
    const ins = await db(`
      INSERT INTO tasks (title, description, status, team_id, due_date, created_at, updated_at)
      VALUES (?, ?, 'TODO', ?, ?, NOW(), NOW())
    `, [tTitle, tDesc, tTeam, iso(d)]);

    const newTaskId = ins.insertId;

    for (const uid of assignees) {
      await db(`INSERT INTO task_assignees (task_id, user_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())`, [newTaskId, uid]);
    }

    createdTasks.push({ id: newTaskId, due_date: iso(d) });
  }

  res.status(201).json({ success: true, data: createdTasks });
}

module.exports = {
  listDrafts,
  createDraft,
  scheduleOneDay,
  scheduleWeek
};
