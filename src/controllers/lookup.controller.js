const { query: db } = require('../config/db');

function toUInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/* -------------------- EXISTANTS -------------------- */

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

/* ---------------- ORG TEAM MEMBERS -----------------
   People-picker projets

   Shape aligné sur le Front :
   - id
   - first_name
   - last_name
   - email
   - role_code

   RBAC :
   - ADMIN   : peut voir tous les membres de l'équipe
   - MANAGER : doit appartenir à l'équipe (présent dans team_members)

   Jamais d'erreur 500 : success:true systématique
----------------------------------------------------- */

/* ---------------- ORG TEAM MEMBERS -----------------
   People-picker projets

   Shape aligné sur le Front :
   - id
   - first_name
   - last_name
   - email
   - role_code

   RBAC :
   - ADMIN : ok
   - MANAGER : doit appartenir à l'équipe (membre OU manager)
   - EMPLOYEE : jamais
   - On ne renvoie que des users rattachés à l'équipe (team_members + manager)
   - Jamais d'erreur 500 : success:true systématique
----------------------------------------------------- */

async function orgTeamMembers(req, res) {
  const me   = req.user;
  const team = toUInt(req.query.team_id);
  const q    = (req.query.q || '').toString().trim();

  try {
    if (!team) {
      return res.json({ success: true, data: [], meta: { stage: 'no-team' } });
    }

    // 1) Vérifier existence de l’équipe
    const t = await db(`SELECT id, manager_user_id FROM teams WHERE id = ? LIMIT 1`, [team]);
    if (!t.length) {
      return res.json({ success: true, data: [], meta: { stage: 'team-not-found' } });
    }

    // 2) RBAC Manager : doit être membre de l'équipe (membre OU manager)
    if (me?.role_code === 'MANAGER') {
      const allowed = await db(
        `
        SELECT 1 
          FROM (
            SELECT tm.user_id AS user_id
              FROM team_members tm
             WHERE tm.team_id = ?
            UNION
            SELECT manager_user_id AS user_id
              FROM teams
             WHERE id = ?
          ) x
         WHERE x.user_id = ?
         LIMIT 1
        `,
        [team, team, me.id]
      );
      if (!allowed.length) {
        return res.json({ success: true, data: [], meta: { stage: 'forbidden' } });
      }
    }

    // 3) Jointure equipe -> users : membres + manager
    const baseSql = `
      SELECT
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        CASE u.role_id
          WHEN 1 THEN 'ADMIN'
          WHEN 2 THEN 'MANAGER'
          WHEN 3 THEN 'EMPLOYEE'
          ELSE 'USER'
        END AS role_code
      FROM (
        SELECT tm.user_id AS user_id
          FROM team_members tm
         WHERE tm.team_id = ?
        UNION
        SELECT manager_user_id AS user_id
          FROM teams
         WHERE id = ? AND manager_user_id IS NOT NULL
      ) x
      JOIN users u ON u.id = x.user_id
    `;

    let rows;
    if (q) {
      const like = `%${q}%`;
      rows = await db(
        baseSql + `
          AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)
          ORDER BY u.last_name ASC, u.first_name ASC
        `,
        [team, team, like, like, like]
      );
    } else {
      rows = await db(
        baseSql + `
          ORDER BY u.last_name ASC, u.first_name ASC
        `,
        [team, team]
      );
    }

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('orgTeamMembers error:', err.message);
    return res.json({ success: true, data: [], meta: { stage: 'catch', error: err.message } });
  }
}


module.exports = {
  departments,
  subdepartments,
  orgTeamMembers,
};
