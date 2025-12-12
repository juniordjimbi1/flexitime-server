const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { getRoleByCode } = require('../utils/roles');

function makeToken(user) {
  const payload = {
    sub: user.id,
    role_id: user.role_id,
    role_code: user.role_code,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
}

// -------------------- LOGIN (public) --------------------
const loginValidators = [
  body('email').isEmail().withMessage('Email invalide'),
  body('password').isString().isLength({ min: 4 }).withMessage('Mot de passe requis'),
];

async function login(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });

  const { email, password } = req.body;

  const rows = await query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.password_hash, u.is_active,
            r.id AS role_id, r.code AS role_code, r.label AS role_label
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = ? LIMIT 1`,
    [email]
  );

  const user = rows[0];
  if (!user || !user.is_active) {
    return res.status(400).json({ success: false, message: 'Identifiants invalides' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(400).json({ success: false, message: 'Identifiants invalides' });

  const token = makeToken(user);

  return res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: { id: user.role_id, code: user.role_code, label: user.role_label },
      },
    },
  });
}

// -------------------- SIGNUP (public -> EMPLOYEE) --------------------
const signupValidators = [
  body('first_name').trim().isLength({ min: 1 }),
  body('last_name').trim().isLength({ min: 1 }),
  body('email').isEmail(),
  body('password').isString().isLength({ min: 6 }),
];

async function signup(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });

  const { first_name, last_name, email, password } = req.body;

  const existing = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing[0]) {
    return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
  }

  const employeeRole = await getRoleByCode('EMPLOYEE');
  if (!employeeRole) {
    return res.status(500).json({ success: false, message: 'Rôle EMPLOYEE introuvable' });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const result = await query(
    `INSERT INTO users (role_id, first_name, last_name, email, password_hash, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [employeeRole.id, first_name, last_name, email, password_hash]
  );

  return res.status(201).json({
    success: true,
    data: {
      id: result.insertId,
      first_name,
      last_name,
      email,
      role: { id: employeeRole.id, code: employeeRole.code, label: employeeRole.label },
    },
  });
}

// -------------------- REGISTER (ADMIN only -> n’importe quel rôle) --------------------
const registerValidators = [
  body('first_name').trim().isLength({ min: 1 }),
  body('last_name').trim().isLength({ min: 1 }),
  body('email').isEmail(),
  body('password').isString().isLength({ min: 6 }),
  body('role_code').isString().isIn(['ADMIN','MANAGER','EMPLOYEE']).withMessage('role_code invalide'),
];

async function register(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });

  const { first_name, last_name, email, password } = req.body;
  const roleCode = req.body.role_code.toUpperCase();

  const existing = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing[0]) {
    return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
  }

  const role = await getRoleByCode(roleCode);
  if (!role) {
    return res.status(400).json({ success: false, message: 'role_code inconnu' });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const result = await query(
    `INSERT INTO users (role_id, first_name, last_name, email, password_hash, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [role.id, first_name, last_name, email, password_hash]
  );

  return res.status(201).json({
    success: true,
    data: {
      id: result.insertId,
      first_name,
      last_name,
      email,
      role: { id: role.id, code: role.code, label: role.label },
    },
  });
}

module.exports = { login, loginValidators, signup, signupValidators, register, registerValidators };
