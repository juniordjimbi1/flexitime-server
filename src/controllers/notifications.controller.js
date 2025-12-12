// server/src/controllers/notifications.controller.js
const { body, query, validationResult } = require('express-validator');
const { listForUser, markReadFor, pushNotification } = require('../utils/notifications');
const { query: db } = require('../config/db');

function vErr(res, errors) {
  return res.status(422).json({ success: false, message: 'Validation error', details: errors.array() });
}

const val = {
  list: [
    query('only_unread').optional().isIn(['0','1']),
    query('limit').optional().toInt().isInt({ min: 1, max: 100 }),
    query('offset').optional().toInt().isInt({ min: 0 }),
    (req,res,next)=>{ const e = validationResult(req); if(!e.isEmpty()) return vErr(res, e); next(); }
  ],
  markRead: [
    body('ids').isArray({ min: 1 }),
    body('ids.*').toInt().isInt({ min: 1 }),
    (req,res,next)=>{ const e = validationResult(req); if(!e.isEmpty()) return vErr(res, e); next(); }
  ],
  simulate: [
    body('type').isString().isLength({ min: 2, max: 48 }),
    body('title').isString().isLength({ min: 2, max: 160 }),
    body('body').optional().isString(),
    body('link').optional().isString(),
    body('recipient_ids').isArray({ min: 1 }),
    body('recipient_ids.*').toInt().isInt({ min: 1 }),
    (req,res,next)=>{ const e = validationResult(req); if(!e.isEmpty()) return vErr(res, e); next(); }
  ],
};

async function list(req, res) {
  const rows = await listForUser(req.user.id, {
    onlyUnread: req.query.only_unread === '1',
    limit: req.query.limit || 20,
    offset: req.query.offset || 0
  });
  res.json({ success: true, data: rows });
}

async function markRead(req, res) {
  const count = await markReadFor(req.user.id, req.body.ids.map(Number));
  res.json({ success: true, data: { updated: count } });
}

/** Endpoint de test (Admin/Manager) pour injecter une notif sans passer par un autre controller. */
async function simulate(req, res) {
  const nid = await pushNotification({
    type: req.body.type,
    title: req.body.title,
    body: req.body.body || null,
    link: req.body.link || null,
    creator_user_id: req.user.id,
    recipient_ids: req.body.recipient_ids.map(Number)
  });
  res.status(201).json({ success: true, data: { id: nid } });
}

/**
 * Helpers d’intégration (à appeler depuis tes contrôleurs existants) :
 *  - notifyEmployeeDayClosed(employeeUserId, managerUserIds[], dateYmd)
 *  - notifyTeamFinalClosed(managerUserId, adminUserIds[], teamId, dateYmd)
 */
async function notifyEmployeeDayClosed(employeeUserId, managerUserIds, dateYmd) {
  if (!managerUserIds?.length) return;
  await pushNotification({
    type: 'EMPLOYEE_DAY_CLOSED',
    title: `Clôture journalière validée`,
    body: `L’employé #${employeeUserId} a clôturé sa journée du ${dateYmd}.`,
    link: `/manager/validations?date=${dateYmd}`,
    creator_user_id: employeeUserId,
    recipient_ids: managerUserIds
  });
}
async function notifyTeamFinalClosed(managerUserId, adminUserIds, teamId, dateYmd) {
  if (!adminUserIds?.length) return;
  await pushNotification({
    type: 'TEAM_FINAL_CLOSED',
    title: `Clôture finale d’équipe`,
    body: `L’équipe #${teamId} a été clôturée par le manager #${managerUserId} (période ${dateYmd}).`,
    link: `/admin/team-final-close?date=${dateYmd}&team_id=${teamId}`,
    creator_user_id: managerUserId,
    recipient_ids: adminUserIds
  });
}

module.exports = { val, list, markRead, simulate, notifyEmployeeDayClosed, notifyTeamFinalClosed };
