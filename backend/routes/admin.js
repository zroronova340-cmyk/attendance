const express = require('express');
const router = express.Router();
const Branch = require('../models/Branch');
const Section = require('../models/Section');
const Student = require('../models/Student');
const User = require('../models/User');
const Settings = require('../models/Settings');
const Attendance = require('../models/Attendance');
const Subject = require('../models/Subject');

// Setup default branches (useful for initialization)
router.post('/init', async (req, res) => {
  const defaults = [
    { code: '05', name: 'CSE' },
    { code: '04', name: 'ECE' },
    { code: '02', name: 'EEE' },
    { code: '03', name: 'MECH' },
    { code: '42', name: 'CSM' },
    { code: '44', name: 'CSD' },
    { code: '46', name: 'CSC' },
    { code: '47', name: 'CSIT' }
  ];
  try {
    for (let b of defaults) {
      await Branch.findOneAndUpdate({ code: b.code }, b, { upsert: true });
    }
    res.json({ message: 'Default branches initialized' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- BRANCHES ---
router.get('/branches', async (req, res) => {
  try {
    const branches = await Branch.find();
    res.json(branches);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/branches', async (req, res) => {
  try {
    const branch = new Branch(req.body);
    await branch.save();
    res.json(branch);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/branches/:id', async (req, res) => {
  try {
    await Branch.findByIdAndDelete(req.params.id);
    res.json({ message: 'Branch deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SECTIONS ---
router.get('/sections', async (req, res) => {
  try {
    const sections = await Section.find();
    res.json(sections);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sections', async (req, res) => {
  try {
    const section = new Section(req.body);
    await section.save();
    res.json(section);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sections/:id/crs', async (req, res) => {
  try {
    const section = await Section.findByIdAndUpdate(
      req.params.id,
      { crs: req.body.crs },
      { new: true }
    );
    res.json(section);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/sections/:id', async (req, res) => {
  try {
    // Delete students associated with this section? Or just delete section.
    await Section.findByIdAndDelete(req.params.id);
    res.json({ message: 'Section deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sections/:id/settings', async (req, res) => {
  try {
    const { location, timeWindow, classInCharge } = req.body;
    const section = await Section.findByIdAndUpdate(
      req.params.id,
      { location, timeWindow, classInCharge },
      { new: true }
    );
    res.json(section);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SUBJECTS ---
router.get('/subjects', async (req, res) => {
    try {
        const query = req.query.sectionId ? { sectionId: req.query.sectionId } : {};
        const subjects = await Subject.find(query).populate('assignedFaculty');
        res.json(subjects);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/subjects', async (req, res) => {
    try {
        const subject = new Subject(req.body);
        await subject.save();
        res.json(subject);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/subjects/:id', async (req, res) => {
    try {
        await Subject.findByIdAndDelete(req.params.id);
        res.json({ message: 'Subject deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// Calculate metrics function helper
function getStudentDetails(rollNo) {
  if (!rollNo || rollNo.length < 8) return null;
  const yearStr = rollNo.substring(0, 2);
  const collegeCode = rollNo.substring(2, 4);
  const entryType = rollNo.substring(4, 6);
  const branchCode = rollNo.substring(6, 8);
  
  let admissionYear = 2000 + parseInt(yearStr);
  if (entryType === '5A') admissionYear -= 1; // Lateral
  
  const currentY = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-based
  let academicYearStartYear = currentMonth < 5 ? currentY - 1 : currentY;
  
  const yearOfStudy = academicYearStartYear - admissionYear + 1;
  return { year: yearOfStudy, branchCode };
}

router.get('/students', async (req, res) => {
  try {
    let query = {};
    if (req.query.sectionId) query.sectionId = req.query.sectionId;
    const students = await Student.find(query).populate('sectionId');
    res.json(students);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/students', async (req, res) => {
  try {
    let payloads = Array.isArray(req.body) ? req.body : [req.body];
    let inserted = [];
    
    for (let item of payloads) {
      if (!item.reg) continue;
      const reg = item.reg.toUpperCase();
      const details = getStudentDetails(reg);
      if (!details) continue; // skip invalid

      const { year, branchCode } = details;
      const sectionName = item.sectionName.toUpperCase();

      let sectionDoc = await Section.findOne({ year, branchCode, name: sectionName });
      if (!sectionDoc) {
        sectionDoc = new Section({ year, branchCode, name: sectionName, crs: [] });
        await sectionDoc.save();
      }

      const payload = {
        reg,
        name: item.name || '',
        sectionId: sectionDoc._id,
        detained: item.detained || false
      };

      // Set default credentials if they don't exist
      const existingStudent = await Student.findOne({ reg });
      if (!existingStudent || !existingStudent.pass) {
        payload.pass = reg; // Default password is the register number
        payload.mail = `${reg.toLowerCase()}@lendi.edu.in`;
      }

      const student = await Student.findOneAndUpdate({ reg }, payload, { new: true, upsert: true });
      inserted.push(student);
    }
    res.json({ message: 'Students processed successfully', count: inserted.length, students: inserted });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/students/:id', async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: 'Student deleted successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/students/:id/reset-face', async (req, res) => {
  try {
    await Student.findByIdAndUpdate(req.params.id, { faceDescriptor: [] });
    res.json({ message: 'Face biometric reset' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/parse-roll/:reg', (req, res) => {
  const result = getStudentDetails(req.params.reg.toUpperCase());
  if (!result) return res.status(400).json({ error: 'Invalid roll number format' });
  res.json(result);
});

// --- USERS ---
router.get('/users', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pending-users', async (req, res) => {
  try {
    const pending = await User.find({ isApproved: false });
    res.json(pending);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/approve-user/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isApproved: true });
    
    // Audit Log
    await AuditLog.create({
        performedBy: 'Admin',
        action: 'Faculty Approval',
        targetId: user.facultyId || user.reg,
        details: `Approved faculty account for ${user.name}`
    });

    res.json({ message: 'User approved successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id/reset-face', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { faceDescriptor: [] });
    res.json({ message: 'Face data reset' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/reset-device-lock/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        let model = (type === 'student') ? Student : User;
        await model.findByIdAndUpdate(id, { registeredIP: null, lockedDeviceId: null });
        
        // Audit log
        await AuditLog.create({
            performedBy: 'Admin',
            action: 'Device-IP Unlock',
            targetId: id,
            details: `Admin reset device/IP lock for account role [${type}]. Next login will capture new IP.`
        });

        res.json({ message: 'Device IP lock has been cleared.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SETTINGS ---
router.get('/settings/registration', async (req, res) => {
  try {
    let setting = await Settings.findOne({ key: 'registrationEnabled' });
    if (!setting) {
      setting = new Settings({ key: 'registrationEnabled', value: true });
      await setting.save();
    }
    res.json({ registrationEnabled: setting.value });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/settings/registration', async (req, res) => {
  try {
    const { enabled } = req.body;
    const setting = await Settings.findOneAndUpdate(
      { key: 'registrationEnabled' },
      { value: enabled },
      { upsert: true, new: true }
    );
    res.json({ registrationEnabled: setting.value });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/settings/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;
        const setting = await Settings.findOneAndUpdate(
            { key },
            { value },
            { upsert: true, new: true }
        );
        res.json(setting);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const AuditLog = require('../models/AuditLog');

router.get('/audit-logs', async (req, res) => {
    try {
        const logs = await AuditLog.find().sort({ timestamp: -1 }).limit(50);
        res.json(logs);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI Attendance Forecasting
router.get('/forecasting', async (req, res) => {
    try {
        const students = await Student.find();
        const attendance = await Attendance.find();
        
        const forecasts = students.map(s => {
            let totalClasses = 0;
            let presents = 0;
            
            attendance.forEach(record => {
                const studentMatch = record.records.find(r => r.registerNumber === s.reg);
                if (studentMatch) {
                    totalClasses++;
                    if (studentMatch.status === 'present') presents++;
                }
            });

            // AI Logic: Forecast detention risk based on last 5 classes trend
            const currentRate = totalClasses > 0 ? (presents / totalClasses) * 100 : 100;
            const status = currentRate < 75 ? 'Critical' : (currentRate < 80 ? 'Warning' : 'Good');
            
            return {
                reg: s.reg,
                name: s.name,
                rate: currentRate.toFixed(1),
                status,
                totalClasses,
                presents
            };
        });

        res.json(forecasts.sort((a,b) => a.rate - b.rate));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
