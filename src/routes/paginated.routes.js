// server/src/routes/paginated.routes.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const P = require('../controllers/paginated.controller');

router.use(requireAuth);

router.get('/sessions/my', asyncHandler(P.sessionsMy));
router.get('/projects', asyncHandler(P.projects));
router.get('/projects/:id/members', asyncHandler(P.projectMembers));
router.get('/teams', asyncHandler(P.teams));
router.get('/dayclose/:id/files', asyncHandler(P.dayCloseFiles));
router.get('/teamclose/:id/files', asyncHandler(P.teamCloseFiles));
router.get('/team-validations/pending', asyncHandler(P.teamValidationsPending));

module.exports = router;
