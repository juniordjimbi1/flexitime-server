// server/src/routes/history.routes.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { allowRoles } = require('../middleware/rbacCompat');
const C = require('../controllers/history.controller');

// Historique employé (protégé) — compat RBAC
router.get(
  '/my',
  requireAuth,
  allowRoles(['EMPLOYEE', 'MANAGER', 'ADMIN']),
  asyncHandler(C.myHistory)
);

module.exports = router;
