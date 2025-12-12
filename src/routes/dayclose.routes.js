const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const D = require('../controllers/dayclose.controller');

// Aperçu de clôture (avant de valider)
router.get('/preview', requireAuth, asyncHandler(D.preview));

// Clôturer (ou re-clôturer) ma journée
router.post('/', requireAuth, asyncHandler(D.closeDay));

// Historique de mes clôtures
router.get('/my', requireAuth, asyncHandler(D.myCloses));

module.exports = router;
