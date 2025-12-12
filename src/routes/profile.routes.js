const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const P = require('../controllers/profile.controller');

// --- Nouvelles routes canoniques ---
router.get('/me',            requireAuth, (req, res, next) => P.me(req, res).catch(next));
router.patch('/me',          requireAuth, (req, res, next) => P.updateBasic(req, res).catch(next));
router.patch('/me/email',    requireAuth, (req, res, next) => P.updateEmail(req, res).catch(next));
router.patch('/me/password', requireAuth, (req, res, next) => P.updatePassword(req, res).catch(next));
router.delete('/me',         requireAuth, (req, res, next) => P.deleteMe(req, res).catch(next));

// --- Alias de compatibilité (legacy) ---
// GET /profile/me/full => renvoie la même charge utile que /profile/me
router.get('/me/full',       requireAuth, (req, res, next) => P.me(req, res).catch(next));

// ⚠️ On NE remonte PAS l'ancien PUT /profile/me pour éviter les conflits.
// Utiliser PATCH /profile/me et/ou PATCH /profile/me/email.

module.exports = router;
