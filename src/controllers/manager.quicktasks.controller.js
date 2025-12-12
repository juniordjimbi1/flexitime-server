const { query: db } = require('../config/db');

async function roleOf(userId) {
  const r = await db(`SELECT r.code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? LIMIT 1`, [userId]);
  return r?.[0]?.code || null;
}
const iso = (d) => { try { return new Date(d).toISOString().slice(0,10); } catch { return null; } };

async function assertOwnTeam(managerId, teamId) {
  const r = await db(`SELECT id FROM teams WHERE id=? AND manager_user_id=? LIMIT 1`, [teamId, managerId]);
  return !!(r && r[0]);
}
async function assertMemberOfTeam(teamId, userId) {
  const r = await db(`SELECT 1 FROM team_members WHERE team_id=? AND user_id=? LIMIT 1`, [teamId, userId]);
  return !!(r && r[0]);
}

/** GET /manager/quick-tasks/backlog?limit=20
 *  Liste des tâches créées par le manager sans due_date (à programmer plus tard)
 */
async function backlog(req, res) {
  const me = req.user.id;
  const rows = await db(
    `SELECT id, title, description, status, created_at
       FROM tasks
      WHERE created_by_user_id=? AND due_date IS NULL
      ORDER BY id DESC
      LIMIT ?`,
    [me, Math.min(100, Number(req.query?.limit || 20))]
  );
  res.json({ success: true, data: rows || [] });
}

/** POST /manager/quick-tasks/create-backlog
 *  body: { title, description? }
 */
async function createBacklog(req, res) {
  const me = req.user.id;
  const role = await roleOf(me);
  if (!['MANAGER','ADMIN'].includes(role)) return res.status(403).json({ success:false, message:'Accès refusé' });

  const { title, description=null } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ success:false, message:'Titre requis' });

  const ins = await db(
    `INSERT INTO tasks (title, description, status, due_date, created_by_user_id, created_at)
     VALUES (?, ?, 'TODO', NULL, ?, NOW())`,
    [String(title).trim(), description || null, me]
  );
  const [task] = await db(`SELECT * FROM tasks WHERE id=?`, [ins.insertId]);
  res.status(201).json({ success:true, data: task });
}

/** POST /manager/quick-tasks/create-assign
 *  body: { team_id, assignee_user_id, title, description?, due_date }
 */
async function createAndAssign(req, res) {
  const me = req.user.id;
  const role = await roleOf(me);
  if (!['MANAGER','ADMIN'].includes(role)) return res.status(403).json({ success:false, message:'Accès refusé' });

  const { team_id, assignee_user_id, title, description=null, due_date } = req.body || {};
  const teamId = Number(team_id || 0);
  const uid = Number(assignee_user_id || 0);
  const d = iso(due_date);

  if (!teamId) return res.status(400).json({ success:false, message:'team_id requis' });
  if (!await assertOwnTeam(me, teamId) && role !== 'ADMIN') return res.status(403).json({ success:false, message:'Équipe non autorisée' });
  if (!uid) return res.status(400).json({ success:false, message:'assignee_user_id requis' });
  if (!await assertMemberOfTeam(teamId, uid)) return res.status(409).json({ success:false, message:'Utilisateur non membre de l’équipe' });
  if (!title || !String(title).trim()) return res.status(400).json({ success:false, message:'Titre requis' });
  if (!d) return res.status(400).json({ success:false, message:'due_date invalide' });

  const ins = await db(
    `INSERT INTO tasks (title, description, status, due_date, created_by_user_id, created_at)
     VALUES (?, ?, 'TODO', ?, ?, NOW())`,
    [String(title).trim(), description || null, d, me]
  );
  const taskId = ins.insertId;
  await db(`INSERT IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, NOW())`, [taskId, uid]);

  const [task] = await db(`SELECT * FROM tasks WHERE id=?`, [taskId]);
  res.status(201).json({ success:true, data: task });
}

/** POST /manager/quick-tasks/schedule
 *  body: { team_id, assignee_user_id, due_date, repeat_week?, task_id?, title?, description? }
 *  - Si task_id : planifie cette tâche + assigne à un membre de l’équipe
 *  - Sinon : crée une tâche (TODO) à la/aux date(s) et assigne
 *  - repeat_week : crée Lun→Ven de la semaine de due_date
 */
async function scheduleTask(req, res) {
  const me = req.user.id;
  const role = await roleOf(me);
  if (!['MANAGER','ADMIN'].includes(role)) return res.status(403).json({ success:false, message:'Accès refusé' });

  const { team_id, assignee_user_id, due_date, repeat_week=false, task_id=null, title=null, description=null } = req.body || {};
  const teamId = Number(team_id || 0);
  const uid = Number(assignee_user_id || 0);
  const base = iso(due_date);
  if (!teamId) return res.status(400).json({ success:false, message:'team_id requis' });
  if (!await assertOwnTeam(me, teamId) && role !== 'ADMIN') return res.status(403).json({ success:false, message:'Équipe non autorisée' });
  if (!uid) return res.status(400).json({ success:false, message:'assignee_user_id requis' });
  if (!await assertMemberOfTeam(teamId, uid)) return res.status(409).json({ success:false, message:'Utilisateur non membre de l’équipe' });
  if (!base) return res.status(400).json({ success:false, message:'due_date invalide' });

  async function createOne(dateStr) {
    if (task_id) {
      await db(`UPDATE tasks SET due_date=?, updated_at=NOW() WHERE id=?`, [dateStr, Number(task_id)]);
      await db(`INSERT IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, NOW())`, [Number(task_id), uid]);
      return Number(task_id);
    } else {
      const ins = await db(
        `INSERT INTO tasks (title, description, status, due_date, created_by_user_id, created_at)
         VALUES (?, ?, 'TODO', ?, ?, NOW())`,
        [String(title || 'Tâche').trim(), description || null, dateStr, me]
      );
      const id = ins.insertId;
      await db(`INSERT IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, NOW())`, [id, uid]);
      return id;
    }
  }

  const ids = [];
  if (repeat_week) {
    const d = new Date(base + 'T00:00:00');
    const day = d.getUTCDay(); // 0=dim
    const offsetToMon = ((day + 6) % 7);
    for (let i=0;i<5;i++){
      const di = new Date(d);
      di.setUTCDate(d.getUTCDate() - offsetToMon + i);
      ids.push(await createOne(di.toISOString().slice(0,10)));
    }
  } else {
    ids.push(await createOne(base));
  }

  res.status(201).json({ success:true, data: { task_ids: ids } });
}

module.exports = {
  backlog,
  createBacklog,
  createAndAssign,
  scheduleTask,
};
