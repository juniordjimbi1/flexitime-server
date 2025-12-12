const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const R = require('../controllers/reports.controller');

// Admin & Manager
router.get('/overview',    requireAuth, requireRole('ADMIN','MANAGER'), asyncHandler(R.overview));
router.get('/time-by-team',requireAuth, requireRole('ADMIN','MANAGER'), asyncHandler(R.timeByTeam));
router.get('/tasks-stats', requireAuth, requireRole('ADMIN','MANAGER'), asyncHandler(R.tasksStats));
router.get('/day-closes',  requireAuth, requireRole('ADMIN','MANAGER'), asyncHandler(R.dayClosesAgg));

module.exports = router;
