const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const T = require('../controllers/teamClose.controller');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer storage (uploads/team_closes)
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'team_closes');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    
// Guard: PDF only, max 20MB
function fileFilter(_req, file, cb) {
  if (file.mimetype === 'application/pdf') return cb(null, true);
  return cb(new Error('Seuls les PDF sont autorisés pour la clôture d’équipe'));
}
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
});
const base = String(Date.now()) + '_' + Math.random().toString(36).slice(2,8);
    cb(null, base + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// Aperçu agrégé
router.get('/preview', requireAuth, asyncHandler(T.preview));

// Upsert clôture équipe + passe en PENDING
router.post('/', requireAuth, asyncHandler(T.closeTeam));

// Fichiers
router.get('/:id/files', requireAuth, asyncHandler(T.listFiles));
router.post('/:id/files', requireAuth, upload.single('file'), asyncHandler(T.uploadFile));

// Download (public-ish : sécurisé par complexité du nom; sinon protège via token si besoin)
router.get('/files/:filename', asyncHandler(T.serveFile));

module.exports = router;
