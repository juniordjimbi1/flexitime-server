/**
 * server/src/utils/uploader.js
 * Guarded multer helpers with MIME and size limits.
 * Existing export kept: uploadPdf (for day-close) to avoid breaking routes.
 */
const fs = require('fs');
const path = require('path');
const multer = require('multer');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function makeStorage(subfolder) {
  const baseDir = path.join(process.cwd(), 'uploads', subfolder);
  ensureDir(baseDir);
  return {
    baseDir,
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, baseDir),
      filename: (_req, file, cb) => {
        const ts = Date.now();
        const safe = (file.originalname || 'file').replace(/[^a-zA-Z0-9_.-]/g, '_');
        cb(null, `${ts}__${safe}`);
      }
    })
  };
}

function makeFileFilter(allowed) {
  const allow = new Set(allowed);
  return (_req, file, cb) => {
    if (allow.has(file.mimetype)) return cb(null, true);
    cb(new Error('Type de fichier non autorisé'));
  };
}

function createUploader(subfolder, allowedMimes, maxSizeMB) {
  const { storage, baseDir } = makeStorage(subfolder);
  const upload = multer({
    storage,
    fileFilter: makeFileFilter(allowedMimes),
    limits: { fileSize: (maxSizeMB || 10) * 1024 * 1024 }
  });
  upload.baseDir = baseDir;
  return upload;
}

// Backwards-compatible (day-close)
const uploadPdf = createUploader('day-close', ['application/pdf'], 10);

// Team close PDFs (20 MB)
const uploadTeamClose = createUploader('team_closes', ['application/pdf'], 20);

// Optionnel : images
const uploadImages = createUploader('images', ['image/png','image/jpeg','image/webp'], 5);

module.exports = { createUploader, uploadPdf, uploadTeamClose, uploadImages };
