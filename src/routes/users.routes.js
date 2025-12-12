const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const Users = require('../controllers/users.controller');

// GET /api/users/me
router.get('/me', requireAuth, asyncHandler(Users.me));

// GET /api/users?role=MANAGER (optionnel) — ADMIN only; sans param => tous
router.get('/', requireAuth, requireRole('ADMIN'), Users.listValidators, asyncHandler(Users.listUsers));

// PATCH /api/users/:id/role { role_code } — ADMIN only
router.patch('/:id/role', requireAuth, requireRole('ADMIN'), Users.roleValidators, asyncHandler(Users.updateRole));

module.exports = router;
