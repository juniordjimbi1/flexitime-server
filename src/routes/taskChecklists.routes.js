// src/routes/taskChecklists.routes.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const C = require('../controllers/taskChecklist.controller');
const L = require('../controllers/taskChecklistLaps.controller'); // +laps

// GET visible items (public pour admin/manager ; full pour assignee)
router.get('/', requireAuth, C.val.list, asyncHandler(C.list));

// LAPS lecture (pagination)
router.get('/:itemId/laps', requireAuth, asyncHandler(L.listByItem));

// CREATE item
router.post('/', requireAuth, C.val.create, asyncHandler(C.create));

// UPDATE item
router.patch('/:itemId', requireAuth, C.val.update, asyncHandler(C.update));

// DELETE item
router.delete('/:itemId', requireAuth, C.val.remove, asyncHandler(C.remove));

// REORDER batch: [{id, sort_order}, ...]
router.patch('/reorder/batch', requireAuth, C.val.reorder, asyncHandler(C.reorder));

module.exports = router;
