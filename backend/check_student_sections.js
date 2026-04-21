const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env in the current directory
dotenv.config({ path: path.join(__dirname, '.env') });

const Student = require('./models/Student');
const Section = require('./models/Section');

async function checkAndFixSections() {
    try {
        console.log('Connecting to MongoDB...');
        // Use the URI from .env or fallback to local
        const mongoUri = process.env.DB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart-attendance';
        await mongoose.connect(mongoUri);
        console.log('Connected to:', mongoUri.split('@').pop().split('?')[0]); // Log destination securely

        const students = await Student.find({ $or: [{ sectionId: null }, { sectionId: { $exists: false } }] });
        console.log(`Found ${students.length} students without sectionId.`);

        if (students.length > 0) {
            console.log('\nList of students missing sectionId:');
            students.forEach(s => {
                console.log(`- Reg: ${s.reg}, Name: ${s.name || 'N/A'}`);
            });

            console.log('\nTIP: To fix this, you can:');
            console.log('1. Go to Admin Panel -> Student Management');
            console.log('2. Re-upload student data or edit the student to assign a section.');
        } else {
            console.log('All students have a sectionId assigned. Great!');
        }

        // Also check for sections without geofencing/time restrictions
        const sections = await Section.find();
        console.log(`\nChecking restrictions for ${sections.length} sections:`);
        sections.forEach(sec => {
            const hasGeo = sec.location && sec.location.lat && sec.location.lng;
            const hasTime = sec.timeWindow && sec.timeWindow.start && sec.timeWindow.end;
            console.log(`- Section ${sec.name} (${sec.branchCode}): Geofencing: ${hasGeo ? 'ENABLED' : 'DISABLED'}, Time Window: ${hasTime ? 'ENABLED' : 'DISABLED'}`);
        });

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkAndFixSections();
