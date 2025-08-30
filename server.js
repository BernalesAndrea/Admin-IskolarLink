const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { type } = require('os');

const app = express();

const User = require("./models/User");

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ✅ Force root ("/") to always load login.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// ✅ Serve static files (CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname)));

// ✅ MongoDB connection
mongoose.connect('mongodb+srv://hondrea321:bernalesandrea09112003@iskolarlinkcluster.k5dvw5y.mongodb.net/?retryWrites=true&w=majority&appName=IskolarLinkCluster')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

/* ============= SCHEMAS ============= */
// Event Schema
const eventSchema = new mongoose.Schema({
  title: String,
  description: String,
  dateTime: String,
  duration: String,
  location: String
});
const Event = mongoose.model('Event', eventSchema);

// Task Schema
const taskSchema = new mongoose.Schema({
  title: String,
  description: String,
  startDate: String,
  dueDate: String
});
const Task = mongoose.model('Task', taskSchema);

// Announcement Schema
const announcementSchema = new mongoose.Schema({
  title: String,
  priority: { type: String, enum: ["high", "medium", "low"], default: "low" },
  category: String,
  content: String,
  date: { type: Date, default: Date.now }
});
const Announcement = mongoose.model("Announcement", announcementSchema);

/* ============= AUTH ROUTES ============= */
app.post('/auth/signup', async (req, res) => {
  try {
    const { fullname, barangay, batchYear, email, password } = req.body;

    // check existing
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ msg: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      fullname,
      barangay,
      batchYear,
      email,
      password: hashedPassword,
      role: "scholar",
      verified: false // 🔑 unverified initially
    });

    await newUser.save();
    res.json({ msg: "Registration successful! Await admin verification." });
  } catch (err) {
    res.status(500).json({ msg: "Error creating user", error: err.message });
  }
});



// 🔑 Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    // 🔑 block unverified scholars
    if (user.role === "scholar" && !user.verified) {
      return res.status(403).json({ msg: "Your account is awaiting admin verification." });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, "SECRET_KEY", { expiresIn: "1h" });
    res.cookie("token", token, { httpOnly: true });

    let redirectUrl = "/scholar";
    if (user.role === "admin") redirectUrl = "/admin";

    res.json({ msg: "Login successful", redirect: redirectUrl });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});


// Fetch all unverified scholars
app.get("/api/unverified-scholars", async (req, res) => {
  try {
    const scholars = await User.find({ role: "scholar", verified: false });
    res.json(scholars);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch scholars" });
  }
});

// Verify scholar by ID
app.put("/api/verify-scholar/:id", async (req, res) => {
  try {
    const scholar = await User.findByIdAndUpdate(
      req.params.id,
      { verified: true },
      { new: true }
    );
    if (!scholar) return res.status(404).json({ msg: "Scholar not found" });

    res.json({ msg: "Scholar verified successfully", scholar });
  } catch (err) {
    res.status(500).json({ error: "Failed to verify scholar" });
  }
});

// ✅ Fetch all verified scholars (sorted alphabetically by fullname)
app.get("/api/verified-scholars", async (req, res) => {
  try {
    const scholars = await User.find({ role: "scholar", verified: true })
      .sort({ fullname: 1 }); // A-Z
    res.json(scholars);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch verified scholars" });
  }
});





/* ============= MIDDLEWARE ============= */
function authMiddleware(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect('/');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY");
    req.user = decoded;
    next();
  } catch {
    return res.redirect('/');
  }
}


/* ============= PROTECTED ROUTES ============= */
// --- Admin dashboard (only for role "admin")
app.get('/admin', authMiddleware, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).send("Access denied");
  res.sendFile(path.join(__dirname, '/adminPage/navigation.html')); 
});

// --- Scholar dashboard
app.get('/scholar', authMiddleware, (req, res) => {
  if (req.user.role !== "scholar") return res.status(403).send("Access denied");
  res.sendFile(path.join(__dirname, '/scholarPage/scholarNav.html')); 
});

// --- Task page (example direct link)
app.get('/task', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, '/adminPage/task.html'));
});

app.get("/api/unverified-scholars", async (req, res) => {
  try {
    const scholars = await Scholar.find({ isVerified: false }); // adjust field name
    res.json(scholars);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch scholars" });
  }
});


/* ============= EVENTS + TASKS ============= */
// --- API: Create Event
app.post('/events', async (req, res) => {
  try {
    const newEvent = new Event(req.body);
    await newEvent.save();
    res.status(201).json({ message: 'Event saved', event: newEvent });
  } catch (err) {
    res.status(500).json({ message: 'Error saving event', error: err.message });
  }
});

// --- API: Get Events
app.get('/events', async (req, res) => {
  try {
    const events = await Event.find();
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching events', error: err.message });
  }
});

// --- API: Create Task
app.post('/tasks', async (req, res) => {
  try {
    const newTask = new Task(req.body);
    await newTask.save();
    res.status(201).json({ message: 'Task saved', task: newTask });
  } catch (err) {
    res.status(500).json({ message: 'Error saving task', error: err.message });
  }
});

// --- API: Get Tasks
app.get('/tasks', async (req, res) => {
  try {
    const tasks = await Task.find().sort({ startDate: 1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching tasks' });
  }
});

// --- API: Create Announcement
app.post("/announcements", async (req, res) => {
  try {
    const newAnnouncement = new Announcement(req.body);
    await newAnnouncement.save();
    res.status(201).json({ message: "Announcement saved", announcement: newAnnouncement });
  } catch (err) {
    res.status(500).json({ message: "Error saving announcement", error: err.message });
  }
});

// --- API: Get Announcements
app.get("/announcements", async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ date: -1 }); // newest first
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ message: "Error fetching announcements", error: err.message });
  }
});

/* ============= START SERVER ============= */
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
