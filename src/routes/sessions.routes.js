const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { guardTasksToday } = require('../middleware/guardTasksToday');
const S = require('../controllers/sessions.controller');


router.get('/my',       requireAuth, (req, res, next) => S.listMy(req, res).catch(next));
router.get('/my/open',  requireAuth, (req, res, next) => S.getOpen(req, res).catch(next));
router.post('/start',   requireAuth, guardTasksToday, (req, res, next) => S.start(req, res).catch(next));
router.post('/stop',    requireAuth, (req, res, next) => S.stop(req, res).catch(next));

module.exports = router;
