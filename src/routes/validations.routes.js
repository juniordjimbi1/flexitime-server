const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const V = require('../controllers/validations.controller');

router.post('/submit', requireAuth, (req, res, next) => V.submit(req, res).catch(next));
router.get('/pending', requireAuth, (req, res, next) => V.listPending(req, res).catch(next));
router.post('/:id/decision', requireAuth, (req, res, next) => V.decide(req, res).catch(next));

// statut jour pour l'employé
router.get('/today/status', requireAuth, (req, res, next) => V.todayStatus(req, res).catch(next));

module.exports = router;
