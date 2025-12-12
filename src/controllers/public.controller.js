const { query: db } = require('../config/db');

async function departments(req, res) {
  const rows = await db(`SELECT id, name FROM departments ORDER BY name ASC`);
  res.json({ success: true, data: rows });
}

async function subdepartments(req, res) {
  const { department_id } = req.query || {};
  if (department_id) {
    const rows = await db(
      `SELECT sd.id, sd.name, sd.department_id
         FROM subdepartments sd
        WHERE sd.department_id = ?
        ORDER BY sd.name ASC`,
      [Number(department_id)]
    );
    return res.json({ success: true, data: rows });
  }
  const rows = await db(`SELECT id, name, department_id FROM subdepartments ORDER BY name ASC`);
  res.json({ success: true, data: rows });
}

module.exports = { departments, subdepartments };
