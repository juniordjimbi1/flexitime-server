const { query } = require('../config/db');

async function getRoleByCode(code) {
  const rows = await query('SELECT id, code, label FROM roles WHERE code = ? LIMIT 1', [code]);
  return rows[0] || null;
}

module.exports = { getRoleByCode };
