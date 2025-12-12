const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const C = require('../controllers/employees.controller');

router.get('/employees',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(C.listEmployees)
);

module.exports = router;
