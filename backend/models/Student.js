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
  registeredIP: { type: String, default: null }, 
  lockedDeviceId: { type: String, default: null } 
});

module.exports = mongoose.model('Student', studentSchema);
