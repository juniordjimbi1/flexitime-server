const { query: db } = require('../config/db');

// Récupère le rôle (code) d'un utilisateur : ADMIN / MANAGER / EMPLOYEE
async function getRoleCode(userId) {
  const rows = await db(
    `
    SELECT r.code
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
    LIMIT 1
    `,
    [userId]
  );
  return rows?.[0]?.code || null;
}

/**
 * GET /teams/manage/departments
 * Liste simple des départements (ADMIN uniquement)
 */
async function listDepartments(req, res) {
  try {
    const meRole = await getRoleCode(req.user.id);
    if (meRole !== 'ADMIN') {
      return res
        .status(403)
        .json({ success: false, message: 'Accès refusé (ADMIN requis)' });
    }

    const rows = await db(
      `
      SELECT id, name
      FROM departments
      ORDER BY name ASC
      `
    );

    return res.json({ success: true, data: rows || [] });
  } catch (err) {
    console.error('listDepartments error:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Erreur serveur lors du chargement des départements' });
  }
}

/**
 * GET /teams/manage/subdepartments?department_id=
 * Liste des sous-départements, filtrable par département (ADMIN uniquement)
 */
async function listSubdepartments(req, res) {
  try {
    const meRole = await getRoleCode(req.user.id);
    if (meRole !== 'ADMIN') {
      return res
        .status(403)
        .json({ success: false, message: 'Accès refusé (ADMIN requis)' });
    }

    const depId = req.query?.department_id ? Number(req.query.department_id) : null;

    let sql = `
      SELECT
        sd.id,
        sd.name,
        sd.department_id,
        d.name AS department_name
      FROM subdepartments sd
      JOIN departments d ON d.id = sd.department_id
    `;
    const params = [];

    if (depId) {
      sql += ' WHERE sd.department_id = ?';
      params.push(depId);
    }

    sql += ' ORDER BY d.name, sd.name';

    const rows = await db(sql, params);
    return res.json({ success: true, data: rows || [] });
  } catch (err) {
    console.error('listSubdepartments error:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Erreur serveur lors du chargement des sous-départements' });
  }
}

/**
 * GET /teams/manage/users?department_id=&subdepartment_id=&q=&role=
 * Liste des utilisateurs (sans ADMIN), filtrable par rôle / département / sous-département / recherche texte.
 * ADMIN uniquement.
 */
async function listUsers(req, res) {
  try {
    const meRole = await getRoleCode(req.user.id);
    if (meRole !== 'ADMIN') {
      return res
        .status(403)
        .json({ success: false, message: 'Accès refusé (ADMIN requis)' });
    }

    const depId = req.query?.department_id ? Number(req.query.department_id) : null;
    const subId = req.query?.subdepartment_id ? Number(req.query.subdepartment_id) : null;
    const q = (req.query?.q || '').trim();
    const roleFilter = (req.query?.role || '').trim().toUpperCase(); // EMPLOYEE|MANAGER optionnel

    const params = [];
    let where = `r.code <> 'ADMIN'`; // on exclut les admins

    if (roleFilter && (roleFilter === 'EMPLOYEE' || roleFilter === 'MANAGER')) {
      where += ' AND r.code = ?';
      params.push(roleFilter);
    }

    if (depId) {
      where += ' AND d.id = ?';
      params.push(depId);
    }

    if (subId) {
      where += ' AND sd.id = ?';
      params.push(subId);
    }

    if (q) {
      where += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const rows = await db(
      `
      SELECT
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        r.code        AS role_code,
        sd.id         AS subdepartment_id,
        sd.name       AS subdepartment_name,
        d.id          AS department_id,
        d.name        AS department_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN subdepartments sd ON sd.id = u.subdepartment_id
      LEFT JOIN departments d ON d.id = sd.department_id
      WHERE ${where}
      ORDER BY d.name, sd.name, u.last_name, u.first_name
      `,
      params
    );

    return res.json({ success: true, data: rows || [] });
  } catch (err) {
    console.error('listUsers error:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Erreur serveur lors du chargement des utilisateurs' });
  }
}

/**
 * POST /teams/manage/create
 * body: { name, department_id, subdepartment_id?, manager_user_id, member_user_ids: number[] }
 * Crée l’équipe et ajoute les membres (équipes mixtes possibles).
 */
