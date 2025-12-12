const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const L = require('../controllers/lookup.controller');

// Routes principales
router.get('/departments', requireAuth, L.departments);
router.get('/subdepartments', requireAuth, L.subdepartments);

// Routes org members (people picker)
router.get('/org/team-members', requireAuth, L.orgTeamMembers);
router.get('/org_members',      requireAuth, L.orgTeamMembers);

module.exports = router;
