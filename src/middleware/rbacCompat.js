// server/src/middleware/rbacCompat.js
/**
 * Normalise req.user.role_code à partir de différentes formes possibles:
 *  - req.user.role_code
 *  - req.user.role?.code
 *  - req.user.role (string)
 */
function normalizeUserRole(req) {
  if (!req.user) return null;
  if (req.user.role_code) return req.user.role_code;
  if (req.user.role && typeof req.user.role === 'object' && req.user.role.code) {
    req.user.role_code = req.user.role.code;
    return req.user.role_code;
  }
  if (req.user.role && typeof req.user.role === 'string') {
    req.user.role_code = req.user.role;
    return req.user.role_code;
  }
  return null;
}

/**
 * Middleware: autorise si le rôle courant est dans la whitelist.
 * Utiliser à la place de requireRole sur les routes où l'on voit des 403 inattendus.
 */
function allowRoles(allowed) {
  return (req, res, next) => {
    const role = normalizeUserRole(req);
    if (!role) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!allowed.includes(role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
}

module.exports = { allowRoles, normalizeUserRole };
