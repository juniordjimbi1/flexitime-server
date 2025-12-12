const { query: db } = require('../config/db');

/**
 * GET /users/employees?department_id=
 * ADMIN only — retourne les employés avec département/sous-département
 */
async function listEmployees(req, res) {
  const { department_id } = req.query || {};
  const params = [];
  let where = `WHERE r.code='EMPLOYEE'`;

  if (department_id) {
    where += ` AND u.department_id = ?`;
    params.push(Number(department_id));
  }

  const rows = await db(
    `
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      u.email,
      u.department_id,
      d.name  AS department_name,
      u.subdepartment_id,
      sd.name AS subdepartment_name,
      u.created_at
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN departments d   ON d.id  = u.department_id
    LEFT JOIN subdepartments sd ON sd.id = u.subdepartment_id
    ${where}
    ORDER BY d.name IS NULL, d.name, u.last_name, u.first_name
    `,
    params
  );

  res.json({ success: true, data: rows });
}

module.exports = { listEmployees };
