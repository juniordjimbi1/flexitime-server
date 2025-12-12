const jwt = require('jsonwebtoken');

function parseAuthHeader(req) {
  const h = req.headers['authorization'];
  if (!h) return null;
  const parts = h.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
}

function requireAuth(req, res, next) {
  const token = parseAuthHeader(req);
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // payload: { sub, role_id, role_code, email, first_name, last_name, iat, exp }
    req.user = {
      id: payload.sub,
      role_id: payload.role_id,
      role_code: payload.role_code,
      email: payload.email,
      first_name: payload.first_name,
      last_name: payload.last_name,
    };
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!allowed.includes(req.user.role_code)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
