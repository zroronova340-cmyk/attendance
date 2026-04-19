const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  type: { type: String, enum: ['cr', 'faculty', 'admin', 'student'], required: true },
  reg: String,
  facultyId: String,
  adminId: String,
  name: String,
  mail: { type: String, required: true },
  phone: String,
  pass: { type: String, required: true },
  section: String,
  faceDescriptor: [Number], // For Face Recognition
  faceEnrollmentStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: null },
  pendingFaceDescriptor: [Number], // Pending face data awaiting admin approval
  pendingFaceSubmittedAt: { type: Date, default: null },
  isApproved: { type: Boolean, default: true },
  registeredIP: { type: String, default: null },
  lockedDeviceId: { type: String, default: null }
});

module.exports = mongoose.model('User', userSchema);