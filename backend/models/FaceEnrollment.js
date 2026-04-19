const mongoose = require('mongoose');

const faceEnrollmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userType: { type: String, enum: ['student', 'faculty', 'cr'], required: true },
  reg: { type: String, default: null },
  name: { type: String, required: true },
  faceDescriptor: { type: [Number], required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  submittedAt: { type: Date, default: Date.now },
  processedAt: { type: Date, default: null },
  processedBy: { type: String, default: null },
  rejectionReason: { type: String, default: null }
});

module.exports = mongoose.model('FaceEnrollment', faceEnrollmentSchema);