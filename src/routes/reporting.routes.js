// server/src/routes/reporting.routes.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const R = require('../controllers/reporting.controller');

// KPIs par projet (filtres: from,to,teamId,projectId)
// RBAC dans le contrôleur
router.get('/projects/summary', asyncHandler(R.projectsSummary));

module.exports = router;
