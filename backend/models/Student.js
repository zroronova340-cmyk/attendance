const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  reg: { type: String, required: true, unique: true },
  name: { type: String },
  sectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Section' },
  detained: { type: Boolean, default: false },
  pass: { type: String },
  mail: { type: String },
  phone: { type: String },
  faceDescriptor: [Number], // For Face Recognition
  faceEnrollmentStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: null },
  pendingFaceDescriptor: [Number], // Pending face data awaiting admin approval
  pendingFaceSubmittedAt: { type: Date, default: null },
  isTwin: { type: Boolean, default: false },          // Twin flag set by admin
  twinReg: { type: String, default: null },            // Roll number of the other twin
  irisDescriptor: [Number],                            // Iris scan biometric (128-d) for twin disambiguation
  registeredIP: { type: String, default: null }, 
  lockedDeviceId: { type: String, default: null } 
});

module.exports = mongoose.model('Student', studentSchema);
