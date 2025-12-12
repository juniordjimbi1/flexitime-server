// server/src/utils/fsSafe.js
const fs = require('fs');
const path = require('path');

/**
 * Supprime un fichier en s'assurant qu'il est bien sous le répertoire autorisé (root).
 * @param {string} root - répertoire racine (absolu)
 * @param {string} p - chemin de fichier (absolu ou relatif)
 * @returns {boolean} true si supprimé, false sinon
 */
function safeUnlink(root, p) {
  try {
    const absRoot = path.resolve(root);
    const absPath = path.resolve(path.isAbsolute(p) ? p : path.join(absRoot, p));
    if (!absPath.startsWith(absRoot)) return false;
    if (fs.existsSync(absPath) && fs.lstatSync(absPath).isFile()) {
      fs.unlinkSync(absPath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Supprime un ensemble de chemins (array) en sécurité.
 * @param {string} root
 * @param {string[]} files
 * @returns {{removed:string[], failed:string[]}}
 */
function batchUnlink(root, files) {
  const removed = [], failed = [];
  for (const f of files || []) {
    safeUnlink(root, f) ? removed.push(f) : failed.push(f);
  }
  return { removed, failed };
}

module.exports = { safeUnlink, batchUnlink };
