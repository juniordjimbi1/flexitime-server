const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const T = require('../controllers/tasksToday.controller');

router.get('/my-today',               requireAuth, asyncHandler(T.myToday));
router.get('/my-today/with-time',     requireAuth, asyncHandler(T.myTodayWithTime));
router.get('/my-today/availability',  requireAuth, asyncHandler(T.myTodayAvailability));

module.exports = router;
