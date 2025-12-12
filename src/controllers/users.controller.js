const { body, param, query: qv, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { getRoleByCode } = require('../utils/roles');

function vErr(res, errors) {
  return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });
}

async function me(req, res) {
  const rows = await query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.is_active,
            r.id AS role_id, r.code AS role_code, r.label AS role_label
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = ? LIMIT 1`,
    [req.user.id]
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  return res.json({
    success: true,
    data: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      is_active: !!user.is_active,
      role: { id: user.role_id, code: user.role_code, label: user.role_label },
    },
  });
}

// Liste des users (ADMIN), option: ?role=ADMIN|MANAGER|EMPLOYEE
const listValidators = [ qv('role').optional().isIn(['ADMIN','MANAGER','EMPLOYEE']) ];
async function listUsers(req, res) {
  const role = (req.query.role || '').toUpperCase();
  let rows;
  if (role) {
    rows = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.is_active,
              r.code AS role_code, r.label AS role_label
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.code = ?
       ORDER BY u.first_name, u.last_name`,
      [role]
    );
  } else {
    rows = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.is_active,
              r.code AS role_code, r.label AS role_label
       FROM users u JOIN roles r ON r.id = u.role_id
       ORDER BY u.first_name, u.last_name`
    );
  }
  res.json({ success: true, data: rows });
}

// Changer le rôle d’un utilisateur (ADMIN)
const roleValidators = [
  param('id').isInt(),
  body('role_code').isString().isIn(['ADMIN','MANAGER','EMPLOYEE']),
];
async function updateRole(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return vErr(res, errors);
  const id = Number(req.params.id);
  const role = await getRoleByCode(req.body.role_code.toUpperCase());
  if (!role) return res.status(400).json({ success: false, message: 'role_code inconnu' });

  const exists = await query('SELECT id FROM users WHERE id = ? LIMIT 1', [id]);
  if (!exists[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

  await query('UPDATE users SET role_id = ? WHERE id = ?', [role.id, id]);

  const rows = await query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.is_active,
            r.code AS role_code, r.label AS role_label
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = ? LIMIT 1`, [id]
  );
  res.json({ success: true, data: rows[0] });
}

module.exports = { me, listUsers, listValidators, updateRole, roleValidators };
