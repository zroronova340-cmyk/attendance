const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'userType' },
  userType: { type: String, enum: ['student', 'faculty', 'cr', 'admin'], required: true },
  deviceId: { type: String, required: true },
  deviceInfo: { 
    browser: String,
    os: String,
    platform: String
  },
  ipAddress: String,
  token: String,
  loginAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  expiresAt: { type: Date } // Optional expiry
}, { timestamps: true });

// Index for fast lookups
sessionSchema.index({ userId: 1, userType: 1, isActive: 1 });
sessionSchema.index({ token: 1 });
sessionSchema.index({ deviceId: 1 });

// Static method to create new session
sessionSchema.statics.createSession = async function(userId, userType, deviceId, deviceInfo, ipAddress) {
  // Deactivate any existing sessions for this user
  await this.updateMany(
    { userId, userType, isActive: true },
    { isActive: false, lastActive: new Date() }
  );
  
  // Generate token
  const token = `SES_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  
  const session = await this.create({
    userId, userType, deviceId, deviceInfo, ipAddress, token,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  });
  
  return session;
};

// Static method to validate token
sessionSchema.statics.validateSession = async function(token, deviceId) {
  const session = await this.findOne({ token, isActive: true });
  if (!session) return null;
  
  // Check device matches
  if (session.deviceId !== deviceId) {
    return { error: 'Device changed. Please login again.' };
  }
  
  // Update last active
  session.lastActive = new Date();
  await session.save();
  
  return session;
};

// Static method to logout
sessionSchema.statics.logout = async function(token) {
  const session = await this.findOneAndUpdate(
    { token },
    { isActive: false },
    { new: true }
  );
  return session;
};

// Static method to get active sessions
sessionSchema.statics.getActiveSession = async function(userId, userType) {
  return this.findOne({ userId, userType, isActive: true });
};

module.exports = mongoose.model('Session', sessionSchema);