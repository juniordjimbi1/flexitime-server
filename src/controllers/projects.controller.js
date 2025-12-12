// src/controllers/projects.controller.js
const { body, param, query, validationResult } = require('express-validator');
const { query: db } = require('../config/db');

function vErr(res, errors) {
  return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });
}

const valExtra = {
  addMembersBatch: [
    param('id').toInt().isInt({ min:1 }),
    body('user_ids').isArray({ min:1 }),
    body('user_ids.*').toInt().isInt({ min:1 }),
  ]
};

// [AJOUT] eligible members
// [AJOUT] eligible members
// [AJOUT] eligible members
async function eligibleMembers(req, res) {
  const projectId = Number(req.params.id);

  // 1) Vérifier que le projet existe
  const projRows = await db(
    `SELECT id, manager_id
       FROM projects
      WHERE id = ?`,
    [projectId]
  );
  if (!projRows[0]) {
    return res
      .status(404)
      .json({ success: false, message: 'Projet introuvable' });
  }
  const proj = projRows[0];

  // 2) RBAC
  if (req.user.role_code === 'ADMIN') {
    // OK
  } else if (req.user.role_code === 'MANAGER') {
    // Le manager doit être manager du projet
    const ok = await db(
      `SELECT 1
         FROM projects
        WHERE id = ? AND manager_id = ?`,
      [projectId, req.user.id]
    );
    if (!ok[0]) {
      return res
        .status(403)
        .json({ success: false, message: 'Forbidden' });
    }
  } else {
    // Employé : pas de listing global
    return res
      .status(403)
      .json({ success: false, message: 'Forbidden' });
  }

  // 3) Récupérer les MEMBRES du projet (EMPLOYEE + MANAGER)
  let rows = await db(
    `SELECT
       u.id                                AS user_id,
       u.first_name,
       u.last_name,
       u.email,
       r.code                              AS role_code,
       CONCAT(u.first_name,' ',u.last_name) AS full_name
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     JOIN roles r ON r.id = u.role_id
    WHERE pm.project_id = ?
      AND r.code IN ('EMPLOYEE','MANAGER')
    ORDER BY u.first_name ASC, u.last_name ASC`,
    [projectId]
  );

  // 4) S'assurer que le manager du projet est dans la liste
  if (proj.manager_id) {
    const already = rows.some((r) => r.user_id === proj.manager_id);
    if (!already) {
      const mgrRows = await db(
        `SELECT
           u.id                                AS user_id,
           u.first_name,
           u.last_name,
           u.email,
           r.code                              AS role_code,
           CONCAT(u.first_name,' ',u.last_name) AS full_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?
          AND r.code IN ('EMPLOYEE','MANAGER')`,
        [proj.manager_id]
      );
      rows = rows.concat(mgrRows);
    }
  }

  return res.json({ success: true, data: rows || [] });
}


// [AJOUT] add members batch
// [AJOUT] add members batch
async function addMembersBatch(req, res) {
  const projectId = Number(req.params.id);
  const ids = req.body.user_ids.map(Number);

  const projRows = await db(
    `SELECT id, manager_id FROM projects WHERE id = ?`,
    [projectId]
  );
  if (!projRows[0]) {
    return res
      .status(404)
      .json({ success: false, message: 'Projet introuvable' });
  }
  const proj = projRows[0];

  // RBAC Manager: ne peut ajouter que des membres issus de ses équipes
  if (req.user.role_code === 'MANAGER') {
    const allowed = await db(
      `
      SELECT DISTINCT u.id
      FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      JOIN users u         ON u.id = tm.user_id
      WHERE t.manager_user_id = ?
      `,
      [req.user.id]
    );
    const allowedSet = new Set(allowed.map((r) => String(r.id)));
    for (const uid of ids) {
      if (!allowedSet.has(String(uid))) {
        return res.status(403).json({
          success: false,
          message: `User ${uid} non autorisé (hors de vos équipes)`,
        });
      }
    }
  }

  // Insert ignore pour éviter les doublons
  if (!ids.length) {
    return res.json({ success: true, data: { added: 0 } });
  }

  const values = ids.map(() => '(?, ?)').join(',');
  await db(
    `INSERT IGNORE INTO project_members (project_id, user_id) VALUES ${values}`,
    ids.flatMap((uid) => [projectId, uid])
  );

  // 👉 Si le projet n’a pas encore de manager, on regarde si un des users ajoutés est MANAGER
  if (!proj.manager_id) {
    const placeholders = ids.map(() => '?').join(',');
    const managerCandidates = await db(
      `
      SELECT u.id
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.id IN (${placeholders})
        AND r.code = 'MANAGER'
      LIMIT 1
      `,
      ids
    );
    if (managerCandidates[0]) {
      await db(
        `UPDATE projects SET manager_id = ? WHERE id = ?`,
        [managerCandidates[0].id, projectId]
      );
    }
  }

  const count = await db(
    `SELECT COUNT(*) AS c FROM project_members WHERE project_id = ?`,
    [projectId]
  );

  return res.json({
    success: true,
    data: { total_members: count[0]?.c || 0 },
  });
}


