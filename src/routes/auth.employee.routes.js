const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const A = require('../controllers/authEmployee.controller');

router.post('/employee-signup', asyncHandler(A.employeeSignup));

module.exports = router;
