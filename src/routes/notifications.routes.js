// server/src/routes/notifications.routes.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const C = require('../controllers/notifications.controller');

// Liste & lecture
router.get('/', requireAuth, asyncHandler(C.list));
router.patch('/read', requireAuth, C.val.markRead, asyncHandler(C.markRead));

// Simulation (pour test dans l’app) : réservé ADMIN/MANAGER
router.post('/simulate', requireAuth, requireRole(['ADMIN','MANAGER']), C.val.simulate, asyncHandler(C.simulate));

module.exports = router;
