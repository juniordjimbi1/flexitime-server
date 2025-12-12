// server/src/routes/planner.routes.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const C = require('../controllers/planner.controller');

// RBAC: Admin & Manager
router.post(
  '/bulk-plan',
  requireAuth,
  requireRole(['ADMIN', 'MANAGER']),
  C.val.bulkPlan,
  asyncHandler(C.bulkPlan)
);

router.get(
  '/plans',
  requireAuth,
  requireRole(['ADMIN', 'MANAGER']),
  C.val.listPlans,
  asyncHandler(C.listPlans)
);

module.exports = router;
