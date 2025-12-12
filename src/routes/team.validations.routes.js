const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const V = require('../controllers/teamValidations.controller');

// Admin : liste des validations d’équipe en attente
router.get('/pending', requireAuth, asyncHandler(V.listPending));

// Admin : décision
router.post('/:id/decision', requireAuth, asyncHandler(V.decide));

module.exports = router;
