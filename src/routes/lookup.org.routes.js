// server/src/routes/lookup.org.routes.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { allowRoles } = require('../middleware/rbacCompat');
const { query: db } = require('../config/db');

/**
 * ADMIN: tout / MANAGER: seulement ses équipes et leurs branches
 * On remonte des listes normalisées pour le People Picker.
 */

router.get('/departments', requireAuth, allowRoles(['ADMIN','MANAGER']), asyncHandler(async (req, res) => {
  const rows = await db(`SELECT id, name FROM departments ORDER BY name ASC`);
  res.json({ success: true, data: rows });
}));

router.get('/subdepartments', requireAuth, allowRoles(['ADMIN','MANAGER']), asyncHandler(async (req, res) => {
  const { department_id } = req.query;
  let sql = `SELECT id, department_id, name FROM subdepartments`;
  const params = [];
  if (department_id) { sql += ` WHERE department_id = ?`; params.push(Number(department_id)); }
  sql += ` ORDER BY name ASC`;
  const rows = await db(sql, params);
  res.json({ success: true, data: rows });
}));

router.get('/teams', requireAuth, allowRoles(['ADMIN','MANAGER']), asyncHandler(async (req, res) => {
  const { subdepartment_id, department_id } = req.query;

  // Base query
  let sql = `
    SELECT t.id, t.name, t.subdepartment_id
    FROM teams t
    JOIN subdepartments sd ON sd.id = t.subdepartment_id
  `;
  const where = [];
  const params = [];

  if (subdepartment_id) { where.push('t.subdepartment_id = ?'); params.push(Number(subdepartment_id)); }
  if (department_id) { where.push('sd.department_id = ?'); params.push(Number(department_id)); }

  // Restriction Manager: ne voir que ses équipes
  if (req.user.role_code === 'MANAGER') {
    where.push(`t.manager_user_id = ?`);
    params.push(req.user.id);
  }

  if (where.length) sql += ` WHERE ` + where.join(' AND ');
  sql += ` ORDER BY t.name ASC`;

  const rows = await db(sql, params);
  res.json({ success: true, data: rows });
}));

router.get(
  '/team-members',
  requireAuth,
  allowRoles(['ADMIN', 'MANAGER']),
  asyncHandler(async (req, res) => {
    const teamId = Number(req.query.team_id);
    if (!teamId) {
      return res
        .status(400)
        .json({ success: false, message: 'team_id requis' });
    }

    // On renvoie :
    //  - tous les membres de l’équipe (team_members)
    //  - + le manager (teams.manager_user_id) s’il existe
    const rows = await db(
      `
      SELECT u.id,
             u.first_name,
             u.last_name,
             u.email,
             r.code AS role_code
      FROM (
        SELECT tm.user_id AS user_id
        FROM team_members tm
        WHERE tm.team_id = ?

        UNION

        SELECT t.manager_user_id AS user_id
        FROM teams t
        WHERE t.id = ? AND t.manager_user_id IS NOT NULL
      ) x
      JOIN users u ON u.id = x.user_id
      JOIN roles r ON r.id = u.role_id
      ORDER BY u.first_name ASC, u.last_name ASC
      `,
      [teamId, teamId]
    );

    res.json({ success: true, data: rows });
  })
);


module.exports = router;
