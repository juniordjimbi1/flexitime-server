const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');


router.use('/sys', require('./sys.routes'));
router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/org', require('./org.routes'));
router.use('/tasks', require('./tasks.routes'));
router.use('/sessions', require('./sessions.routes'));
router.use('/day-close', require('./dayclose.routes'));
router.use('/reports', require('./reports.routes'));

// ➕ AJOUTS PACK 1
router.use('/profile', require('./profile.routes'));
router.use('/lookup',  require('./lookup.routes'));
router.use('/public',  require('./public.routes'));
router.use('/auth', require('./auth.employee.routes'));
router.use('/users', require('./users.employees.routes'));
router.use('/tasks', require('./tasks.today.routes')); 
router.use('/validations', require('./validations.routes'));
router.use('/day-close',  require('./dayclose.files.routes'));
router.use('/tasks/schedule', require('./tasks.schedule.routes')); // ➕ Pack 6
router.use('/manager',        require('./manager.routes'));        // ➕ Pack 6
router.use('/history', require('./history.routes')); // ➕ Pack 7
router.use('/teams/manage', require('./teams.manage.routes')); // ➕ Pack 8
router.use('/manager/teams', require('./manager.teams.routes')); // ➕ Pack 10A
router.use('/team-close',        require('./teamclose.routes'));         // ➕ Pack 10B (manager)
router.use('/team-validations',  require('./team.validations.routes'));  // ➕ Pack 10B (admin)
router.use('/admin/quick-tasks', require('./admin.quicktasks.routes')); // ➕ Pack 11
router.use('/manager/quick-tasks', require('./manager.quicktasks.routes')); // ➕ Pack 12
router.use('/history', require('./history.routes')); // ➕ Pack 13
router.use('/projects', require('./projects.routes'));
router.use('/tasks/:taskId/checklist', require('./taskChecklists.routes'));
router.use('/planner', require('./planner.routes'));
router.use('/labels', require('./labels.routes'));
router.use('/notifications', require('./notifications.routes'));
router.use('/gdpr', require('./gdpr.routes'));
router.use('/lookup/org', require('./lookup.org.routes'));

router.use('/reporting', requireAuth, require('../routes/reporting.routes'));
router.use('/paged', requireAuth, require('../routes/paginated.routes'));



module.exports = router;
