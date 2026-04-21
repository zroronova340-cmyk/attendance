const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Subject = require('../models/Subject');
const Student = require('../models/Student');
const Section = require('../models/Section');
const AuditLog = require('../models/AuditLog');
const PushSubscription = require('../models/PushSubscription');
const webpush = require('web-push');

// Session Management
router.post('/start-session', async (req, res) => {
    try {
        const { date, sectionId, subjectId, submittedBy } = req.body;
        const section = await Section.findById(sectionId);
        const sectionName = `Year ${section.year} - ${section.branchCode} - Sec ${section.name}`;
        
        const attendance = await Attendance.findOneAndUpdate(
            { date, sectionId, subjectId },
            { date, sectionId, section: sectionName, subjectId, submittedBy, records: [], finalized: false },
            { upsert: true, new: true }
        );
        res.json({ message: 'Session started!', session: attendance });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/end-session', async (req, res) => {
    try {
        const { sessionId } = req.body;
        const att = await Attendance.findByIdAndUpdate(sessionId, { finalized: true });
        if (att && att.subjectId) {
            await Subject.findByIdAndUpdate(att.subjectId, { $inc: { totalClasses: 1 } });
        }
        res.json({ message: 'Session closed and class count increased.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get active session for a section and subject
router.get('/active-session/:sectionId/:subjectId', async (req, res) => {
    try {
        const { sectionId, subjectId } = req.params;
        const activeSession = await Attendance.findOne({
            sectionId,
            subjectId,
            finalized: false
        });
        if (!activeSession) return res.json({ message: 'No active session found.', session: null });
        res.json({ message: 'Active session found!', session: activeSession });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// NEW: Get ALL active sessions for a section (for students to pick)
router.get('/active-sessions/:sectionId', async (req, res) => {
    try {
        const { sectionId } = req.params;
        const activeSessions = await Attendance.find({
            sectionId,
            finalized: false,
            subjectId: { $ne: null }
        }).populate('subjectId');
        res.json(activeSessions);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Save attendance (CR/faculty posts)
router.post('/submit', async (req, res) => {
  try {
    const { date, section, sectionId, submittedBy, records, subjectId } = req.body;
    await Attendance.findOneAndUpdate(
      { date, sectionId, subjectId: subjectId || null },
      { date, section, sectionId, submittedBy, records, finalized: false, subjectId: subjectId || null },
      { upsert: true, new: true }
    );
    res.json({ message: 'Attendance saved!' });
  } catch (err) {
    console.error('Save attendance error:', err);
    res.status(500).json({ message: 'Error saving attendance' });
  }
});

// Manual attendance entry for a specific subject and date
router.post('/manual-entry', async (req, res) => {
    try {
        const { date, sectionId, subjectId, submittedBy, records } = req.body;
        const section = await Section.findById(sectionId);
        const sectionName = `Year ${section.year} - ${section.branchCode} - Sec ${section.name}`;

        const attendance = await Attendance.findOneAndUpdate(
            { date, sectionId, subjectId },
            { date, sectionId, section: sectionName, subjectId, submittedBy, records, finalized: false },
            { upsert: true, new: true }
        );
        res.json({ message: 'Manual attendance saved!', session: attendance });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get attendance for a specific section, date, and optional subject
router.get('/get/:sectionId/:date', async (req, res) => {
  try {
    const { sectionId, date } = req.params;
    const { subjectId } = req.query;
    
    let query = { sectionId, date };
    // Only filter by subjectId when one is explicitly provided
    if (subjectId && subjectId !== 'null' && subjectId !== 'undefined' && subjectId !== '') {
        query.subjectId = subjectId;
    }
    // When no subjectId is given, find ANY attendance doc for this section/date

    const attendance = await Attendance.findOne(query);
    if (!attendance) return res.json({ records: [] });
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching attendance' });
  }
});

// Get all attendance (admin fetch)
router.get('/all', async (req, res) => {
  try {
    const all = await Attendance.find();
    res.json(all);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching attendance' });
  }
});

// Finalize attendance (mark as posted to admin)
router.put(['/finalize', '/push-to-admin'], async (req, res) => {
  try {
    const { date, sectionId, subjectId, sessionId } = req.body;
    let query = {};
    if (sessionId) query._id = sessionId;
    else query = { date, sectionId, subjectId: subjectId || null };

    const result = await Attendance.findOneAndUpdate(
      query,
      { finalized: true },
      { new: true }
    );
    if (!result) return res.status(404).json({ message: 'Attendance record not found to finalize.' });

    // Increment totalClasses for the subject
    if (result.subjectId) {
        await Subject.findByIdAndUpdate(result.subjectId, { $inc: { totalClasses: 1 } });
    }

    res.json({ message: 'Attendance finalized and class count updated!', session: result });
  } catch (err) {
    res.status(500).json({ message: 'Error finalizing attendance', error: err.message });
  }
});

// Delete attendance record

// Update specific student attendance status (admin)
router.put('/update-status', async (req, res) => {
  try {
    const { recordId, registerNumber, newStatus, performedBy } = req.body;
    const attendance = await Attendance.findById(recordId);
    if (!attendance) return res.status(404).json({ message: 'Attendance record not found.' });

    const recIndex = attendance.records.findIndex(r => r.registerNumber === registerNumber);
    const oldStatus = recIndex === -1 ? 'None' : attendance.records[recIndex].status;

    if (recIndex === -1) {
      attendance.records.push({ registerNumber, status: newStatus });
    } else {
      attendance.records[recIndex].status = newStatus;
    }

    await attendance.save();

    // Log the action
    await AuditLog.create({
        performedBy: performedBy || 'Admin',
        action: 'Attendance Status Override',
        targetId: registerNumber,
        details: `Updated ${registerNumber} in ${attendance.section} from ${oldStatus} to ${newStatus}`
    });

    res.json({ message: 'Attendance status updated & logged!' });
  } catch (err) {
    res.status(500).json({ message: 'Error updating attendance status' });
  }
});

// Update individual student's daily attendance for a specific date, section, and subject
router.put('/update-student-daily-status', async (req, res) => {
    try {
        const { date, sectionId, subjectId, registerNumber, newStatus, performedBy } = req.body;

        const section = await Section.findById(sectionId);
        if (!section) return res.status(404).json({ message: 'Section not found.' });
        const sectionName = `Year ${section.year} - ${section.branchCode} - Sec ${section.name}`;

        let attendance = await Attendance.findOne({ date, sectionId, subjectId });

        let oldStatus = 'None';
        if (attendance) {
            const recIndex = attendance.records.findIndex(r => r.registerNumber === registerNumber);
            if (recIndex !== -1) {
                oldStatus = attendance.records[recIndex].status;
                attendance.records[recIndex].status = newStatus;
            } else {
                attendance.records.push({ registerNumber, status: newStatus });
            }
            await attendance.save();
        } else {
            // If no attendance record exists for the day/section/subject, create one
            attendance = await Attendance.create({
                date,
                sectionId,
                section: sectionName,
                subjectId,
                submittedBy: performedBy || 'Admin', // Assuming admin performs this
                records: [{ registerNumber, status: newStatus }],
                finalized: false // New records are not finalized by default
            });
        }

        // Log the action
        await AuditLog.create({
            performedBy: performedBy || 'Admin',
            action: 'Daily Attendance Override',
            targetId: registerNumber,
            details: `Updated ${registerNumber} for ${date} in ${sectionName} (${subjectId}) from ${oldStatus} to ${newStatus}`
        });

        res.json({ message: 'Student daily attendance status updated & logged!', attendance });
    } catch (err) {
        console.error('Error updating student daily attendance status:', err);
        res.status(500).json({ message: 'Error updating student daily attendance status', error: err.message });
    }
});

router.delete('/delete/:id', async (req, res) => {
  try {
    await Attendance.findByIdAndDelete(req.params.id);
    res.json({ message: 'Record deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting record' });
  }
});

router.get('/report/:sectionId', async (req, res) => {
    try {
        const sectionId = req.params.sectionId;
        const students = await Student.find({ sectionId });
        const subjects = await Subject.find({ sectionId }).sort({ name: 1 });
        const allAttendance = await Attendance.find({ sectionId, finalized: true });

        const report = students.map(student => {
            const subjectStats = {};
            let totalAttended = 0;
            let totalHeld = 0;

            // Daily Attendance (subjectId is null)
            const dailyAttended = allAttendance.filter(a => 
                !a.subjectId && 
                a.records.some(r => r.registerNumber === student.reg && r.status === 'present')
            ).length;
            const dailyTotal = allAttendance.filter(a => !a.subjectId).length;
            const dailyAvg = dailyTotal > 0 ? ((dailyAttended / dailyTotal) * 100).toFixed(1) : 100;

            subjects.forEach(sub => {
                const attended = allAttendance.filter(a => 
                    a.subjectId && a.subjectId.toString() === sub._id.toString() &&
                    a.records.some(r => r.registerNumber === student.reg && r.status === 'present')
                ).length;

                subjectStats[sub._id] = attended;
                totalAttended += attended;
                totalHeld += sub.totalClasses;
            });

            const avg = totalHeld > 0 ? ((totalAttended / totalHeld) * 100).toFixed(1) : 100;

            return {
                reg: student.reg,
                name: student.name,
                subjects: subjectStats,
                total: totalAttended,
                totalHeld: totalHeld,
                avg: avg,
                daily: {
                    attended: dailyAttended,
                    total: dailyTotal,
                    avg: dailyAvg
                }
            };
        });

        res.json({ report, subjects });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// NEW: Faculty Daily Face Attendance

router.post('/faculty-daily', async (req, res) => {
    try {
        const { facultyId, name, type, lat, lng } = req.body;
        const today = new Date().toISOString().split('T')[0];

        // --- GEOFENCING CHECK ---
        const Settings = require('../models/Settings');
        const campus = await Settings.findOne({ key: 'campus-boundary' });
        
        if (campus && campus.value && campus.value.lat) {
            if (!lat || !lng) {
                return res.status(403).json({ error: 'Location access is required for verification.' });
            }

            const { lat: centerLat, lng: centerLng, radius: radiusMeters } = campus.value;
            const expandedRadius = (radiusMeters || 500) + 20; // 20m buffer

            const latOffset = expandedRadius / 111111;
            const lngOffset = expandedRadius / (111111 * Math.cos(centerLat * Math.PI / 180));

            const isInside = (
                lat <= (centerLat + latOffset) &&
                lat >= (centerLat - latOffset) &&
                lng <= (centerLng + lngOffset) &&
                lng >= (centerLng - lngOffset)
            );

            if (!isInside) {
                return res.status(403).json({ error: 'Attendance Denied: Outside Institution Perimeter.' });
            }
        }

        // Log the daily attendance
        await AuditLog.create({
            performedBy: name,
            action: 'Faculty Daily Attendance',
            targetId: facultyId,
            details: `Faculty ${name} (${facultyId}) marked daily attendance via Face ID at [${lat||'?'}, ${lng||'?'}] on ${today}`
        });

        res.json({ message: 'Daily attendance marked successfully!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// NEW: Admin Release Notification for Section

router.post('/release-section', async (req, res) => {
    try {
        const { sectionId, adminName } = req.body;
        const section = await Section.findById(sectionId);
        
        // Log the release
        await AuditLog.create({
            performedBy: adminName,
            action: 'Attendance Release',
            targetId: sectionId,
            details: `Official attendance percentages released for ${section.year} ${section.branchCode}-${section.name}`
        });

        // Find all students in this section
        const students = await Student.find({ sectionId });
        const studentIds = students.map(s => s._id);

        // Find push subscriptions
        const subs = await PushSubscription.find({ userId: { $in: studentIds } });

        const payload = JSON.stringify({
            title: 'Attendance Released!',
            body: `Official attendance for ${section.name} is now updated. Check your dashboard.`,
            icon: 'https://image2url.com/r2/default/images/1773668714074-7eaefdc5-c41e-4f3b-a408-a1285f72e3c4.png'
        });

        subs.forEach(sub => {
            webpush.sendNotification(sub.subscription, payload).catch(e => console.error('Push error:', e));
        });

        res.json({ message: 'Release notifications sent to all students in section!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;