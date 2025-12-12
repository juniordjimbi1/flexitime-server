const { query: db } = require('../config/db');

async function roleOf(userId) {
  const r = await db(`SELECT r.code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? LIMIT 1`, [userId]);
  return r?.[0]?.code || null;
}
function asDate(d) {
  try { return new Date(d).toISOString().slice(0,10); } catch { return null; }
}

/**
 * POST /admin/quick-tasks/create-assign
 * body: { title, description?, assignee_user_id, due_date }
 * Crée une tâche TODO et l’assigne à un utilisateur pour un jour donné.
 */
async function createAndAssign(req, res) {
  const me = req.user.id;
  const role = await roleOf(me);
  if (role !== 'ADMIN') return res.status(403).json({ success:false, message:'Accès refusé' });

  const { title, description = null, assignee_user_id, due_date } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ success:false, message:'Titre requis' });
  const uid = Number(assignee_user_id || 0);
  if (!uid) return res.status(400).json({ success:false, message:'assignee_user_id requis' });
  const date = asDate(due_date);
  if (!date) return res.status(400).json({ success:false, message:'due_date invalide' });

  // vérifier user
  const u = await db(`SELECT id FROM users WHERE id=?`, [uid]);
  if (!u?.[0]) return res.status(404).json({ success:false, message:'Utilisateur introuvable' });

  const ins = await db(
    `INSERT INTO tasks (title, description, status, due_date, created_by_user_id, created_at)
     VALUES (?, ?, 'TODO', ?, ?, NOW())`,
    [String(title).trim(), description || null, date, me]
  );
  const taskId = ins.insertId;

  await db(
    `INSERT IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, NOW())`,
    [taskId, uid]
  );

  const [task] = await db(`SELECT * FROM tasks WHERE id=?`, [taskId]);
  res.status(201).json({ success:true, data: task });
}

/**
 * POST /admin/quick-tasks/create-backlog
 * body: { title, description? }
 * Crée une tâche non planifiée et non assignée (backlog).
 */
async function createBacklog(req, res) {
  const me = req.user.id;
  const role = await roleOf(me);
  if (role !== 'ADMIN') return res.status(403).json({ success:false, message:'Accès refusé' });

  const { title, description = null } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ success:false, message:'Titre requis' });

  const ins = await db(
    `INSERT INTO tasks (title, description, status, due_date, created_by_user_id, created_at)
     VALUES (?, ?, 'TODO', NULL, ?, NOW())`,
    [String(title).trim(), description || null, me]
  );
  const [task] = await db(`SELECT * FROM tasks WHERE id=?`, [ins.insertId]);
  res.status(201).json({ success:true, data: task });
}

/**
 * POST /admin/quick-tasks/schedule
 * body: { task_id?, title?, description?, assignee_user_id, due_date, repeat_week=false }
 * - Si task_id fourni: planifie une tâche existante (met à jour due_date) et (optionnel) l’assigne.
 * - Si repeat_week = true: crée des clones pour LUN→VEN à partir de due_date.
 */
async function scheduleTask(req, res) {
  const me = req.user.id;
  const role = await roleOf(me);
  if (role !== 'ADMIN') return res.status(403).json({ success:false, message:'Accès refusé' });

  const { task_id = null, title = null, description = null, assignee_user_id, due_date, repeat_week = false } = req.body || {};
  const uid = Number(assignee_user_id || 0);
  if (!uid) return res.status(400).json({ success:false, message:'assignee_user_id requis' });
  const baseDate = asDate(due_date);
  if (!baseDate) return res.status(400).json({ success:false, message:'due_date invalide' });

  const user = await db(`SELECT id FROM users WHERE id=?`, [uid]);
  if (!user?.[0]) return res.status(404).json({ success:false, message:'Utilisateur introuvable' });

  // Helper pour cloner/créer une tâche au jour J et assigner uid
  async function createOne(dstr) {
    if (task_id) {
      // planifier une tâche existante à une nouvelle date + assignation
      await db(`UPDATE tasks SET due_date=?, updated_at=NOW() WHERE id=?`, [dstr, Number(task_id)]);
      await db(`INSERT IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, NOW())`, [Number(task_id), uid]);
      return Number(task_id);
    } else {
      // créer une nouvelle tâche à la date dstr
      const ins = await db(
        `INSERT INTO tasks (title, description, status, due_date, created_by_user_id, created_at)
         VALUES (?, ?, 'TODO', ?, ?, NOW())`,
        [String(title || 'Tâche').trim(), description || null, dstr, me]
      );
      const newId = ins.insertId;
      await db(`INSERT IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, NOW())`, [newId, uid]);
      return newId;
    }
  }

  const ids = [];
  if (repeat_week) {
    // génère lundi→vendredi de la semaine de baseDate
    const d = new Date(baseDate + 'T00:00:00');
    const day = d.getUTCDay(); // 0=dim … 6=sam
    const offsetToMon = ((day + 6) % 7); // combien de jours à reculer pour lundi
    // crée 5 jours (lundi à vendredi)
    for (let i = 0; i < 5; i++) {
      const di = new Date(d);
      di.setUTCDate(d.getUTCDate() - offsetToMon + i);
      const ymd = di.toISOString().slice(0,10);
      const newId = await createOne(ymd);
      ids.push(newId);
    }
  } else {
    ids.push(await createOne(baseDate));
  }

  res.status(201).json({ success:true, data: { task_ids: ids } });
}

module.exports = {
  createAndAssign,
  createBacklog,
  scheduleTask,
};
