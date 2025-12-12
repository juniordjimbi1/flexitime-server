// server/src/middleware/uploadGuard.js

/**
 * validateUpload({ field, allowedMimes, maxSizeMB })
 * A placer IMMÉDIATEMENT APRÈS multer (single/array/fields) sur la route.
 *
 * - field: nom du champ de fichier (ex: 'file' ou 'attachment')
 * - allowedMimes: ['application/pdf', 'image/png', ...]
 * - maxSizeMB: nombre (ex: 5)
 *
 * Supporte:
 * - single: req.file
 * - array/fields: req.files (array ou object of arrays)
 */
function validateUpload({ field, allowedMimes = [], maxSizeMB = 5 }) {
  const maxBytes = maxSizeMB * 1024 * 1024;

  return function (req, res, next) {
    const problems = [];

    const checkOne = (f) => {
      if (!f) return;
      if (allowedMimes.length && !allowedMimes.includes(f.mimetype)) {
        problems.push(`Type non autorisé (${f.originalname} : ${f.mimetype})`);
      }
      if (f.size > maxBytes) {
        problems.push(`Fichier trop volumineux (${f.originalname} : ${(f.size/1024/1024).toFixed(2)}MB > ${maxSizeMB}MB)`);
      }
    };

    // single
    if (req.file) {
      checkOne(req.file);
    }

    // array sous le même nom de champ
    if (Array.isArray(req.files)) {
      req.files.forEach(checkOne);
    }

    // fields: { fieldA: [..], fieldB: [..] }
    if (req.files && !Array.isArray(req.files)) {
      const arr = req.files[field] || [];
      arr.forEach(checkOne);
    }

    if (problems.length) {
      return res.status(400).json({ success: false, message: problems.join(' ; ') });
    }
    next();
  };
}

module.exports = { validateUpload };
