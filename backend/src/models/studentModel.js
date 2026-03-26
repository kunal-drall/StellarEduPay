'use strict';

const mongoose = require('mongoose');
const softDelete = require('../utils/softDelete');

const studentSchema = new mongoose.Schema(
  {
    schoolId:          { type: String, required: true, index: true },
    studentId:         { type: String, required: true, index: true, unique: true },
    name:              { type: String, required: true },
    class:             { type: String, required: true },           // or className
    academicYear:      { type: String, required: true },
    feeAmount:         { type: Number, required: true },
    totalPaid:         { type: Number, default: 0 },
    remainingBalance:  { type: Number, default: 0 },
    feePaid:           { type: Boolean, default: false },

    // Audit fields
    dateOfBirth:       { type: Date },
    gender:            { type: String },
    parentName:        { type: String },
    contactNumber:     { type: String },

    // Soft Delete (Issue #77)
    deletedAt:         { type: Date, default: null, index: true }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Apply soft delete utility
softDelete(studentSchema);

// Indexes
studentSchema.index({ schoolId: 1, studentId: 1 });
studentSchema.index({ schoolId: 1, class: 1 });
studentSchema.index({ schoolId: 1, feePaid: 1 });

module.exports = mongoose.model('Student', studentSchema);