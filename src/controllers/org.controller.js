const { body, param, query, validationResult } = require('express-validator');
const { query: db } = require('../config/db');

// --- Helpers
function vErr(res, errors) {
  return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });
}
async function exists(table, id) {
  const rows = await db(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`, [id]);
  return !!rows[0];
}
async function isManagerOfTeam(userId, teamId) {
  if (!teamId) return false;
  const rows = await db(`SELECT 1 FROM teams WHERE id = ? AND manager_user_id = ? LIMIT 1`, [teamId, userId]);
  return !!rows[0];
}

// ------------------ DEPARTMENTS ------------------
const depValidators = {
  create: [ body('name').trim().isLength({ min: 2, max: 120 }) ],
  update: [ param('id').isInt(), body('name').trim().isLength({ min: 2, max: 120 }) ],
  remove: [ param('id').isInt() ],
};

async function listDepartments(req, res) {
  const rows = await db(`SELECT id, name, created_at, updated_at FROM departments ORDER BY name ASC`);
  res.json({ success: true, data: rows });
}

async function createDepartment(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);
  const { name } = req.body;

  const dupe = await db(`SELECT id FROM departments WHERE name = ? LIMIT 1`, [name]);
  if (dupe[0]) return res.status(409).json({ success: false, message: 'Département déjà existant' });

  const result = await db(`INSERT INTO departments (name) VALUES (?)`, [name]);
  const created = await db(`SELECT id, name, created_at, updated_at FROM departments WHERE id = ?`, [result.insertId]);
  res.status(201).json({ success: true, data: created[0] });
}

async function updateDepartment(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);
  const id = Number(req.params.id);
  const { name } = req.body;

  if (!(await exists('departments', id))) return res.status(404).json({ success: false, message: 'Département introuvable' });
  const dupe = await db(`SELECT id FROM departments WHERE name = ? AND id <> ? LIMIT 1`, [name, id]);
  if (dupe[0]) return res.status(409).json({ success: false, message: 'Nom déjà utilisé' });

  await db(`UPDATE departments SET name = ? WHERE id = ?`, [name, id]);
  const row = await db(`SELECT id, name, created_at, updated_at FROM departments WHERE id = ?`, [id]);
  res.json({ success: true, data: row[0] });
}

async function deleteDepartment(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);
  const id = Number(req.params.id);

  if (!(await exists('departments', id))) return res.status(404).json({ success: false, message: 'Département introuvable' });

  const kids = await db(`SELECT COUNT(*) AS c FROM subdepartments WHERE department_id = ?`, [id]);
  if (kids[0].c > 0) return res.status(409).json({ success: false, message: 'Supprimer d’abord les sous-départements' });

  await db(`DELETE FROM departments WHERE id = ?`, [id]);
  res.json({ success: true, data: { id } });
}

// ------------------ SUBDEPARTMENTS ------------------
const subValidators = {
  list: [ query('department_id').optional().isInt() ],
  create: [ body('department_id').isInt(), body('name').trim().isLength({ min: 2, max: 120 }) ],
  update: [ param('id').isInt(), body('name').trim().isLength({ min: 2, max: 120 }) ],
  remove: [ param('id').isInt() ],
};

async function listSubdepartments(req, res) {
  const depId = req.query.department_id ? Number(req.query.department_id) : null;
  let rows;
  if (depId) {
    rows = await db(
      `SELECT sd.id, sd.name, sd.department_id, d.name AS department_name
       FROM subdepartments sd JOIN departments d ON d.id = sd.department_id
       WHERE sd.department_id = ?
       ORDER BY sd.name`, [depId]
    );
  } else {
    rows = await db(
      `SELECT sd.id, sd.name, sd.department_id, d.name AS department_name
       FROM subdepartments sd JOIN departments d ON d.id = sd.department_id
       ORDER BY d.name, sd.name`
    );
  }
  res.json({ success: true, data: rows });
}

async function createSubdepartment(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);
  const { department_id, name } = req.body;

  if (!(await exists('departments', department_id))) {
    return res.status(400).json({ success: false, message: 'department_id invalide' });
  }
  const dupe = await db(
    `SELECT id FROM subdepartments WHERE department_id = ? AND name = ? LIMIT 1`,
    [department_id, name]
  );
  if (dupe[0]) return res.status(409).json({ success: false, message: 'Sous-département déjà existant dans ce département' });

  const result = await db(
    `INSERT INTO subdepartments (department_id, name) VALUES (?, ?)`,
    [department_id, name]
  );
  const created = await db(
    `SELECT sd.id, sd.name, sd.department_id, d.name AS department_name
     FROM subdepartments sd JOIN departments d ON d.id = sd.department_id
     WHERE sd.id = ?`, [result.insertId]
  );
  res.status(201).json({ success: true, data: created[0] });
}

async function updateSubdepartment(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);
  const id = Number(req.params.id);
  const { name } = req.body;

  if (!(await exists('subdepartments', id))) return res.status(404).json({ success: false, message: 'Sous-département introuvable' });

  const row = await db(`SELECT department_id FROM subdepartments WHERE id = ?`, [id]);
  const department_id = row[0].department_id;

  const dupe = await db(
    `SELECT id FROM subdepartments WHERE department_id = ? AND name = ? AND id <> ? LIMIT 1`,
    [department_id, name, id]
  );
  if (dupe[0]) return res.status(409).json({ success: false, message: 'Nom déjà utilisé dans ce département' });

  await db(`UPDATE subdepartments SET name = ? WHERE id = ?`, [name, id]);
  const after = await db(
    `SELECT sd.id, sd.name, sd.department_id, d.name AS department_name
     FROM subdepartments sd JOIN departments d ON d.id = sd.department_id
     WHERE sd.id = ?`, [id]
  );
  res.json({ success: true, data: after[0] });
}

async function deleteSubdepartment(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);
  const id = Number(req.params.id);

  if (!(await exists('subdepartments', id))) return res.status(404).json({ success: false, message: 'Sous-département introuvable' });

  const kids = await db(`SELECT COUNT(*) AS c FROM teams WHERE subdepartment_id = ?`, [id]);
  if (kids[0].c > 0) return res.status(409).json({ success: false, message: 'Supprimer d’abord les équipes' });

  await db(`DELETE FROM subdepartments WHERE id = ?`, [id]);
  res.json({ success: true, data: { id } });
}

// ------------------ TEAMS ------------------
const teamValidators = {
  create: [
    body('subdepartment_id').isInt(),
    body('name').trim().isLength({ min: 2, max: 120 }),
    body('manager_user_id').optional({ nullable: true }).isInt()
  ],
  update: [
    param('id').isInt(),
    body('name').optional().trim().isLength({ min: 2, max: 120 }),
    body('subdepartment_id').optional().isInt(),
    body('manager_user_id').optional({ nullable: true }).isInt()
  ],
  remove: [ param('id').isInt() ],
};

async function listTeams(req, res) {
  const role = req.user.role_code;
  const isManager = role === 'MANAGER';
  const params = [];
  const where = [];

  if (isManager) {
    where.push('t.manager_user_id = ?');
    params.push(req.user.id);
  }

  const rows = await db(
    `SELECT t.id, t.name, t.subdepartment_id,
            sd.name AS subdep_name,
            d.id AS department_id, d.name AS department_name,
            t.manager_user_id,
            CONCAT(u.first_name,' ',u.last_name) AS manager_name,
            u.email AS manager_email
     FROM teams t
     JOIN subdepartments sd ON sd.id = t.subdepartment_id
     JOIN departments d ON d.id = sd.department_id
     LEFT JOIN users u ON u.id = t.manager_user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY d.name, sd.name, t.name`,
    params
  );
  res.json({ success: true, data: rows });
}

async function createTeam(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);
  const { subdepartment_id, name, manager_user_id = null } = req.body;

  if (!(await exists('subdepartments', subdepartment_id))) {
    return res.status(400).json({ success: false, message: 'subdepartment_id invalide' });
  }
  const dupe = await db(
    `SELECT id FROM teams WHERE subdepartment_id = ? AND name = ? LIMIT 1`,
    [subdepartment_id, name]
  );
  if (dupe[0]) return res.status(409).json({ success: false, message: 'Équipe déjà existante dans ce sous-département' });

  if (manager_user_id) {
    const rows = await db(
      `SELECT u.id, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? LIMIT 1`, [manager_user_id]
    );
    if (!rows[0]) return res.status(400).json({ success: false, message: 'manager_user_id invalide' });
    if (rows[0].role_code !== 'MANAGER')
      return res.status(400).json({ success: false, message: 'Le manager doit avoir le rôle MANAGER' });
  }

  const result = await db(
    `INSERT INTO teams (subdepartment_id, name, manager_user_id) VALUES (?, ?, ?)`,
    [subdepartment_id, name, manager_user_id]
  );

  const created = await db(
    `SELECT t.id, t.name, t.subdepartment_id,
            sd.name AS subdep_name, d.id AS department_id, d.name AS department_name,
            t.manager_user_id, CONCAT(u.first_name,' ',u.last_name) AS manager_name, u.email AS manager_email
     FROM teams t
     JOIN subdepartments sd ON sd.id = t.subdepartment_id
     JOIN departments d ON d.id = sd.department_id
     LEFT JOIN users u ON u.id = t.manager_user_id
     WHERE t.id = ?`, [result.insertId]
  );
  res.status(201).json({ success: true, data: created[0] });
}

async function updateTeam(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);
  const id = Number(req.params.id);
  if (!(await exists('teams', id))) return res.status(404).json({ success: false, message: 'Équipe introuvable' });

  const { name, subdepartment_id, manager_user_id } = req.body;

  if (subdepartment_id && !(await exists('subdepartments', subdepartment_id)))
    return res.status(400).json({ success: false, message: 'subdepartment_id invalide' });

  if (manager_user_id !== undefined && manager_user_id !== null) {
    const rows = await db(
      `SELECT u.id, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? LIMIT 1`, [manager_user_id]
    );
    if (!rows[0]) return res.status(400).json({ success: false, message: 'manager_user_id invalide' });
    if (rows[0].role_code !== 'MANAGER')
      return res.status(400).json({ success: false, message: 'Le manager doit avoir le rôle MANAGER' });
  }

  // anti-doublon si name/subdepartment changent
  let subId = subdepartment_id;
  if (!subId) {
    const r = await db(`SELECT subdepartment_id FROM teams WHERE id = ?`, [id]);
    subId = r[0].subdepartment_id;
  }
  if (name) {
    const dupe = await db(
      `SELECT id FROM teams WHERE subdepartment_id = ? AND name = ? AND id <> ? LIMIT 1`,
      [subId, name, id]
    );
    if (dupe[0]) return res.status(409).json({ success: false, message: 'Nom déjà utilisé dans ce sous-département' });
  }

  const fields = [];
  const params = [];
  if (name) { fields.push('name = ?'); params.push(name); }
  if (subdepartment_id) { fields.push('subdepartment_id = ?'); params.push(subdepartment_id); }
  if (manager_user_id !== undefined) { fields.push('manager_user_id = ?'); params.push(manager_user_id); }
  if (!fields.length) return res.json({ success: true, data: { id } });

  params.push(id);
  await db(`UPDATE teams SET ${fields.join(', ')} WHERE id = ?`, params);

  const after = await db(
    `SELECT t.id, t.name, t.subdepartment_id,
            sd.name AS subdep_name, d.id AS department_id, d.name AS department_name,
            t.manager_user_id, CONCAT(u.first_name,' ',u.last_name) AS manager_name, u.email AS manager_email
     FROM teams t
     JOIN subdepartments sd ON sd.id = t.subdepartment_id
     JOIN departments d ON d.id = sd.department_id
     LEFT JOIN users u ON u.id = t.manager_user_id
     WHERE t.id = ?`, [id]
  );
  res.json({ success: true, data: after[0] });
}

async function deleteTeam(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);
  const id = Number(req.params.id);
  if (!(await exists('teams', id))) return res.status(404).json({ success: false, message: 'Équipe introuvable' });

  await db(`DELETE FROM teams WHERE id = ?`, [id]);
  res.json({ success: true, data: { id } });
}

module.exports = {
  // validators
  depValidators, subValidators, teamValidators,
  // handlers
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listSubdepartments, createSubdepartment, updateSubdepartment, deleteSubdepartment,
  listTeams, createTeam, updateTeam, deleteTeam,
};
