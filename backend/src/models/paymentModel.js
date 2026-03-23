const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  studentId: { type: String, required: true },
  txHash: { type: String, required: true, unique: true, index: true },
  amount: { type: Number, required: true },
  feeAmount: { type: Number, default: null },
  feeValidationStatus: { type: String, enum: ['valid', 'underpaid', 'overpaid', 'unknown'], default: 'unknown' },
  status: { type: String, enum: ['pending', 'confirmed', 'failed'], default: 'pending' },
  memo: { type: String },
  confirmedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
