require('dotenv').config();
require('dns').setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const adminRoutes = require('./routes/admin');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();

// --- DATABASE CONNECTION GUARD (PROD FIX) ---
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("DB GUARD ERROR:", err.message);
    next();
  }
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());

// Serve frontend
const publicPath = path.join(__dirname, '../frontend/public');
app.use(express.static(publicPath));

// Explicit routes for HTML files
app.get('/student-dashboard.html', (req, res) => res.sendFile(path.join(publicPath, 'student-dashboard.html')));
app.get('/faculty-dashboard.html', (req, res) => res.sendFile(path.join(publicPath, 'faculty-dashboard.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/auth.html', (req, res) => res.sendFile(path.join(publicPath, 'auth.html')));
app.get('/summary.html', (req, res) => res.sendFile(path.join(publicPath, 'summary.html')));

app.get('/', (req, res) => res.redirect('/auth.html'));


app.get('/api/', (req, res) => {
  res.send('API root. Use /api/auth or /api/attendance.');
});

// Avoid 404 noise for favicon and Chrome DevTools well-known request
app.get('/favicon.ico', (req, res) => res.sendStatus(204));
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => res.sendStatus(204));

app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/admin', adminRoutes);

// OCR feature removed - no longer available
// If any frontend tries to call /api/ocr, return 404

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;