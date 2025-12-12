const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const M = require('../controllers/manager.team.controller');

// toutes protégées (MANAGER propriétaire)
router.get('/',                      requireAuth, (req,res,next)=>M.myTeams(req,res).catch(next));
router.get('/:teamId/members',       requireAuth, (req,res,next)=>M.teamMembers(req,res).catch(next));
router.get('/:teamId/candidates',    requireAuth, (req,res,next)=>M.candidates(req,res).catch(next));
router.post('/:teamId/members',      requireAuth, (req,res,next)=>M.addMember(req,res).catch(next));
router.delete('/:teamId/members/:userId', requireAuth, (req,res,next)=>M.removeMember(req,res).catch(next));

module.exports = router;
