// server/src/app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/error');
const { apiLimiter } = require('./middleware/rateLimit'); // <-- AJOUT

const app = express();

// Sécurité + logs + parsers
app.use(helmet({
  // Assouplissements utiles en dev (PDF, toasts inline, etc.)
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));
const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
app.use(cors({ origin: allowedOrigin, credentials: false }));

app.use(express.json({ limit: process.env.JSON_LIMIT || '1mb' }));
app.use(morgan('dev'));

// Rate limit global pour l'API (doux, non bloquant dans l'usage normal)
app.use('/api', apiLimiter);

// Routes
app.use('/api', routes);

// 404 & erreurs
app.use(notFound);
app.use(errorHandler);

module.exports = app;
