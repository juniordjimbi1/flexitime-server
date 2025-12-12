const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const S = require('../controllers/tasks.schedule.controller');

// Brouillons (tâches non assignées, sans due_date)
router.get('/drafts',  requireAuth, (req, res, next) => S.listDrafts(req, res).catch(next));
router.post('/drafts', requireAuth, (req, res, next) => S.createDraft(req, res).catch(next));

// Programmation jour/semaine
router.post('/day',   requireAuth, (req, res, next) => S.scheduleOneDay(req, res).catch(next));
router.post('/week',  requireAuth, (req, res, next) => S.scheduleWeek(req, res).catch(next));

module.exports = router;
