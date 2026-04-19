const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/User');
const Section = require('../models/Section');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const Subject = require('../models/Subject');
const Settings = require('../models/Settings');
const PushSubscription = require('../models/PushSubscription');
const Session = require('../models/Session');
const { sendSMS, sendWhatsApp, sendEmail, sendPush } = require('../utils/notificationHelper');

// Subscribe to Push Notifications
router.post('/subscribe', async (req, res) => {
    try {
        const { userId, subscription } = req.body;
        await PushSubscription.findOneAndUpdate(
            { userId },
            { userId, subscription },
            { upsert: true, new: true }
        );
        res.status(201).json({ message: 'Subscribed successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Check Registration Status
router.get('/registration-status', async (req, res) => {
  try {
    let setting = await Settings.findOne({ key: 'registrationEnabled' });
    if (!setting) {
      setting = new Settings({ key: 'registrationEnabled', value: true });
      await setting.save();
    }
    res.json({ registrationEnabled: setting.value });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get User Profile
router.get('/profile/:id', async (req, res) => {
  try {
    const { type } = req.query;
    let user;
    if (type === 'student' || type === 'cr') {
      user = await Student.findById(req.params.id).select('-pendingFaceDescriptor');
    } else {
      user = await User.findById(req.params.id).select('-pendingFaceDescriptor');
    }
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Register
router.post('/register', async (req, res) => {
  try {
    let { type, reg, facultyId, adminId, name, mail, phone, pass, faceDescriptor, creatorId } = req.body;
    
    // Check global registration status
    const regSetting = await Settings.findOne({ key: 'registrationEnabled' });
    if (regSetting && regSetting.value === false) {
      return res.status(403).json({ message: 'Registration is currently disabled by administrator.' });
    }

    // Normalize IDs to Uppercase
    if (reg) reg = reg.toUpperCase();
    if (facultyId) facultyId = facultyId.toUpperCase();
    if (adminId) adminId = adminId.toUpperCase();

    // Block student/cr registration permanently
    if (type === 'student' || type === 'cr') {
      return res.status(403).json({ 
        message: 'Direct registration is disabled for students and CRs. Please contact your Administrator.' 
      });
    }

    // Restrict Admin creation to existing Admins only
    if (type === 'admin') {
      if (!creatorId) {
        return res.status(403).json({ message: 'Only an existing administrator can create another admin account.' });
      }
      const creator = await User.findById(creatorId);
      if (!creator || creator.type !== 'admin') {
        return res.status(403).json({ message: 'Unauthorized: Admin creation restricted.' });
      }
    }

    // Auto-generate institutional email if not provided
    if (!mail) {
      const id = reg || facultyId || adminId;
      if (id) {
        mail = `${id.toLowerCase()}@lendi.edu.in`;
      } else {
        return res.status(400).json({ message: 'Register/ID number is required to generate email.' });
      }
    }

    let exists;
    if (type === 'faculty') exists = await User.findOne({ facultyId, type });
    else if (type === 'admin') exists = await User.findOne({ adminId, type });
    else exists = await User.findOne({ reg, type });
    
    if (exists) return res.status(400).json({ message: 'User already exists' });

    // Faculty Approval Logic
    const isApproved = (type === 'faculty') ? false : true;

    // SECURITY: Ensure Face Uniqueness during initial registration
    if (faceDescriptor && faceDescriptor.length === 128) {
      const [allUsers, allStudents] = await Promise.all([
        User.find({ faceDescriptor: { $exists: true, $ne: [] } }),
        Student.find({ faceDescriptor: { $exists: true, $ne: [] } })
      ]);

      for (let u of [...allUsers, ...allStudents]) {
        if (u.faceDescriptor && u.faceDescriptor.length === 128) {
          const dist = calculateEuclideanDistance(faceDescriptor, u.faceDescriptor);
          if (dist < 0.5) { // Match found (duplicates found)
            return res.status(409).json({ message: 'Security Alert: This face is already enrolled by another user profile.' });
          }
        }
      }
    }

    const user = new User({ 
      type, reg, facultyId, adminId, name, mail, phone, pass, 
      section: req.body.section, faceDescriptor, 
      isApproved 
    });
    
    await user.save();
    
    if (type === 'faculty') {
      const msg = `Lendi Portal Alert: New Faculty registered (${name}, ${facultyId}). Please approve in Admin Dashboard.`;
      sendSMS(process.env.ADMIN_PHONE || 'REPLACE_WITH_ADMIN_MOBILE', msg); 
      // Free Fallback: Email the admin
      sendEmail(process.env.EMAIL_USER, "New Faculty Registration Pending", msg);
      res.json({ message: 'Registration request sent! Your account is pending administrator approval.' });
    } else {
      res.json({ message: 'Registration successful!' });
    }
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Registration failed: ' + err.message });
  }
});

// Change Password
router.post('/change-password', async (req, res) => {
  try {
    const { userId, type, oldPass, newPass } = req.body;
    let user;

    if (type === 'student' || type === 'cr') {
      user = await Student.findById(userId);
    } else {
      user = await User.findById(userId);
    }

    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.pass !== oldPass) {
      return res.status(400).json({ message: 'Incorrect old password' });
    }

    user.pass = newPass;
    await user.save();
    res.json({ message: 'Password updated successfully!' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to change password' });
  }
});

// Login with PERMANENT Device Locking
router.post('/login', async (req, res) => {
  try {
    let { type, reg, facultyId, adminId, pass, deviceId, deviceInfo } = req.body;
    
    // Normalize IDs
    if (reg) reg = reg.toUpperCase();
    if (facultyId) facultyId = facultyId.toUpperCase();
    if (adminId) adminId = adminId.toUpperCase();

    let user;
    if (type === 'cr' || type === 'student') {
      user = await Student.findOne({ reg }).populate('sectionId');
      if (user && type === 'cr') {
        const sectionDoc = await Section.findOne({ crs: reg });
        if (!sectionDoc) {
          return res.status(403).json({ message: 'You are not authorized as a CR.' });
        }
      }
    } else if (type === 'faculty') {
      user = await User.findOne({ facultyId, type });
    } else {
      user = await User.findOne({ adminId, type });
    }
    
    if (!user) return res.status(400).json({ message: 'No such user found!' });
    if (user.pass !== pass) return res.status(400).json({ message: 'Incorrect password!' });
    
    const currentIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // ═══════════════════════════════════════════════════════════
    //  PERMANENT DEVICE LOCKING (All users except admin)
    //  Once a device is recorded, it CANNOT be changed unless
    //  an admin resets the device lock from the admin panel.
    // ═══════════════════════════════════════════════════════════
    if (type !== 'admin' && deviceId) {
      
      // STEP 1: Check if this account is already locked to a device
      if (user.lockedDeviceId && user.lockedDeviceId !== deviceId) {
        // BLOCKED: This account is permanently locked to a different device
        console.log(`[DEVICE-LOCK] BLOCKED login for ${user.reg || user.facultyId} - Expected device: ${user.lockedDeviceId}, Got: ${deviceId}`);
        return res.status(403).json({ 
          message: 'Access Denied: Your account is locked to another device. Please contact the Administrator to reset your device lock.',
          deviceLocked: true
        });
      }
      
      // STEP 2: If no device is locked yet, lock this device permanently
      if (!user.lockedDeviceId) {
        user.lockedDeviceId = deviceId;
        console.log(`[DEVICE-LOCK] First login - Locking ${user.reg || user.facultyId} to device: ${deviceId}`);
      }
      
      // STEP 3: Session management (secondary layer)
      const existingSession = await Session.getActiveSession(user._id, type);
      if (existingSession) {
        // Deactivate old session (same device re-login)
        await Session.logout(existingSession.token);
      }
      
      // Create new session
      const session = await Session.createSession(
        user._id, 
        type, 
        deviceId, 
        deviceInfo || {}, 
        currentIP
      );
      
      var sessionToken = session.token;
    }
    
    // Always track IP
    user.registeredIP = currentIP;
    await user.save();

    // Build response
    const userData = user.toObject();
    userData.type = type;
    if (type === 'student' || type === 'cr') {
        userData.section = user.sectionId ? user.sectionId._id.toString() : null;
    }

    const response = { 
      message: 'Login successful!', 
      user: userData, 
      clientIP: currentIP 
    };
    
    if (sessionToken) {
      response.sessionToken = sessionToken;
    }

    res.json(response);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed: ' + err.message });
  }
});

// Logout - invalidate session
router.post('/logout', async (req, res) => {
  try {
    const { sessionToken } = req.body;
    if (sessionToken) {
      await Session.logout(sessionToken);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check session status
router.get('/session-status', async (req, res) => {
  try {
    const { userId, userType, deviceId } = req.query;
    const session = await Session.getActiveSession(userId, userType);
    
    if (!session) {
      return res.json({ active: false });
    }
    
    res.json({ 
      active: true, 
      sameDevice: session.deviceId === deviceId,
      deviceId: session.deviceId,
      lastActive: session.lastActive
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Profile
router.put('/update-profile', async (req, res) => {
  try {
    const { userId, type, name, phone } = req.body;
    let user;

    if (type === 'student' || type === 'cr') {
      user = await Student.findByIdAndUpdate(userId, { name, phone }, { new: true });
    } else {
      user = await User.findByIdAndUpdate(userId, { name, phone }, { new: true });
    }

    if (!user) return res.status(404).json({ message: 'User not found' });

    const userData = user.toObject();
    userData.type = type;
    res.json({ message: 'Profile updated successfully!', user: userData });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Enroll Face Data (Pending Admin Approval)
router.post('/enroll-face', async (req, res) => {
  try {
    const { userId, type, descriptor } = req.body;
    if (!descriptor || descriptor.length !== 128) {
      return res.status(400).json({ message: 'Invalid face data.' });
    }

    let user;
    if (type === 'student' || type === 'cr') {
      user = await Student.findById(userId);
    } else {
      user = await User.findById(userId);
    }

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Check uniqueness against approved faces
    const [allUsers, allStudents] = await Promise.all([
      User.find({ faceDescriptor: { $exists: true, $ne: [] } }),
      Student.find({ faceDescriptor: { $exists: true, $ne: [] } })
    ]);

    for (let u of [...allUsers, ...allStudents]) {
      if (u._id.toString() !== userId && u.faceDescriptor && u.faceDescriptor.length === 128) {
        const dist = calculateEuclideanDistance(descriptor, u.faceDescriptor);
        if (dist < 0.5) {
          const isTwinPair =
            user.isTwin &&
            user.twinReg &&
            (u.reg === user.twinReg || u.twinReg === user.reg);

          if (!isTwinPair) {
            return res.status(409).json({ message: 'Security Alert: This biometric profile is already assigned to another account.' });
          }
        }
      }
    }

    // Save as pending (admin approval required)
    user.pendingFaceDescriptor = descriptor;
    user.faceEnrollmentStatus = 'pending';
    user.pendingFaceSubmittedAt = new Date();
    await user.save();

    // Notify admin about pending face enrollment
    const userLabel = user.reg || user.facultyId || user.adminId || user.name;
    const adminMsg = `Smart Attendance: New face enrollment request from ${userLabel} (${type}). Please verify in Admin Dashboard.`;
    const admins = await User.find({ type: 'admin' });
    for (const admin of admins) {
      if (admin.phone) sendSMS(admin.phone, adminMsg);
      if (admin.mail) sendEmail(admin.mail, 'Face Enrollment Request', adminMsg);
    }

    const userData = user.toObject();
    userData.type = type;
    res.json({ message: 'Face enrollment submitted! Pending admin approval.', user: userData, status: 'pending' });
  } catch (err) {
    console.error('Enroll Error:', err);
    res.status(500).json({ message: 'Face enrollment failed' });
  }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  try {
    const { reg, facultyId, adminId, type } = req.body;
    let user;
    if (type === 'student' || type === 'cr') {
      user = await Student.findOne({ reg });
    } else if (type === 'faculty') {
      user = await User.findOne({ facultyId, type });
    } else {
      user = await User.findOne({ adminId, type });
    }

    if (!user) return res.status(404).json({ message: 'No such user found.' });
    if (!user.phone) return res.status(400).json({ message: 'No registered phone number found for this account.' });

    const msg = `Smart Attendance Hub: Your passkey for account (${user.reg || user.facultyId || user.adminId}) is: ${user.pass}`;
    
    // Try SMS first, then Email (Free)
    const smsResult = await sendSMS(user.phone, msg);
    const emailResult = await sendEmail(user.mail, "Password Recovery - Smart Attendance", msg);
    
    // Try Web Push (Free)
    const pushSub = await PushSubscription.findOne({ userId: user._id });
    if (pushSub) {
        await sendPush(pushSub.subscription, "Account Support", "Your passkey has been sent to your email.");
    }
    
    if (smsResult.success || emailResult.success) {
        res.json({ message: `Credentials have been sent to your registered contact points (Email/Mobile).` });
    } else {
        res.status(500).json({ message: 'Error sending credentials. Admin notification logged.' });
    }
  } catch (err) {
    res.status(500).json({ message: 'Failed to process request.' });
  }
});

// Self-Attendance via Face
router.post('/mark-attendance-face', async (req, res) => {
  try {
    const { userId, type, descriptor, latitude, longitude, currentTime, subjectId } = req.body;
    let user;
    
    if (type === 'student' || type === 'cr') {
      user = await Student.findById(userId).populate('sectionId');
    } else {
      user = await User.findById(userId);
    }

    if (!user || !user.faceDescriptor || user.faceDescriptor.length === 0) {
      return res.status(400).json({ message: 'Face data not enrolled!' });
    }

    // Check if face enrollment is approved
    if (user.faceEnrollmentStatus !== 'approved') {
      return res.status(403).json({ message: 'Face enrollment pending admin approval.' });
    }

    // Verify face
    const dist = calculateEuclideanDistance(descriptor, user.faceDescriptor);
    if (dist > 0.5) {
      return res.status(401).json({ message: 'Face mismatch! Recognition failed.' });
    }

    // Face verified, now mark attendance
    const now = currentTime ? new Date(currentTime) : new Date();
    const today = now.toISOString().split('T')[0];
    
    // Support both populated and unpopulated section IDs with a safety check
    let sId = null;
    if (type === 'student' || type === 'cr') {
        sId = user.sectionId ? (user.sectionId._id || user.sectionId) : null;
    } else {
        sId = user.section;
    }

    const regNum = user.reg || user.registerNumber || user.facultyId || user.adminId;

    if (!sId || !regNum) {
      return res.status(400).json({ message: 'Authorization error: Profile incomplete (Missing ID/Section).' });
    }

    const sectionDoc = await Section.findById(sId);
    if (!sectionDoc) return res.status(404).json({ message: 'Assigned section was not found.' });

    // --- GEOTAGGING CHECK ---
    if (sectionDoc.location && sectionDoc.location.lat && sectionDoc.location.lng) {
      if (!latitude || !longitude) {
        return res.status(403).json({ message: 'Secure boundary check requires location access.' });
      }

      const centerLat = sectionDoc.location.lat;
      const centerLng = sectionDoc.location.lng;
      const radiusMeters = (sectionDoc.location.radius || 200) + 15; 

      const latOffset = radiusMeters / 111111;
      const lngOffset = radiusMeters / (111111 * Math.cos(centerLat * Math.PI / 180));

      const isInside = (
        latitude <= (centerLat + latOffset) &&
        latitude >= (centerLat - latOffset) &&
        longitude <= (centerLng + lngOffset) &&
        longitude >= (centerLng - lngOffset)
      );

      if (!isInside) {
          return res.status(403).json({ message: `Access Denied: Outside secure boundary.` });
      }
    }

    // Time Window Check (Enforced in IST to prevent UTC drift)
    if (sectionDoc.timeWindow && sectionDoc.timeWindow.start && sectionDoc.timeWindow.end) {
      const { start, end } = sectionDoc.timeWindow;
      const currentStr = now.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Kolkata' }).substring(0, 5); // 24h format
      
      let isWithinWindow = (start <= end) 
        ? (currentStr >= start && currentStr <= end)
        : (currentStr >= start || currentStr <= end);

      if (!isWithinWindow) {
        return res.status(403).json({ message: `Access Denied: Current session window is ${start} to ${end}.` });
      }
    }

    const sectionName = `Year ${sectionDoc.year} - ${sectionDoc.branchCode} - Sec ${sectionDoc.name}`;
    const query = { date: today, sectionId: sId };
    if (subjectId) {
      if (!mongoose.Types.ObjectId.isValid(subjectId)) {
        return res.status(400).json({ message: 'Invalid Subject Selection Error.' });
      }
      query.subjectId = subjectId;
    }
    
    let attendance = await Attendance.findOne(query);
    if (!attendance) {
      attendance = new Attendance({
        date: today,
        sectionId: sId,
        section: sectionName,
        subjectId: subjectId || null,
        submittedBy: 'Face-Recognition-System',
        records: []
      });
    }

    const recordIndex = attendance.records.findIndex(r => r.registerNumber === regNum);
    if (recordIndex > -1) {
      attendance.records[recordIndex].status = 'present';
      attendance.records[recordIndex].lat = latitude;
      attendance.records[recordIndex].lng = longitude;
    } else {
      attendance.records.push({ registerNumber: regNum, status: 'present', lat: latitude, lng: longitude });
    }

    await attendance.save();

    // Twin Face Duplication: Mark attendance for twin sibling if applicable
    if (user.isTwin && user.twinReg) {
      const twinRecordIndex = attendance.records.findIndex(r => r.registerNumber === user.twinReg);
      if (twinRecordIndex === -1) {
        attendance.records.push({ registerNumber: user.twinReg, status: 'present', lat: latitude, lng: longitude, viaTwin: regNum });
        await attendance.save();
        res.json({ message: 'Self-Attendance marked for both! (Twin duplication applied)' });
        return;
      }
    }

    res.json({ message: 'Self-Attendance marked successfully!' });

  } catch (err) {
    console.error('Face Attendance Error:', err);
    res.status(500).json({ message: 'Failed: ' + err.message });
  }
});


// Face Login Search
router.post('/face-login', async (req, res) => {
  try {
    const { descriptor } = req.body;
    if (!descriptor || descriptor.length !== 128) {
      return res.status(400).json({ message: 'Invalid face descriptor.' });
    }

    // Search both collections (only approved faces)
    const [users, students] = await Promise.all([
      User.find({ faceDescriptor: { $exists: true, $ne: [] }, faceEnrollmentStatus: 'approved' }),
      Student.find({ faceDescriptor: { $exists: true, $ne: [] }, faceEnrollmentStatus: 'approved' }).populate('sectionId')
    ]);

    let bestMatch = null;
    let minDistance = 0.5;

    // Check regular users
    for (let u of users) {
      if (u.faceDescriptor && u.faceDescriptor.length === 128) {
        const dist = calculateEuclideanDistance(descriptor, u.faceDescriptor);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = u.toObject();
        }
      }
    }

    // Check students
    for (let s of students) {
      if (s.faceDescriptor && s.faceDescriptor.length === 128) {
        const dist = calculateEuclideanDistance(descriptor, s.faceDescriptor);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = s.toObject();
          bestMatch.type = 'student'; // Default to student
          bestMatch.section = s.sectionId ? s.sectionId._id.toString() : null;
        }
      }
    }

    if (!bestMatch) {
      return res.status(401).json({ message: 'Face not recognized or not approved.' });
    }

    // ── TWIN AMBIGUITY CHECK ──
    // If the best match is a twin, check if their twin sibling is ALSO a close match.
    // If so, the system cannot disambiguate by face alone → require iris scan.
    if (bestMatch.isTwin && bestMatch.twinReg) {
      const twinUser = await Student.findOne({ reg: bestMatch.twinReg });
      if (twinUser && twinUser.faceDescriptor && twinUser.faceDescriptor.length === 128) {
        const twinDist = calculateEuclideanDistance(descriptor, twinUser.faceDescriptor);
        if (twinDist < 0.55) {
          // Both twins are plausible matches — cannot identify by face alone
          return res.status(428).json({
            message: 'Twin Detected: Face scan is ambiguous. Please complete Iris Scan for identification.',
            requiresIris: true,
            candidates: [
              { reg: bestMatch.reg, name: bestMatch.name, _id: bestMatch._id },
              { reg: twinUser.reg, name: twinUser.name, _id: twinUser._id }
            ]
          });
        }
      }
    }

    res.json({ message: 'Face recognized!', user: bestMatch });
  } catch (err) {
    console.error('Face Login Error:', err);
    res.status(500).json({ message: 'Face login failed' });
  }
});

// ══════════════════════════════════════════════════════════════
//  TWIN IRIS MANAGEMENT
// ══════════════════════════════════════════════════════════════

// Enroll Iris for Twin
router.post('/enroll-iris', async (req, res) => {
  try {
    const { userId, descriptor } = req.body;
    if (!descriptor || descriptor.length !== 128) {
      return res.status(400).json({ message: 'Invalid iris descriptor (must be 128-dimensional).' });
    }

    const student = await Student.findById(userId);
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    if (!student.isTwin) return res.status(403).json({ message: 'Iris enrollment is only available for students marked as twins.' });

    student.irisDescriptor = descriptor;
    await student.save();

    res.json({ message: 'Iris biometric enrolled successfully!' });
  } catch (err) {
    res.status(500).json({ message: 'Iris enrollment failed: ' + err.message });
  }
});

// Iris Identification — resolve which twin is scanning
router.post('/iris-identify', async (req, res) => {
  try {
    const { descriptor, candidateIds } = req.body;

    if (!descriptor || descriptor.length !== 128) {
      return res.status(400).json({ message: 'Invalid iris descriptor.' });
    }
    if (!candidateIds || candidateIds.length < 2) {
      return res.status(400).json({ message: 'Candidate IDs required for iris identification.' });
    }

    let bestMatch = null;
    let minDist = 0.55; // threshold for iris

    for (const candidateId of candidateIds) {
      const student = await Student.findById(candidateId).populate('sectionId');
      if (student && student.irisDescriptor && student.irisDescriptor.length === 128) {
        const dist = calculateEuclideanDistance(descriptor, student.irisDescriptor);
        if (dist < minDist) {
          minDist = dist;
          bestMatch = student;
        }
      }
    }

    if (!bestMatch) {
      return res.status(401).json({ message: 'Iris scan did not match any registered twin. Please contact Admin.' });
    }

    const userData = bestMatch.toObject();
    userData.type = 'student';
    userData.section = bestMatch.sectionId ? bestMatch.sectionId._id.toString() : null;

    res.json({ message: `Iris identification successful! Welcome, ${bestMatch.name}`, user: userData });
  } catch (err) {
    res.status(500).json({ message: 'Iris identification failed: ' + err.message });
  }
});

// Mark Attendance via Iris (after twin disambiguation)
router.post('/mark-attendance-iris', async (req, res) => {
  try {
    const { userId, irisDescriptor, latitude, longitude, currentTime, subjectId } = req.body;

    const student = await Student.findById(userId).populate('sectionId');
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    if (!student.isTwin) return res.status(403).json({ message: 'Iris attendance only available for twin students.' });

    if (!student.irisDescriptor || student.irisDescriptor.length === 0) {
      return res.status(400).json({ message: 'Iris data not enrolled for this student.' });
    }

    const dist = calculateEuclideanDistance(irisDescriptor, student.irisDescriptor);
    if (dist > 0.5) {
      return res.status(401).json({ message: 'Iris mismatch! Identification failed.' });
    }

    // Use same attendance marking logic
    const now = currentTime ? new Date(currentTime) : new Date();
    const today = now.toISOString().split('T')[0];
    const sId = student.sectionId ? (student.sectionId._id || student.sectionId) : null;

    if (!sId) return res.status(400).json({ message: 'Section not assigned.' });

    const sectionDoc = await Section.findById(sId);
    if (!sectionDoc) return res.status(404).json({ message: 'Section not found.' });

    const sectionName = `Year ${sectionDoc.year} - ${sectionDoc.branchCode} - Sec ${sectionDoc.name}`;
    const query = { date: today, sectionId: sId };
    if (subjectId) query.subjectId = subjectId;

    let attendance = await Attendance.findOne(query);
    if (!attendance) {
      attendance = new Attendance({
        date: today, sectionId: sId, section: sectionName,
        subjectId: subjectId || null,
        submittedBy: 'Iris-Recognition-System', records: []
      });
    }

    const idx = attendance.records.findIndex(r => r.registerNumber === student.reg);
    if (idx > -1) {
      attendance.records[idx].status = 'present';
    } else {
      attendance.records.push({ registerNumber: student.reg, status: 'present', lat: latitude, lng: longitude });
    }
    await attendance.save();

    res.json({ message: `Iris attendance marked for ${student.name}!` });
  } catch (err) {
    res.status(500).json({ message: 'Iris attendance failed: ' + err.message });
  }
});

function calculateEuclideanDistance(arr1, arr2) {
  return Math.sqrt(arr1.reduce((sum, val, i) => sum + Math.pow(val - (arr2[i] || 0), 2), 0));
}

module.exports = router;