async function canAccessProject(user, projectId) {
  if (user.role_code === 'ADMIN') return true;
  const rows = await db(`
    SELECT 1
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
    WHERE p.id = ? AND (p.manager_id = ? OR p.created_by = ? OR pm.user_id IS NOT NULL)
    LIMIT 1
  `, [user.id, projectId, user.id, user.id]);
  return !!rows[0];
}

async function isProjectManager(userId, projectId) {
  const r = await db(`SELECT 1 FROM projects WHERE id = ? AND (manager_id = ? OR created_by = ?) LIMIT 1`, [projectId, userId, userId]);
  return !!r[0];
}

async function managerCanTouchUser(managerId, userId) {
  const r = await db(`
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE t.manager_user_id = ? AND tm.user_id = ?
    LIMIT 1
  `, [managerId, userId]);
  return !!r[0];
}

const validate = {
  list: [
    query('status').optional().isIn(['ACTIVE','ARCHIVED']),
    query('q').optional().trim().isLength({ min: 1, max: 100 }),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return vErr(res, errors);
      next();
    }
  ],
  create: [
    body('name').trim().isLength({ min: 2, max: 150 }),
    body('code').optional({ nullable: true }).trim().isLength({ min: 1, max: 50 }),
    body('description').optional({ nullable: true }).isString(),
    body('start_date').optional({ nullable: true }).isISO8601().toDate(),
    body('end_date').optional({ nullable: true }).isISO8601().toDate(),
    body('manager_id').optional({ nullable: true }).isInt(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return vErr(res, errors);
      next();
    }
  ],
  byId: [
    param('id').isInt(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return vErr(res, errors);
      next();
    }
  ],
  update: [
    param('id').isInt(),
    body('name').optional().trim().isLength({ min: 2, max: 150 }),
    body('code').optional({ nullable: true }).trim().isLength({ min: 1, max: 50 }),
    body('description').optional({ nullable: true }).isString(),
    body('status').optional().isIn(['ACTIVE','ARCHIVED']),
    body('start_date').optional({ nullable: true }).isISO8601().toDate(),
    body('end_date').optional({ nullable: true }).isISO8601().toDate(),
    body('manager_id').optional({ nullable: true }).isInt(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return vErr(res, errors);
      next();
    }
  ],
  addMember: [
    param('id').isInt(),
    body('user_id').isInt(),
    body('role').optional().isIn(['MANAGER','MEMBER']),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return vErr(res, errors);
      next();
    }
  ],
  removeMember: [
    param('id').isInt(),
    param('userId').isInt(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return vErr(res, errors);
      next();
    }
  ],
};

