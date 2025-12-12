const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { uploadPdf } = require('../utils/uploader');
const F = require('../controllers/dayclose.files.controller');

// lister les fichiers d'une clôture (protégé)
router.get('/:id/files', requireAuth, (req, res, next) => F.listByClose(req, res).catch(next));
// upload fichier (protégé)
router.post('/:id/files', requireAuth, uploadPdf.single('file'), (req, res, next) => F.upload(req, res).catch(next));
// servir un fichier (public)
router.get('/files/:filename', (req, res, next) => F.serve(req, res).catch(next));

module.exports = router;
