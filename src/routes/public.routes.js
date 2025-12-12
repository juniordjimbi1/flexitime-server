const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const P = require('../controllers/public.controller');

// lecture publique pour le formulaire d'inscription
router.get('/departments',    asyncHandler(P.departments));
router.get('/subdepartments', asyncHandler(P.subdepartments));

module.exports = router;
