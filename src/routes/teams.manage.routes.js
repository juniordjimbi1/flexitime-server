const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const T = require('../controllers/teams.manage.controller');

router.get('/departments',     requireAuth, (req,res,next)=>T.listDepartments(req,res).catch(next));
router.get('/subdepartments',  requireAuth, (req,res,next)=>T.listSubdepartments(req,res).catch(next));
router.get('/users',           requireAuth, (req,res,next)=>T.listUsers(req,res).catch(next));
router.post('/create',         requireAuth, (req,res,next)=>T.createTeam(req,res).catch(next));

module.exports = router;
