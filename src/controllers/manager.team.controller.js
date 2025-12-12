const { query: db } = require('../config/db');

async function roleOf(userId) {
  const r = await db(`SELECT r.code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? LIMIT 1`, [userId]);
  return r?.[0]?.code || null;
}
async function assertManagerOwnsTeam(managerId, teamId) {
  const r = await db(`SELECT id, subdepartment_id FROM teams WHERE id=? AND manager_user_id=?`, [teamId, managerId]);
  if (!r?.[0]) return null;
  return r[0];
}

/** GET /manager/teams — mes équipes */
async function myTeams(req, res) {
  const me = req.user.id;
  const r = await db(`
    SELECT t.id, t.name, t.subdepartment_id, sd.name AS subdepartment_name,
           d.id AS department_id, d.name AS department_name
    FROM teams t
    JOIN subdepartments sd ON sd.id=t.subdepartment_id
    JOIN departments d ON d.id=sd.department_id
    WHERE t.manager_user_id=?
    ORDER BY t.name
  `, [me]);
  res.json({ success: true, data: r || [] });
}

/** GET /manager/teams/:teamId/members — membres actuels */
async function teamMembers(req, res) {
  const me = req.user.id;
  const teamId = Number(req.params.teamId);
  const team = await assertManagerOwnsTeam(me, teamId);
  if (!team) return res.status(403).json({ success:false, message:'Accès refusé' });

  const rows = await db(`
    SELECT u.id, u.first_name, u.last_name, u.email
    FROM team_members tm
    JOIN users u ON u.id=tm.user_id
    WHERE tm.team_id=?
    ORDER BY u.last_name, u.first_name
  `, [teamId]);
  res.json({ success:true, data: rows || [] });
}

/** GET /manager/teams/:teamId/candidates?q= */
async function candidates(req, res) {
  const me = req.user.id;
  const teamId = Number(req.params.teamId);
  const team = await assertManagerOwnsTeam(me, teamId);
  if (!team) return res.status(403).json({ success:false, message:'Accès refusé' });

  const q = (req.query?.q || '').trim();
  const params = [team.subdepartment_id, teamId];
  let whereQ = '';
  if (q) {
    whereQ = ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?) `;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const rows = await db(
    `
    SELECT u.id, u.first_name, u.last_name, u.email, r.code AS role_code
    FROM users u
    JOIN roles r ON r.id=u.role_id
    WHERE r.code<>'ADMIN'
      AND u.subdepartment_id = ?
      AND u.id NOT IN (SELECT user_id FROM team_members WHERE team_id = ?)
      ${whereQ}
    ORDER BY u.last_name, u.first_name
    `,
    params
  );

  res.json({ success:true, data: rows || [] });
}

/** POST /manager/teams/:teamId/members  { user_id } */
async function addMember(req, res) {
  const me = req.user.id;
  const teamId = Number(req.params.teamId);
  const { user_id } = req.body || {};
  const uid = Number(user_id || 0);

  const team = await assertManagerOwnsTeam(me, teamId);
  if (!team) return res.status(403).json({ success:false, message:'Accès refusé' });
  if (!uid)  return res.status(400).json({ success:false, message:'user_id requis' });

  const rUser = await db(`SELECT r.code AS role_code, subdepartment_id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`, [uid]);
  if (!rUser?.[0]) return res.status(404).json({ success:false, message:'Utilisateur introuvable' });
  if (rUser[0].role_code === 'ADMIN') return res.status(400).json({ success:false, message:'ADMIN non éligible' });
  if (Number(rUser[0].subdepartment_id) !== Number(team.subdepartment_id)) {
    return res.status(409).json({ success:false, message:'Sous-département incompatible' });
  }

  // éviter doublons
  await db(`INSERT IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)`, [teamId, uid]);
  const rows = await db(`SELECT user_id FROM team_members WHERE team_id=? AND user_id=?`, [teamId, uid]);
  res.status(201).json({ success:true, data: rows?.[0] ? { team_id: teamId, user_id: uid } : null });
}

/** DELETE /manager/teams/:teamId/members/:userId */
async function removeMember(req, res) {
  const me = req.user.id;
  const teamId = Number(req.params.teamId);
  const userId = Number(req.params.userId);
  const team = await assertManagerOwnsTeam(me, teamId);
  if (!team) return res.status(403).json({ success:false, message:'Accès refusé' });

  await db(`DELETE FROM team_members WHERE team_id=? AND user_id=?`, [teamId, userId]);
  res.json({ success:true });
}

module.exports = {
  myTeams,
  teamMembers,
  candidates,
  addMember,
  removeMember
};
