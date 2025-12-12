// src/routes/projects.routes.js
const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/projects.controller');
const { withPagination } = require('../middleware/pagination');

const router = express.Router();

// --- Projets (existants) ---
router.get('/', requireAuth, ctrl.validate.list, ctrl.list);
router.post('/', requireAuth, requireRole('ADMIN','MANAGER'), ctrl.validate.create, ctrl.create);
router.get('/:id', requireAuth, ctrl.validate.byId, ctrl.details);
router.patch('/:id', requireAuth, ctrl.validate.update, ctrl.update);
router.delete('/:id', requireAuth, ctrl.validate.byId, ctrl.archive);

// --- Membres (existants) ---
router.get('/:id/members', requireAuth, ctrl.validate.byId, ctrl.membersList);
router.post('/:id/members', requireAuth, requireRole('ADMIN','MANAGER'), ctrl.validate.addMember, ctrl.membersAdd);
router.delete('/:id/members/:userId', requireAuth, requireRole('ADMIN','MANAGER'), ctrl.validate.removeMember, ctrl.membersRemove);

// --- NOUVEAU : liste des membres éligibles (Admin = toute l’orga ; Manager = seulement ses équipes) ---
router.get('/:id/eligible-members', requireAuth, ctrl.validate.byId, ctrl.eligibleMembers);

router.get('/', requireAuth, withPagination, ctrl.validate.list, ctrl.list);

// --- NOUVEAU : ajout en lot de membres au projet ---
router.post('/:id/members/batch',
  requireAuth,
  requireRole('ADMIN','MANAGER'),
  ctrl.valExtra.addMembersBatch,   // validations (ids array)
  ctrl.addMembersBatch             // insert IGNORE + retour total_members
);

module.exports = router; // ⬅️ INDISPENSABLE
