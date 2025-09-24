require("dotenv").config();

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { type } = require('os');
const multer = require("multer");
const fs = require("fs");

const app = express();

const User = require("./models/User");
const Expense = require("./models/Expense");
const Grade = require("./models/Grades");
const SubmittedDocument = require("./models/SubmittedDocument");


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

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ✅ MongoDB connection
mongoose.connect('mongodb+srv://hondrea321:bernalesandrea09112003@iskolarlinkcluster.k5dvw5y.mongodb.net/?retryWrites=true&w=majority&appName=IskolarLinkCluster')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

/* ============= SCHEMAS ============= */
// Event Schema
const eventSchema = new mongoose.Schema({
  title: String,
  description: String,
  dateTime: Date,
  duration: String,
  location: String,
  attendees: [
    {
      scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      status: { type: String, enum: ["attend", "not_attend"], required: true }
    }
  ]
});
const Event = mongoose.model("Event", eventSchema);

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


// Multer setup (save images in /uploads folder)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = path.join(__dirname, "uploads");

    if (file.fieldname === "attachment") {
      folder = path.join(__dirname, "uploads/grades");
    } else if (file.fieldname === "document") {
      folder = path.join(__dirname, "uploads/submittedDocs");
    } else if (file.fieldname === "file") { 
      folder = path.join(__dirname, "uploads/tasks");
    }

    fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage });



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

    const token = jwt.sign(
  { id: user._id, role: user.role },
  process.env.JWT_SECRET,   // ✅ use env
  { expiresIn: "1h" }
);

    res.cookie("token", token, { httpOnly: true });

    let redirectUrl = "/scholar";
    if (user.role === "admin") redirectUrl = "/admin";

    res.json({
  msg: "Login successful",
  redirect: redirectUrl,
  userId: user._id,
  role: user.role
  });

  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// 🔑 Logout
app.post("/auth/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // only use secure cookies in prod
    sameSite: "strict"
  });
  res.json({ msg: "Logged out successfully", redirect: "/" });
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

// Expenses API

app.post("/api/expenses/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user || !user.verified || user.role !== "scholar") {
      return res.status(400).json({ msg: "Scholar not verified or not found" });
    }

    const { tuition = 0, bookAllowance = 0, monthlyAllowance = 0, action, category, amount } = req.body;
    const totalSpent = tuition + bookAllowance + monthlyAllowance;

    // Upsert: update if exists, otherwise create new
    const expense = await Expense.findOneAndUpdate(
      { scholar: user._id },
      {
        scholar: user._id,
        fullname: user.fullname,
        batchYear: user.batchYear,
        tuition,
        bookAllowance,
        monthlyAllowance,
        totalSpent,
        dateModified: new Date(),
        $push: {
          history: {
            date: new Date(),
            action,
            category,
            amount,
            newTotal: totalSpent
          }
        }
      },
      { upsert: true, new: true }
    );

    res.json({ msg: "Expense saved successfully", expense });
  } catch (err) {
    res.status(500).json({ msg: "Error saving expense", error: err.message });
  }
});

// Get all expenses (for admin)
app.get("/api/expenses", async (req, res) => {
  try {
    const expenses = await Expense.find().populate("scholar", "fullname batchYear");
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching expenses", error: err.message });
  }
});

// Get verified scholars + their expenses
app.get("/api/scholars-with-expenses", async (req, res) => {
  try {
    const scholars = await User.find({ role: "scholar", verified: true })
      .sort({ fullname: 1 });

    // Find all expenses
    const expenses = await Expense.find();

    // Map scholar + expense
    const data = scholars.map(sch => {
      const exp = expenses.find(e => e.scholar.toString() === sch._id.toString());
      return {
        _id: sch._id,
        fullname: sch.fullname,
        batchYear: sch.batchYear,
        dateModified: exp ? exp.dateModified : null,
        tuition: exp ? exp.tuition : 0,
        bookAllowance: exp ? exp.bookAllowance : 0,
        monthlyAllowance: exp ? exp.monthlyAllowance : 0,
        totalSpent: exp ? exp.totalSpent : 0
      };
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch scholars with expenses", details: err.message });
  }
});

app.get("/api/expenses/:userId/history", async (req, res) => {
  try {
    const expense = await Expense.findOne({ scholar: req.params.userId });

    if (!expense) return res.json([]); // no expense yet for this scholar

    // Sort history newest first
    const sortedHistory = (expense.history || []).sort((a, b) => b.date - a.date);

    res.json(sortedHistory);
  } catch (err) {
    console.error("Error fetching history:", err);
    res.status(500).json({ msg: "Error fetching history", error: err.message });
  }
});




// ✅ Upload grades for the logged-in scholar
app.post("/api/grades/me", authMiddleware, upload.single("attachment"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.verified || user.role !== "scholar") {
      return res.status(400).json({ msg: "Scholar not verified or not found" });
    }

    const { schoolYear, semester, subjects } = req.body;

    const newGrade = new Grade({
      scholar: user._id,
      fullname: user.fullname,
      batchYear: user.batchYear,
      schoolYear,
      semester,
      subjects: JSON.parse(subjects),
      attachment: req.file ? `/uploads/grades/${req.file.filename}` : null   // ✅ fix here
    });

    await newGrade.save();
    res.json({ msg: "Grade uploaded successfully", grade: newGrade });
  } catch (err) {
    res.status(500).json({ msg: "Error uploading grade", error: err.message });
  }
});



