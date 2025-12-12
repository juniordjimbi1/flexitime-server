const { query: db } = require('../config/db');

async function myTeamMembers(req, res) {
  const me = req.user.id;
  const rows = await db(`
    SELECT u.id, u.first_name, u.last_name, u.email, tm.name AS team_name
    FROM team_members tmm
    JOIN teams tm ON tm.id = tmm.team_id
    JOIN users u ON u.id = tmm.user_id
    WHERE tm.manager_user_id = ?
    ORDER BY tm.name, u.last_name, u.first_name
  `, [me]);
  res.json({ success: true, data: rows || [] });
}

module.exports = { myTeamMembers };
