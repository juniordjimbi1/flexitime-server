const bcrypt = require('bcryptjs');
const { query: db } = require('../config/db');

// --- helpers
async function fetchMe(uid) {
  const rows = await db(`
    SELECT u.id, u.first_name, u.last_name, u.email, u.subdepartment_id,
           r.code AS role_code
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
    LIMIT 1
  `, [uid]);
  return rows?.[0] || null;
}

async function loadDeps() {
  const deps = await db(`SELECT id, name FROM departments ORDER BY name ASC`);
  const subs = await db(`SELECT id, department_id, name FROM subdepartments ORDER BY name ASC`);
  return { deps, subs };
}

// --- GET /profile/me
async function me(req, res) {
  const uid = req.user.id;
  const meUser = await fetchMe(uid);
  const lists = await loadDeps();
  res.json({ success: true, data: { me: meUser, ...lists } });
}

// --- PATCH /profile/me  (first_name, last_name, subdepartment_id)
async function updateBasic(req, res) {
  const uid = req.user.id;
  const { first_name, last_name, subdepartment_id = null } = req.body || {};

  if (!first_name || !String(first_name).trim() || !last_name || !String(last_name).trim()) {
    return res.status(400).json({ success: false, message: 'Prénom et nom sont requis' });
  }

  const subId = subdepartment_id ? Number(subdepartment_id) : null;
  if (subId) {
    const ok = await db(`SELECT id FROM subdepartments WHERE id=?`, [subId]);
    if (!ok?.[0]) return res.status(400).json({ success: false, message: 'Sous-département invalide' });
  }

  await db(
    `UPDATE users SET first_name=?, last_name=?, subdepartment_id=? WHERE id=?`,
    [String(first_name).trim(), String(last_name).trim(), subId, uid]
  );

  const meUser = await fetchMe(uid);
  res.json({ success: true, data: meUser });
}

// --- PATCH /profile/me/email  (email unique)
async function updateEmail(req, res) {
  const uid = req.user.id;
  const { email } = req.body || {};
  if (!email || !String(email).trim()) {
    return res.status(400).json({ success: false, message: 'Email requis' });
  }
  const e = String(email).trim().toLowerCase();

  const exists = await db(`SELECT id FROM users WHERE email=? AND id<>?`, [e, uid]);
  if (exists?.[0]) return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé' });

  await db(`UPDATE users SET email=? WHERE id=?`, [e, uid]);
  const meUser = await fetchMe(uid);
  res.json({ success: true, data: meUser });
}

// --- PATCH /profile/me/password  (current_password, new_password)
async function updatePassword(req, res) {
  const uid = req.user.id;
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ success: false, message: 'Mot de passe actuel et nouveau requis' });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ success: false, message: 'Nouveau mot de passe trop court (min 6)' });
  }

  const rows = await db(`SELECT password FROM users WHERE id=?`, [uid]);
  if (!rows?.[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

  const ok = await bcrypt.compare(String(current_password), rows[0].password || '');
  if (!ok) return res.status(401).json({ success: false, message: 'Mot de passe actuel invalide' });

  const hash = await bcrypt.hash(String(new_password), 10);
  await db(`UPDATE users SET password=? WHERE id=?`, [hash, uid]);

  res.json({ success: true, message: 'Mot de passe mis à jour' });
}

// --- DELETE /profile/me  (suppression sécurisée)
// Interdit si l’utilisateur est MANAGER d’une équipe.
async function deleteMe(req, res) {
  const uid = req.user.id;

  // refuse si manager d'équipe
  const isMgr = await db(`SELECT id FROM teams WHERE manager_user_id=? LIMIT 1`, [uid]);
  if (isMgr?.[0]) {
    return res.status(409).json({ success: false, message: 'Impossible : vous êtes chef d’équipe. Demandez à un admin de réassigner l’équipe.' });
  }

  // transaction
  await db('START TRANSACTION');

  try {
    // Supprimer les fichiers liés aux clôtures de l’utilisateur
    const dcIds = await db(`SELECT id FROM day_closes WHERE user_id=?`, [uid]);
    const idList = (dcIds || []).map(r => r.id);
    if (idList.length) {
      const inIds = idList.map(() => '?').join(',');
      await db(`DELETE FROM day_close_files WHERE day_close_id IN (${inIds})`, idList);
      await db(`DELETE FROM day_close_validations WHERE day_close_id IN (${inIds})`, idList);
    }

    // Dépendances directes
    await db(`DELETE FROM sessions WHERE user_id=?`, [uid]);
    await db(`DELETE FROM task_assignees WHERE user_id=?`, [uid]);
    await db(`DELETE FROM team_members WHERE user_id=?`, [uid]);
    await db(`DELETE FROM day_closes WHERE user_id=?`, [uid]);

    // Enfin, supprimer l’utilisateur
    await db(`DELETE FROM users WHERE id=?`, [uid]);

    await db('COMMIT');
  } catch (e) {
    await db('ROLLBACK');
    return res.status(500).json({ success: false, message: 'Erreur lors de la suppression', error: e?.message });
  }

  res.json({ success: true, message: 'Compte supprimé' });
}

module.exports = {
  me,
  updateBasic,
  updateEmail,
  updatePassword,
  deleteMe,
};
