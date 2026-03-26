'use strict';

const mongoose = require('mongoose');
const softDelete = require('../utils/softDelete');

const paymentSchema = new mongoose.Schema(
  {
    studentId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    schoolId:             { type: String, required: true, index: true },
    studentIdStr:         { type: String, required: true, index: true },

    txHash:               { type: String, required: true, unique: true, index: true },
    amount:               { type: Number, required: true },

    feeAmount:            { type: Number, default: null },
    baseFee:              { type: Number, required: true },
    finalFee:             { type: Number, required: true },

    adjustmentsApplied: [{
      ruleName:           { type: String, required: true },
      type:               { type: String, enum: ['discount_percentage', 'discount_fixed', 'penalty_percentage', 'penalty_fixed', 'waiver'] },
      value:              { type: Number, required: true },
      amountAdjusted:     { type: Number, required: true },
      finalFeeAfterRule:  { type: Number }
    }],

    feeValidationStatus:  { type: String, enum: ['valid', 'underpaid', 'overpaid', 'unknown'], default: 'unknown' },
    excessAmount:         { type: Number, default: 0 },

    status:               { type: String, enum: ['PENDING', 'SUBMITTED', 'SUCCESS', 'FAILED'], default: 'PENDING' },
    memo:                 { type: String },
    senderAddress:        { type: String, default: null },
    isSuspicious:         { type: Boolean, default: false },
    suspicionReason:      { type: String, default: null },

    ledger:               { type: Number, default: null },
    ledgerSequence:       { type: Number, default: null },
    confirmationStatus:   { type: String, enum: ['pending_confirmation', 'confirmed'], default: 'pending_confirmation' },

    // Audit trail
    transactionHash:      { type: String, default: null, index: true },
    startedAt:            { type: Date, default: null },
    submittedAt:          { type: Date, default: null },
    confirmedAt:          { type: Date, default: null, index: true },
    verifiedAt:           { type: Date, default: null },

    // Payment locking
    lockedUntil:          { type: Date, default: null },
    lockHolder:           { type: String, default: null },

    // Soft Delete (Issue #77)
    deletedAt:            { type: Date, default: null, index: true }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Apply soft delete utility
softDelete(paymentSchema);

// Indexes
paymentSchema.index({ schoolId: 1, studentId: 1 });
paymentSchema.index({ schoolId: 1, confirmedAt: -1 });
paymentSchema.index({ schoolId: 1, feeValidationStatus: 1 });
paymentSchema.index({ schoolId: 1, isSuspicious: 1 });
paymentSchema.index({ schoolId: 1, confirmationStatus: 1 });
paymentSchema.index({ studentIdStr: 1, createdAt: -1 });
paymentSchema.index({ txHash: 1 });

paymentSchema.virtual('explorerUrl').get(function() {
  if (!this.transactionHash) return null;
  return `https://stellar.expert/explorer/testnet/tx/${this.transactionHash}`;
});

paymentSchema.pre('save', async function(next) {
  if (!this.isNew && this.isModified()) {
    try {
      const original = await mongoose.model('Payment').findById(this._id).lean();
      if (original && (original.status === 'SUCCESS' || original.status === 'FAILED')) {
        throw new Error('Payment audit trail is immutable once in SUCCESS or FAILED state');
      }
    } catch (err) {
      return next(err);
    }
  }
  next();
});

module.exports = mongoose.model('Payment', paymentSchema);