// ✅ Get all grades (with scholar info)
app.get("/api/grades", async (req, res) => {
  try {
    const grades = await Grade.find().sort({ schoolYear: -1, semester: -1 });
    res.json(grades);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching grades", error: err.message });
  }
});


// ✅ Scholar submits a document
app.post("/api/documents/me", authMiddleware, upload.single("document"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.verified || user.role !== "scholar") {
      return res.status(400).json({ msg: "Scholar not verified or not found" });
    }

    if (!req.file) {
      return res.status(400).json({ msg: "No file uploaded" });
    }

    const { docType } = req.body;

    const newDoc = new SubmittedDocument({
      scholar: user._id,
      fullname: user.fullname,
      batchYear: user.batchYear,
      docType,
      filePath: `/uploads/submittedDocs/${req.file.filename}`,
      status: "Pending"
    });

    await newDoc.save();
    res.json({ msg: "Document submitted successfully", document: newDoc });
  } catch (err) {
    res.status(500).json({ msg: "Error submitting document", error: err.message });
  }
});



// ✅ Scholar fetches their own submitted documents
app.get("/api/documents/me", authMiddleware, async (req, res) => {
  try {
    const docs = await SubmittedDocument.find({ scholar: req.user.id }).sort({ dateSubmitted: -1 });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching documents", error: err.message });
  }
});

// ✅ Admin fetches all documents
app.get("/api/documents", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).send("Access denied");
  try {
    const docs = await SubmittedDocument.find()
      .populate("scholar", "fullname batchYear email") // pull from User model
      .sort({ dateSubmitted: -1 });

    res.json(docs);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching documents", error: err.message });
  }
});


// Admin updates document status
app.put("/api/documents/:id/status", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).send("Access denied");

  try {
    let { status } = req.body; // "accepted" or "rejected"

    if (status === "accepted") status = "Accepted";
    if (status === "rejected") status = "Rejected";

    const updated = await SubmittedDocument.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ msg: "Document not found" });

    res.json({ msg: "Status updated successfully", document: updated });
  } catch (err) {
    res.status(500).json({ msg: "Error updating status", error: err.message });
  }
});

const SubmittedTask = require("./models/SubmittedTask");

// Scholar submits task
app.post("/tasks/:taskId/submit", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.verified || user.role !== "scholar") {
      return res.status(400).json({ msg: "Scholar not verified or not found" });
    }

    if (!req.file) return res.status(400).json({ msg: "No file uploaded" });

    const newSubmission = new SubmittedTask({
      task: req.params.taskId,
      scholar: user._id,
      fullname: user.fullname,
      batchYear: user.batchYear,
      filePath: `/uploads/tasks/${req.file.filename}`,
    });

    await newSubmission.save();
    res.json({ msg: "Task submitted successfully!", submission: newSubmission });
  } catch (err) {
    res.status(500).json({ msg: "Error submitting task", error: err.message });
  }
});


// Admin fetch all submitted tasks
app.get("/api/submitted-tasks", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).send("Access denied");
  try {
    const submissions = await SubmittedTask.find()
      .populate("task", "title dueDate")
      .populate("scholar", "fullname batchYear email")
      .sort({ dateSubmitted: -1 });

    res.json(submissions);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching submissions", error: err.message });
  }
});

// Get all submissions for a specific task
app.get("/api/submitted-tasks/:taskId", authMiddleware, async (req, res) => {
  try {
    const submissions = await SubmittedTask.find({ task: req.params.taskId })
      .populate("scholar", "fullname batchYear email")
      .populate("task", "title dueDate");
    res.json(submissions);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching task submissions", error: err.message });
  }
});










/* ============= MIDDLEWARE ============= */
function authMiddleware(req, res, next) {
  const token = req.cookies.token;

  // 🔒 Prevent browser caching
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
  const decoded = jwt.verify(token, process.env.JWT_SECRET); // ✅ use env
  req.user = decoded;
  next();
} catch {
  return res.redirect("/");
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
// ====================== EVENTS API ======================
app.get("/api/events", async (req, res) => {
  try {
    const events = await Event.find();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create event
app.post("/api/events", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).send("Access denied");

  try {
    const newEvent = await Event.create(req.body);
    res.json(newEvent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Attendance summary
app.get("/api/events/:eventId/attendance", async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId).populate("attendees.scholar");
    if (!event) return res.status(404).json({ error: "Event not found" });

    const attendCount = event.attendees.filter(a => a.status === "attend").length;
    const notAttendCount = event.attendees.filter(a => a.status === "not_attend").length;

    res.json({ attendCount, notAttendCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin event page
 app.get("/admin/events", authMiddleware, (req, res) => {
    if (req.user.role !== "admin") return res.status(403).send("Access denied");
    res.sendFile(path.join(__dirname, "adminPage/event.html"));
  });



// ✅ Admin fetch attendance summary
app.get("/events/:eventId/attendance", async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId).populate("attendees.scholar", "fullname");
    if (!event) return res.status(404).json({ msg: "Event not found" });

    const attendCount = event.attendees.filter(a => a.status === "attend").length;
    const notAttendCount = event.attendees.filter(a => a.status === "not_attend").length;

    res.json({
      eventId: event._id,
      title: event.title,
      attendCount,
      notAttendCount,
      attendees: event.attendees
    });
  } catch (err) {
    res.status(500).json({ msg: "Error fetching attendance", error: err.message });
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
