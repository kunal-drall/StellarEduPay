const express = require('express');
const router = express.Router();
const { getPaymentInstructions, verifyPayment, syncAllPayments, getStudentPayments, getAcceptedAssets, getOverpayments, getStudentBalance, getSuspiciousPayments } = require('../controllers/paymentController');

router.get('/accepted-assets', getAcceptedAssets);
router.get('/overpayments', getOverpayments);
router.get('/suspicious', getSuspiciousPayments);
router.get('/balance/:studentId', getStudentBalance);
router.get('/instructions/:studentId', getPaymentInstructions);
router.get('/:studentId', getStudentPayments);
router.post('/verify', verifyPayment);
router.post('/sync', syncAllPayments);

module.exports = router;

