// server/src/middleware/rateLimit.js
const rateLimit = require('express-rate-limit');

/**
 * Limiteur global API (doux)
 * 300 requêtes / 5 min par IP (valeurs ajustables via .env)
 */
const apiLimiter = rateLimit({
  windowMs: Number(process.env.RL_API_WINDOW_MS || 5 * 60 * 1000),
  max: Number(process.env.RL_API_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de requêtes, réessayez plus tard.' }
});

/**
 * Limiteur spécifique Auth (login)
 * 10 requêtes / 5 min par IP
 */
const authLimiter = rateLimit({
  windowMs: Number(process.env.RL_AUTH_WINDOW_MS || 5 * 60 * 1000),
  max: Number(process.env.RL_AUTH_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives de connexion, réessayez plus tard.' }
});

module.exports = { apiLimiter, authLimiter };
