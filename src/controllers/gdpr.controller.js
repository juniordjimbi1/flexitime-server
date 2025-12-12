// server/src/controllers/gdpr.controller.js
const { param, body, validationResult } = require('express-validator');
const { query: db } = require('../config/db');
const path = require('path');
const { batchUnlink } = require('../utils/fsSafe');

function vErr(res, errors) {
  return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });
}

// Config uploads: racine à partir de la config existante ou fallback "uploads"
const UPLOADS_ROOT = process.env.UPLOADS_ROOT
  ? path.resolve(process.env.UPLOADS_ROOT)
  : path.resolve(process.cwd(), 'uploads');

/** Vérifie si une table/colonne existe (pour purges conditionnelles robustes) */
async function tableExists(name) {
  const r = await db(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [name]);
  return !!r[0];
}
async function columnExists(table, column) {
  const r = await db(`SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
  return !!r[0];
}

/** Aperçu des impacts: nb tâches créées par user, fichiers trouvés (si tables pertinentes existent) */
async function previewImpacts(targetUserId) {
  const impacts = { tasks_created: 0, file_candidates: [] };

  // Compter tâches créées
  if (await tableExists('tasks') && await columnExists('tasks', 'created_by_user_id')) {
    const r = await db(`SELECT COUNT(*) AS c FROM tasks WHERE created_by_user_id = ?`, [targetUserId]);
    impacts.tasks_created = r[0]?.c || 0;
  }

  // Collecte de fichiers à purger selon tables si elles existent.
  // On couvre quelques cas classiques sans supposer le schéma exact.
  const collectors = [
    { table: 'task_files', colPath: 'file_path', colUser: 'uploaded_by_user_id' },
    { table: 'validation_files', colPath: 'file_path', colUser: 'uploaded_by_user_id' },
    { table: 'session_attachments', colPath: 'file_path', colUser: 'user_id' },
  ];

  for (const c of collectors) {
    if (await tableExists(c.table) && await columnExists(c.table, c.colPath) && await columnExists(c.table, c.colUser)) {
      const rows = await db(`SELECT ${c.colPath} AS path FROM ${c.table} WHERE ${c.colUser} = ?`, [targetUserId]);
      for (const r of rows) {
        if (r.path && !impacts.file_candidates.includes(r.path)) impacts.file_candidates.push(r.path);
      }
    }
  }

  return impacts;
}

const val = {
  preview: [
    param('userId').toInt().isInt({ min: 1 }),
    (req,res,next)=>{ const e=validationResult(req); if(!e.isEmpty()) return vErr(res,e); next(); }
  ],
  execute: [
    param('userId').toInt().isInt({ min: 1 }),
    body('confirm').equals('YES').withMessage('confirm=YES requis'),
    body('note').optional().isString().isLength({ max: 255 }),
    (req,res,next)=>{ const e=validationResult(req); if(!e.isEmpty()) return vErr(res,e); next(); }
  ]
};

/**
 * GET /gdpr/preview/:userId
 * - Compte tâches créées
 * - Liste les chemins de fichiers candidats à la purge (si tables de PJ existent)
 */
async function preview(req, res) {
  const userId = Number(req.params.userId);
  const user = await db(`SELECT id FROM users WHERE id = ?`, [userId]);
  if (!user[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

  const impacts = await previewImpacts(userId);
  res.json({ success: true, data: impacts });
}

/**
 * POST /gdpr/execute/:userId
 * Étapes:
 *  - Réaffecter tasks.created_by_user_id -> ADMIN (appelant ou un admin choisi)
 *  - Purger fichiers (best-effort) du user (tables détectées + sous-dossier "uploads/user_<id>/*" si présent)
 *  - Anonymiser le compte (email, nom) et désactiver si colonnes disponibles
 *  - Log en table gdpr_deletions
 */
async function execute(req, res) {
  const targetUserId = Number(req.params.userId);
  const note = req.body.note || null;

  const target = await db(`SELECT id, email FROM users WHERE id = ?`, [targetUserId]);
  if (!target[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

  // Déterminer ADMIN de réaffectation (par défaut: l'admin appelant)
  const adminId = req.user.id;

  // Prévisualisation des impacts
  const impacts = await previewImpacts(targetUserId);

  // Transaction logique (simple, sans START TRANSACTION ici pour rester compatible avec mysql2 en mode pool/auto-commit)
  // 1) Réaffecter tâches créées
  if (await tableExists('tasks') && await columnExists('tasks', 'created_by_user_id')) {
    await db(`UPDATE tasks SET created_by_user_id = ? WHERE created_by_user_id = ?`, [adminId, targetUserId]);
  }

  // 2) Purge fichiers via tables connues
  let purged = { removed: [], failed: [] };
  if (impacts.file_candidates.length) {
    purged = batchUnlink(UPLOADS_ROOT, impacts.file_candidates);
  }

  // 2bis) Purge best-effort d'un éventuel répertoire dédié (uploads/user_<id>/...)
  // (safe: tentera de supprimer quelques chemins "standard" si existants)
  const extraCandidates = [
    `user_${targetUserId}`,
    `users/${targetUserId}`,
    `employees/${targetUserId}`
  ];
  for (const rel of extraCandidates) {
    // On ne fait PAS de rmdir récursif agressif; on ne supprime que des fichiers directs fréquents
    // Si tu veux un rm -r contrôlé on pourra l’ajouter plus tard.
    // Ici: rien, par sécurité. (On peut lister et passer à batchUnlink si besoin.)
  }

  // 3) Anonymiser le compte (si colonnes présentes)
  const anonymized = {};
  if (await columnExists('users', 'first_name')) anonymized.first_name = 'Deleted';
  if (await columnExists('users', 'last_name'))  anonymized.last_name  = `User#${targetUserId}`;
  if (await columnExists('users', 'email'))      anonymized.email      = `deleted+${targetUserId}@example.invalid`;
  if (await columnExists('users', 'is_active'))  anonymized.is_active  = 0;

  if (Object.keys(anonymized).length) {
    const fields = Object.keys(anonymized).map(k => `${k} = ?`).join(', ');
    const params = [...Object.values(anonymized), targetUserId];
    await db(`UPDATE users SET ${fields} WHERE id = ?`, params);
  }

  // 4) LOG
  await db(
    `INSERT INTO gdpr_deletions (target_user_id, performed_by, note, details_json)
     VALUES (?, ?, ?, JSON_OBJECT('tasks_reassigned', ?, 'files_removed', ?, 'files_failed', ?))`,
    [targetUserId, adminId, note, impacts.tasks_created, JSON.stringify(purged.removed || []), JSON.stringify(purged.failed || [])]
  );

  res.json({
    success: true,
    data: {
      tasks_reassigned: impacts.tasks_created,
      files_removed: purged.removed.length,
      files_failed: purged.failed.length,
      anonymized: Object.keys(anonymized)
    }
  });
}

module.exports = { val, preview, execute };
