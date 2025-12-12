const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const Q = require('../controllers/manager.quicktasks.controller');

router.get('/backlog',         requireAuth, asyncHandler(Q.backlog));
router.post('/create-backlog', requireAuth, asyncHandler(Q.createBacklog));
router.post('/create-assign',  requireAuth, asyncHandler(Q.createAndAssign));
router.post('/schedule',       requireAuth, asyncHandler(Q.scheduleTask));

module.exports = router;
