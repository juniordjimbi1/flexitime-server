// server/src/scripts/cleanup-orphans.js
/**
 * Script de nettoyage des fichiers orphelins.
 *
 * Idée:
 * - l'app sauvegarde des chemins de fichiers (ex: uploads/abc123.pdf) dans certaines colonnes.
 * - ici, on scanne le dossier 'uploads' et on compare avec la "whitelist" issue de la DB.
 * - tout fichier présent sur disque mais non référencé en DB => supprimé (option --dry pour simuler).
 *
 * ⚠️ Adapte TABLES_COLUMNS ci-dessous à tes colonnes réelles qui stockent des chemins !
 */

const fs = require('fs');
const path = require('path');
const { query: db } = require('../config/db');

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const DRY_RUN = process.argv.includes('--dry');

const TABLES_COLUMNS = [
  // [table, column] — colonnes qui stockent le NOM DE FICHIER (pas le chemin complet)
  ['day_close_files', 'filename'],
  ['team_close_files', 'filename'],
];

async function main() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    console.log('[cleanup] dossier uploads introuvable, rien à faire.');
    process.exit(0);
  }

  // 1) Collecter tous les chemins de fichiers référencés en DB
  const alive = new Set();
  for (const [table, column] of TABLES_COLUMNS) {
    try {
      const rows = await db(`SELECT ${column} AS p FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`);
      for (const r of rows) {
        // On normalise en chemin relatif depuis la racine projet si besoin
        const rel = String(r.p).replace(/^\.?\/?/, '');
        alive.add(rel);
      }
    } catch (e) {
      console.error(`[cleanup] Impossible de lire ${table}.${column} :`, e.message);
    }
  }

  // 2) Lister les fichiers présents physiquement
  const all = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else all.push(p);
    }
  }
  walk(UPLOAD_DIR);

  // 3) Supprimer ceux qui ne sont pas référencés
  let removed = 0;
  for (const abs of all) {
    const rel = path.relative(process.cwd(), abs).split(path.sep).join('/');
    if (!alive.has(rel)) {
      if (DRY_RUN) {
        console.log('[DRY] orphelin =>', rel);
      } else {
        try {
          fs.unlinkSync(abs);
          removed++;
          console.log('[DEL]', rel);
        } catch (e) {
          console.error('[ERR] suppression', rel, e.message);
        }
      }
    }
  }

  console.log(`[cleanup] terminé. supprimés: ${removed}, total: ${all.length}, référencés: ${alive.size}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[cleanup] erreur fatale:', e);
  process.exit(1);
});
