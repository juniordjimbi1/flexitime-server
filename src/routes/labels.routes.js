// server/src/routes/labels.routes.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { allowRoles } = require('../middleware/rbacCompat');
const C = require('../controllers/labels.controller');

// CRUD labels (Admin & Manager)
router.get('/', requireAuth, allowRoles(['ADMIN', 'MANAGER']), asyncHandler(C.list));
router.post('/', requireAuth, allowRoles(['ADMIN', 'MANAGER']), C.val.create, asyncHandler(C.create));
router.patch('/:id', requireAuth, allowRoles(['ADMIN', 'MANAGER']), C.val.update, asyncHandler(C.update));
router.delete('/:id', requireAuth, allowRoles(['ADMIN', 'MANAGER']), C.val.remove, asyncHandler(C.remove));

// Liens tâche ↔ labels
router.get('/tasks/:taskId', requireAuth, asyncHandler(C.listByTask)); // lecture pour tous (vérif dans controller)
router.post('/tasks/:taskId', requireAuth, allowRoles(['ADMIN', 'MANAGER']), C.val.link, asyncHandler(C.addToTask));
router.delete('/tasks/:taskId/:labelId', requireAuth, allowRoles(['ADMIN', 'MANAGER']), C.val.unlink, asyncHandler(C.removeFromTask));

module.exports = router;
