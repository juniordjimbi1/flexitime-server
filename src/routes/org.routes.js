const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../config/db');
const Org = require('../controllers/org.controller');

// --- ADMIN ONLY: Departments/Subdepartments/Teams CRUD
router.get('/departments',  requireAuth, requireRole('ADMIN'), asyncHandler(Org.listDepartments));
router.post('/departments', requireAuth, requireRole('ADMIN'), Org.depValidators.create, asyncHandler(Org.createDepartment));
router.put('/departments/:id', requireAuth, requireRole('ADMIN'), Org.depValidators.update, asyncHandler(Org.updateDepartment));
router.delete('/departments/:id', requireAuth, requireRole('ADMIN'), Org.depValidators.remove, asyncHandler(Org.deleteDepartment));

router.get('/subdepartments',  requireAuth, requireRole('ADMIN'), Org.subValidators.list, asyncHandler(Org.listSubdepartments));
router.post('/subdepartments', requireAuth, requireRole('ADMIN'), Org.subValidators.create, asyncHandler(Org.createSubdepartment));
router.put('/subdepartments/:id', requireAuth, requireRole('ADMIN'), Org.subValidators.update, asyncHandler(Org.updateSubdepartment));
router.delete('/subdepartments/:id', requireAuth, requireRole('ADMIN'), Org.subValidators.remove, asyncHandler(Org.deleteSubdepartment));

// Teams:
// - GET visible par ADMIN & MANAGER (le manager ne voit QUE ses équipes, côté contrôleur)
// - POST/PUT/DELETE = ADMIN only
router.get('/teams',  requireAuth, requireRole('ADMIN','MANAGER'), asyncHandler(Org.listTeams));
router.post('/teams', requireAuth, requireRole('ADMIN'), Org.teamValidators.create, asyncHandler(Org.createTeam));
router.put('/teams/:id', requireAuth, requireRole('ADMIN'), Org.teamValidators.update, asyncHandler(Org.updateTeam));
router.delete('/teams/:id', requireAuth, requireRole('ADMIN'), Org.teamValidators.remove, asyncHandler(Org.deleteTeam));

/**
 * Team members endpoints
 * GET  /org/team-members?team_id=#
 * POST /org/team-members     { team_id, user_ids: number[] }  (ajout multiple)
 * DELETE /org/team-members   ?team_id=#&user_id=#             (retrait 1)
 *
 * Rôles:
 *  - ADMIN: toutes équipes
 *  - MANAGER: uniquement ses équipes
 */

// GET members (ADMIN + MANAGER)
router.get('/team-members', requireAuth, requireRole('ADMIN','MANAGER'), asyncHandler(async (req, res) => {
  const teamId = Number(req.query.team_id || 0);
  if (!teamId) return res.json({ success: true, data: [] });

  if (req.user.role_code === 'MANAGER') {
    const r = await query(`SELECT 1 FROM teams WHERE id = ? AND manager_user_id = ?`, [teamId, req.user.id]);
    if (!r[0]) return res.status(403).json({ success: false, message: 'Interdit' });
  }

  const rows = await query(
    `SELECT u.id, u.first_name, u.last_name, u.email
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       JOIN roles r ON r.id = u.role_id AND r.code = 'EMPLOYEE'
     WHERE tm.team_id = ?
     ORDER BY u.first_name, u.last_name`, [teamId]
  );
  res.json({ success: true, data: rows });
}));

// POST add members (ADMIN + MANAGER sur ses équipes)
router.post('/team-members', requireAuth, requireRole('ADMIN','MANAGER'), asyncHandler(async (req, res) => {
  const { team_id, user_ids } = req.body || {};
  const teamId = Number(team_id);
  const ids = Array.isArray(user_ids) ? user_ids.map(Number) : [];

  if (!teamId || !ids.length) {
    return res.status(422).json({ success: false, message: 'team_id et user_ids requis' });
  }

  if (req.user.role_code === 'MANAGER') {
    const r = await query(`SELECT 1 FROM teams WHERE id = ? AND manager_user_id = ?`, [teamId, req.user.id]);
    if (!r[0]) return res.status(403).json({ success: false, message: 'Interdit' });
  }

  // Vérifier EMPLOYEE + existence
  const placeholders = ids.map(()=>'?').join(',');
  const check = await query(
    `SELECT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id AND r.code = 'EMPLOYEE'
     WHERE u.id IN (${placeholders})`,
    ids
  );
  if (check.length !== ids.length) return res.status(400).json({ success: false, message: 'user_ids doivent être des EMPLOYES valides' });

  // Insert IGNORE pour éviter les doublons
  const values = ids.map(()=> '(?, ?)').join(',');
  await query(`INSERT IGNORE INTO team_members (team_id, user_id) VALUES ${values}`, ids.flatMap(u=>[teamId, u]));

  const rows = await query(
    `SELECT u.id, u.first_name, u.last_name, u.email
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ?
     ORDER BY u.first_name, u.last_name`, [teamId]
  );
  res.json({ success: true, data: rows });
}));

// DELETE remove one member (ADMIN + MANAGER sur ses équipes)
router.delete('/team-members', requireAuth, requireRole('ADMIN','MANAGER'), asyncHandler(async (req, res) => {
  const teamId = Number(req.query.team_id || 0);
  const userId = Number(req.query.user_id || 0);
  if (!teamId || !userId) return res.status(422).json({ success: false, message: 'team_id et user_id requis' });

  if (req.user.role_code === 'MANAGER') {
    const r = await query(`SELECT 1 FROM teams WHERE id = ? AND manager_user_id = ?`, [teamId, req.user.id]);
    if (!r[0]) return res.status(403).json({ success: false, message: 'Interdit' });
  }

  await query(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
  res.json({ success: true, data: { team_id: teamId, user_id: userId } });
}));

module.exports = router;