async function createTeam(req, res) {
  try {
    const meRole = await getRoleCode(req.user.id);
    if (meRole !== 'ADMIN') {
      return res
        .status(403)
        .json({ success: false, message: 'Accès refusé (ADMIN requis)' });
    }

    const {
      name,
      department_id,
      subdepartment_id,
      manager_user_id,
      member_user_ids,
    } = req.body || {};

    // --- validations simples ---
    if (!name || !String(name).trim()) {
      return res
        .status(400)
        .json({ success: false, message: 'Nom d’équipe requis' });
    }

    const depId = department_id ? Number(department_id) : null;
    let subId = subdepartment_id ? Number(subdepartment_id) : null;
    const managerId = manager_user_id ? Number(manager_user_id) : null;

    if (!depId && !subId) {
      return res
        .status(400)
        .json({ success: false, message: 'Département requis' });
    }

    if (!managerId) {
      return res
        .status(400)
        .json({ success: false, message: 'Manager requis' });
    }

    // Vérifier que le manager a bien le rôle MANAGER
    const mgrRows = await db(
      `
      SELECT r.code
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?
      LIMIT 1
      `,
      [managerId]
    );

    if (!mgrRows[0] || mgrRows[0].code !== 'MANAGER') {
      return res.status(400).json({
        success: false,
        message: 'Le manager choisi doit avoir le rôle MANAGER',
      });
    }

    // --- résolution du sous-département ---
    if (!subId) {
      // On a seulement le département → on crée / récupère un sous-département "Général"
      const depRows = await db(
        `
        SELECT id
        FROM departments
        WHERE id = ?
        LIMIT 1
        `,
        [depId]
      );

      if (!depRows[0]) {
        return res
          .status(400)
          .json({ success: false, message: 'Département introuvable' });
      }

      const existing = await db(
        `
        SELECT id
        FROM subdepartments
        WHERE department_id = ? AND name = ?
        LIMIT 1
        `,
        [depId, 'Général']
      );

      if (existing[0]) {
        subId = existing[0].id;
      } else {
        const insertSub = await db(
          `
          INSERT INTO subdepartments (department_id, name)
          VALUES (?, ?)
          `,
          [depId, 'Général']
        );
        subId = insertSub.insertId;
      }
    } else {
      // On a explicitement un subdepartment_id → vérifier cohérence / existence
      const sdRows = await db(
        `
        SELECT id, department_id
        FROM subdepartments
        WHERE id = ?
        LIMIT 1
        `,
        [subId]
      );

      if (!sdRows[0]) {
        return res
          .status(400)
          .json({ success: false, message: 'Sous-département introuvable' });
      }

      if (depId && sdRows[0].department_id !== depId) {
        return res.status(400).json({
          success: false,
          message: 'Sous-département et département incohérents',
        });
      }
    }

    // --- création de l’équipe ---
    const teamInsert = await db(
      `
      INSERT INTO teams (subdepartment_id, name, manager_user_id)
      VALUES (?, ?, ?)
      `,
      [subId, String(name).trim(), managerId]
    );

    const teamId = teamInsert.insertId;

    // --- ajout des membres (équipes mixtes possibles) ---
    const membersRaw = Array.isArray(member_user_ids) ? member_user_ids : [];
    const members = membersRaw
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0 && id !== managerId);

    for (const userId of members) {
      // on évite de dupliquer des lignes
      await db(
        `
        INSERT IGNORE INTO team_members (team_id, user_id, is_lead)
        VALUES (?, ?, 0)
        `,
        [teamId, userId]
      );
    }

    // Renvoyer l’équipe enrichie
    const teamRows = await db(
      `
      SELECT
        t.id,
        t.name,
        t.subdepartment_id,
        t.manager_user_id,
        sd.name AS subdepartment_name,
        d.id   AS department_id,
        d.name AS department_name
      FROM teams t
      JOIN subdepartments sd ON sd.id = t.subdepartment_id
      JOIN departments d ON d.id = sd.department_id
      WHERE t.id = ?
      LIMIT 1
      `,
      [teamId]
    );

    return res.status(201).json({
      success: true,
      data: teamRows?.[0] || { id: teamId, name },
    });
    } catch (err) {
    console.error('createTeam error:', err);

    // On expose le vrai message SQL / Node pour le debug
    const msg =
      err?.sqlMessage ||
      err?.message ||
      'Erreur serveur lors de la création de l’équipe';

    return res.status(500).json({
      success: false,
      message: msg,
    });
  }
}


module.exports = {
  listDepartments,
  listSubdepartments,
  listUsers,
  createTeam,
};
