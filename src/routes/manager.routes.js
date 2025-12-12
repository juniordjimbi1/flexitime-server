const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const M = require('../controllers/manager.controller');

router.get('/my-team/members', requireAuth, (req, res, next) => M.myTeamMembers(req, res).catch(next));

module.exports = router;
