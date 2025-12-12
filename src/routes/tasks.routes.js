// server/src/routes/tasks.routes.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { withPagination } = require('../middleware/pagination'); // <-- AJOUT
const T = require('../controllers/tasks.controller');
const TC = require('../controllers/taskComments.controller');


// Admin & Manager
// Admin, Manager & Employee (l'accès précis est géré dans le contrôleur)
// Admin, Manager & Employee
router.get(
  '/',
  requireAuth,
  requireRole('ADMIN','MANAGER','EMPLOYEE'),
  withPagination,               // <-- AJOUT (non destructif)
  T.val.list,
  asyncHandler(T.listTasks)
);



router.post(
  '/',
  requireAuth,
  requireRole('ADMIN','MANAGER'),
  T.val.create,
  asyncHandler(T.createTask)
);

router.put(
  '/:id',
  requireAuth,
  requireRole('ADMIN','MANAGER'),
  T.val.update,
  asyncHandler(T.updateTask)
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN','MANAGER'),
  asyncHandler(T.deleteTask)
);

router.post(
  '/:id/assign',
  requireAuth,
  requireRole('ADMIN','MANAGER'),
  T.val.assign,
  asyncHandler(T.assignTask)
);

router.delete(
  '/:id/assignees/:userId',
  requireAuth,
  requireRole('ADMIN','MANAGER'),
  T.val.unassign,
  asyncHandler(T.unassignOne)
);

// Employé (et Manager/Admin tolérés)
router.get(
  '/my',
  requireAuth,
  asyncHandler(T.myTasks)
);

router.patch(
  '/:id/status',
  requireAuth,
  T.val.status,
  asyncHandler(T.updateStatus)
);

// Commentaires de tâche
router.get(
  '/:taskId/comments',
  requireAuth,
  TC.val.list,
  asyncHandler(TC.list)
);

router.post(
  '/:taskId/comments',
  requireAuth,
  TC.val.create,
  asyncHandler(TC.create)
);

// Temps passé sur une tâche (checklists / sessions projet)
router.get(
  '/:id/time-tracking',
  requireAuth,
  T.val.time,
  asyncHandler(T.getTimeTracking)
);

module.exports = router;
