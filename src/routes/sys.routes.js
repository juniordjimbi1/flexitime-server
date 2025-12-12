const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const { ping, query } = require('../config/db');

router.get('/health', (req, res) => {
  ok(res, { status: 'ok', time: new Date().toISOString() });
});

router.get('/db/ping', asyncHandler(async (req, res) => {
  await ping();
  ok(res, { db: 'ok' });
}));

router.get('/roles', asyncHandler(async (req, res) => {
  const rows = await query('SELECT id, code, label FROM roles ORDER BY id');
  ok(res, rows);
}));

module.exports = router;
