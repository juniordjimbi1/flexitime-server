// server/src/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const {
  login, loginValidators,
  signup, signupValidators,
  register, registerValidators
} = require('../controllers/auth.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit'); // <-- AJOUT

// Public
router.post('/login', authLimiter, loginValidators, asyncHandler(login)); // <-- limiter ici
router.post('/signup', signupValidators, asyncHandler(signup));

// Admin-only
router.post('/register',
  requireAuth,
  requireRole('ADMIN'),
  registerValidators,
  asyncHandler(register)
);

module.exports = router;
