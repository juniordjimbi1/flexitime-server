const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query: db } = require('../config/db');

async function employeeSignup(req, res) {
  const {
    first_name, last_name, email, password,
    department_id, subdepartment_id, new_subdep_name
  } = req.body || {};

  if (!first_name || !last_name || !email || !password || !department_id) {
    return res.status(400).json({ success: false, message: 'Champs requis: first_name, last_name, email, password, department_id.' });
  }

  // email unique
  const [dup] = await db(`SELECT id FROM users WHERE email = ?`, [email]);
  if (dup) return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé.' });

  // dept existe ?
  const [dep] = await db(`SELECT id FROM departments WHERE id = ?`, [department_id]);
  if (!dep) return res.status(400).json({ success: false, message: 'Département introuvable.' });

  // déterminer subdep
  let subId = subdepartment_id ?? null;

  if (new_subdep_name && new_subdep_name.trim().length > 0) {
    const name = new_subdep_name.trim();
    // existe déjà ?
    const [exists] = await db(
      `SELECT sd.id FROM subdepartments sd WHERE sd.department_id = ? AND sd.name = ?`,
      [department_id, name]
    );
    if (exists) {
      subId = exists.id;
    } else {
      const result = await db(
        `INSERT INTO subdepartments (department_id, name, created_at, updated_at)
         VALUES (?, ?, NOW(), NOW())`,
        [department_id, name]
      );
      subId = result.insertId;
    }
  } else if (subId != null) {
    const [sd] = await db(`SELECT id, department_id FROM subdepartments WHERE id = ?`, [subId]);
    if (!sd) return res.status(400).json({ success: false, message: 'Sous-département introuvable.' });
    if (Number(sd.department_id) !== Number(department_id)) {
      return res.status(400).json({ success: false, message: 'Sous-département et département ne correspondent pas.' });
    }
  }

  // role EMPLOYEE
  const [role] = await db(`SELECT id, code FROM roles WHERE code='EMPLOYEE' LIMIT 1`);
  if (!role) return res.status(500).json({ success: false, message: 'Rôle EMPLOYEE manquant.' });

  const password_hash = await bcrypt.hash(password, 10);
  const result = await db(
    `INSERT INTO users (role_id, first_name, last_name, email, password_hash, is_active, department_id, subdepartment_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, NOW(), NOW())`,
    [role.id, first_name.trim(), last_name.trim(), email.trim(), password_hash, department_id, subId]
  );
  const userId = result.insertId;

  // token (optionnel : tu peux rediriger vers /login côté front)
  const token = jwt.sign({ id: userId, role: 'EMPLOYEE' }, process.env.JWT_SECRET || 'dev_secret', { expiresIn: '7d' });

  // renvoyer un user minimal
  const [user] = await db(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.department_id, u.subdepartment_id,
            'EMPLOYEE' AS role_code
       FROM users u WHERE u.id = ?`, [userId]
  );

  res.status(201).json({ success: true, message: 'Compte employé créé.', data: { token, user } });
}

module.exports = { employeeSignup };