async function list(req, res) {
  const { status, q } = req.query;
  const params = [];
  let where = '1=1';

  if (status) { where += ' AND p.status = ?'; params.push(status); }
  if (q) { where += ' AND (p.name LIKE ? OR p.code LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

  if (req.user.role_code === 'ADMIN') {
    // all
  } else if (req.user.role_code === 'MANAGER') {
    where += ' AND (p.manager_id = ? OR p.created_by = ? OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?))';
    params.push(req.user.id, req.user.id, req.user.id);
  } else {
    where += ' AND EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?)';
    params.push(req.user.id);
  }

  const rows = await db(`
    SELECT p.id, p.name, p.code, p.status, p.start_date, p.end_date,
           p.manager_id, p.created_by, p.created_at, p.updated_at,
           CONCAT(mu.first_name,' ',mu.last_name) AS manager_name,
           CONCAT(cu.first_name,' ',cu.last_name) AS created_by_name
    FROM projects p
    LEFT JOIN users mu ON mu.id = p.manager_id
    LEFT JOIN users cu ON cu.id = p.created_by
    WHERE ${where}
    ORDER BY p.created_at DESC
    LIMIT 200
  `, params);

  res.json({ success: true, data: rows });
}

async function create(req, res) {
  const { name, code = null, description = null, start_date = null, end_date = null } = req.body;
  let manager_id = null;

  if (req.user.role_code === 'ADMIN') {
    manager_id = req.body.manager_id || null;
  } else if (req.user.role_code === 'MANAGER') {
    manager_id = req.user.id;
  }

  const r = await db(
    `INSERT INTO projects (name, code, description, start_date, end_date, created_by, manager_id)
     VALUES (?,?,?,?,?,?,?)`,
    [name, code, description, start_date, end_date, req.user.id, manager_id]
  );

  const created = await db(`SELECT * FROM projects WHERE id = ?`, [r.insertId]);
  res.status(201).json({ success: true, data: created[0] });
}

async function details(req, res) {
  const id = Number(req.params.id);
  if (!(await canAccessProject(req.user, id))) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const rows = await db(`
    SELECT p.*, 
           CONCAT(mu.first_name,' ',mu.last_name) AS manager_name,
           CONCAT(cu.first_name,' ',cu.last_name) AS created_by_name
    FROM projects p
    LEFT JOIN users mu ON mu.id = p.manager_id
    LEFT JOIN users cu ON cu.id = p.created_by
    WHERE p.id = ?
    LIMIT 1
  `, [id]);

  if (!rows[0]) return res.status(404).json({ success: false, message: 'Project not found' });

  const members = await db(`
    SELECT pm.user_id, pm.role,
           CONCAT(u.first_name,' ',u.last_name) AS user_name
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ?
    ORDER BY user_name ASC
  `, [id]);

  res.json({ success: true, data: { project: rows[0], members } });
}

async function update(req, res) {
  const id = Number(req.params.id);

  if (req.user.role_code !== 'ADMIN' && !(await isProjectManager(req.user.id, id))) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const fields = [];
  const params = [];

  ['name','code','description','status','start_date','end_date'].forEach(k => {
    if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(req.body[k]); }
  });

  if (req.body.manager_id !== undefined) {
    if (req.user.role_code !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Only ADMIN can reassign manager' });
    }
    fields.push('manager_id = ?'); params.push(req.body.manager_id);
  }

  if (fields.length === 0) return res.json({ success: true, message: 'Nothing to update' });

  params.push(id);
  await db(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, params);

  const updated = await db(`SELECT * FROM projects WHERE id = ?`, [id]);
  res.json({ success: true, data: updated[0] });
}

async function archive(req, res) {
  const id = Number(req.params.id);

  if (req.user.role_code !== 'ADMIN' && !(await isProjectManager(req.user.id, id))) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  await db(`UPDATE projects SET status = 'ARCHIVED' WHERE id = ?`, [id]);
  res.json({ success: true, message: 'Project archived' });
}

async function membersList(req, res) {
  const id = Number(req.params.id);
  if (!(await canAccessProject(req.user, id))) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  const members = await db(`
    SELECT pm.user_id, pm.role, CONCAT(u.first_name,' ',u.last_name) AS user_name
    FROM project_members pm 
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ?
    ORDER BY user_name ASC
  `, [id]);
  res.json({ success: true, data: members });
}

async function membersAdd(req, res) {
  const id = Number(req.params.id);
  const { user_id, role = 'MEMBER' } = req.body;

  if (req.user.role_code !== 'ADMIN') {
    if (!(await isProjectManager(req.user.id, id))) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const ok = await managerCanTouchUser(req.user.id, user_id);
    if (!ok) return res.status(403).json({ success: false, message: 'User not in your teams' });
  }

  try {
    await db(`INSERT INTO project_members (project_id, user_id, role, added_by) VALUES (?,?,?,?)`, [id, user_id, role, req.user.id]);
  } catch (e) {}
  const members = await db(`SELECT user_id, role FROM project_members WHERE project_id = ? ORDER BY user_id`, [id]);
  res.status(201).json({ success: true, data: members });
}

async function membersRemove(req, res) {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);

  if (req.user.role_code !== 'ADMIN' && !(await isProjectManager(req.user.id, id))) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  await db(`DELETE FROM project_members WHERE project_id = ? AND user_id = ?`, [id, userId]);
  res.json({ success: true, message: 'Member removed' });
}

module.exports = {
  validate,
  list,
  create,
  details,
  update,
  archive,
  membersList,
  membersAdd,
  membersRemove,
  eligibleMembers,
  addMembersBatch,
  valExtra,
};
