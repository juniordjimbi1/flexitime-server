// server/src/routes/gdpr.routes.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const C = require('../controllers/gdpr.controller');

// ADMIN only
router.get('/preview/:userId', requireAuth, requireRole(['ADMIN']), C.val.preview, asyncHandler(C.preview));
router.post('/execute/:userId', requireAuth, requireRole(['ADMIN']), C.val.execute, asyncHandler(C.execute));

module.exports = router;
