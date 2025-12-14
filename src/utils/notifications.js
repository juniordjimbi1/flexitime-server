// server/src/utils/notifications.js
const { query: db } = require('../config/db');

/**
 * Crée une notification et l’affecte à une liste de destinataires.
 * @param {Object} p
 * @param {string} p.type        - code (ex: 'EMPLOYEE_DAY_CLOSED')
 * @param {string} p.title       - court
 * @param {string} [p.body]      - texte optionnel
 * @param {string} [p.link]      - lien interne (ex: '/manager/validations?date=2025-10-23')
 * @param {number|null} [p.creator_user_id] - auteur (facultatif)
 * @param {number[]} p.recipient_ids - array d'ids (BIGINT UNSIGNED)
 * @returns {Promise<number>} notification_id
 */
async function pushNotification(p) {
  if (!p?.type || !p?.title || !Array.isArray(p?.recipient_ids) || p.recipient_ids.length === 0) {
    throw new Error('Invalid notification payload');
  }
  const res = await db(
    `INSERT INTO notifications (type, title, body, link, creator_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [p.type, p.title, p.body || null, p.link || null, p.creator_user_id || null]
  );
  const nid = res.insertId;

  const values = p.recipient_ids.map(() => '(?, ?, 0, NULL)').join(',');
  await db(
    `INSERT INTO user_notifications (notification_id, recipient_user_id, is_read, read_at)
     VALUES ${values}`,
    p.recipient_ids.flatMap(uid => [nid, uid])
  );

  return nid;
}

/** Marque lue une liste de notifs pour un user. */
async function markReadFor(userId, ids) {
  if (!ids?.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const params = [new Date(), userId, ...ids];
  const r = await db(
    `UPDATE user_notifications
       SET is_read = 1, read_at = ?
     WHERE recipient_user_id = ? AND notification_id IN (${placeholders})`,
    params
  );
  return r.affectedRows || 0;
}

/** Liste les notifs d’un user avec pagination simple. */
async function listForUser(userId, { onlyUnread = false, limit = 20, offset = 0 } = {}) {
  const where = ['un.recipient_user_id = ?'];
  const params = [userId];

  if (onlyUnread) where.push('un.is_read = 0');

  const lim = Math.min(Math.max(parseInt(limit ?? 20, 10), 1), 100);
  const off = Math.max(parseInt(offset ?? 0, 10), 0);

  const sql = `
    SELECT n.id, n.type, n.title, n.body, n.link, n.creator_user_id, n.created_at,
           un.is_read, un.read_at
      FROM user_notifications un
      JOIN notifications n ON n.id = un.notification_id
     WHERE ${where.join(' AND ')}
     ORDER BY n.created_at DESC
     LIMIT ${lim} OFFSET ${off}
  `;

  return db(sql, params);
}


module.exports = { pushNotification, markReadFor, listForUser };
