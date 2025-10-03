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
const messagesRoutes = require("./routes/messages");
const usersRoutes = require("./routes/users");
const SubmittedTask = require("./models/SubmittedTask");



// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ============= MIDDLEWARE ============= */
function authMiddleware(req, res, next) {

  let token;

  if (req.cookies.adminToken) {
    token = req.cookies.adminToken;
  } else if (req.cookies.scholarToken) {
    token = req.cookies.scholarToken;
  }

  console.log("AuthMiddleware path:", req.path, "token:", token ? "found" : "MISSING");

  // Prevent browser caching
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (!token) {
    // If request is for API (starts with /api) return 401 JSON,
    // otherwise redirect to login page for normal HTML GETs
    if (req.path.startsWith("/api") || req.xhr || req.headers.accept?.includes("application/json")) {
      return res.status(401).json({ msg: "Unauthorized" });
    } else {
      return res.redirect("/");
    }
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    // token invalid or expired
    if (req.path.startsWith("/api") || req.xhr || req.headers.accept?.includes("application/json")) {
      return res.status(401).json({ msg: "Invalid or expired token" });
    } else {
      return res.redirect("/");
    }
  }
}


app.use("/api/messages", messagesRoutes);
app.use("/api/users", usersRoutes);

// ✅ Force root ("/") to always load login.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// ✅ Serve static files (CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname)));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ✅ MongoDB connection
mongoose.connect(process.env.MONGO_URL)
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
  date: { type: Date, default: Date.now },
  attendees: [
    {
      scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      status: { type: String, enum: ["attend", "not_attend"] }
    }
  ]
});
const Announcement = mongoose.model("Announcement", announcementSchema);


// Multer setup
const upload = multer({
  storage: multer.memoryStorage(),
  // optional hard caps:
  // limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
});

const { ObjectId } = mongoose.Types;

async function putToGridFS({ buffer, filename, bucketName, contentType, metadata = {} }) {
  const db = mongoose.connection.db;
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName });

  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, { contentType, metadata });

    uploadStream.on("error", reject);

    // No file argument here — use uploadStream.id
    uploadStream.on("finish", () => {
      resolve({
        _id: uploadStream.id,       // <-- GridFS ObjectId
        filename: uploadStream.filename,
        bucketName,
        contentType,
        metadata,
      });
    });

    uploadStream.end(buffer);
  });
}


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
      // course,
      // schoolName,
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

    if (user.role === "scholar") {
  res.cookie("scholarToken", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 1000
  });
} 
    if (user.role === "admin") {
  res.cookie("adminToken", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 1000
  });
}

    let redirectUrl = "/scholar";
    if (user.role === "admin") redirectUrl = "/admin";

    res.json({
  msg: "Login successful",
  redirect: redirectUrl,
  userId: user._id.toString(),  // ✅ this is what frontend should store
  role: user.role
});


  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

// 🔑 Logout (safe for both roles)
app.post("/auth/logout", (req, res) => {
  res.clearCookie("scholarToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  });

  res.clearCookie("adminToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
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
app.put("/api/verified-scholar/:id", async (req, res) => { 
  try {
    const updates = { verified: true };

    if (req.body.course) updates.course = req.body.course;
    if (req.body.schoolName) updates.schoolName = req.body.schoolName;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true }
    );
    res.json(user);
  } catch (err) {
    res.status(500).json({ msg: "Error updating user" });
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

// Get logged-in user profile
app.get("/api/users/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ msg: "User not found" });

    const profilePicUrl =
      (user.profilePicBucket && user.profilePicId)
        ? `/files/${user.profilePicBucket}/${user.profilePicId}`
        : (user.profilePic || "/assets/default-avatar.png");

    const payload = { ...user.toObject({ virtuals: true }), profilePicUrl };
    return res.json(payload); // ✅ exactly one response
  } catch (err) {
    console.error("GET /api/users/me error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ msg: "Error fetching profile", error: err.message });
    }
  }
});


// Update logged-in user profile
app.put("/api/users/me", authMiddleware, upload.single("profilePic"), async (req, res) => {
  try {
    const updates = {
      fullname: req.body.fullname,
      email: req.body.email,
      barangay: req.body.barangay,
      course: req.body.course,
      schoolName: req.body.schoolName
    };

    if (req.file) {
      const file = await putToGridFS({
        buffer: req.file.buffer,
        filename: `${Date.now()}-${req.file.originalname}`,
        bucketName: 'profilePics',
        contentType: req.file.mimetype,
        metadata: { userId: req.user.id, field: 'profilePic' }
      });
      updates.profilePicId = file._id;
      updates.profilePicBucket = 'profilePics';
    }

    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true }).select("-password");
    if (!user) return res.status(404).json({ msg: "User not found" });

    const profilePicUrl = (user.profilePicId && user.profilePicBucket)
      ? `/files/${user.profilePicBucket}/${user.profilePicId}`
      : null;

    res.json({ msg: "Profile updated successfully", user, profilePicUrl });
  } catch (err) {
    res.status(500).json({ msg: "Error updating profile", error: err.message });
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
    let attachmentId = null, attachmentBucket = null;

    if (req.file) {
      const file = await putToGridFS({
        buffer: req.file.buffer,
        filename: `${Date.now()}-${req.file.originalname}`,
        bucketName: 'grades',
        contentType: req.file.mimetype,
        metadata: { userId: req.user.id, field: 'attachment' }
      });
      attachmentId = file._id;
      attachmentBucket = 'grades';
    }

    const newGrade = new Grade({
      scholar: user._id,
      fullname: user.fullname,
      batchYear: user.batchYear,
      schoolYear,
      semester,
      subjects: JSON.parse(subjects || '[]'),
      attachmentId,
      attachmentBucket
    });

    await newGrade.save();
    const attachmentUrl = attachmentId ? `/files/${attachmentBucket}/${attachmentId}` : null;
    res.json({ msg: "Grade uploaded successfully", grade: newGrade, attachmentUrl });
  } catch (err) {
    res.status(500).json({ msg: "Error uploading grade", error: err.message });
  }
});




// ✅ Admin fetch all submitted grades
app.get("/api/admin/grades", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

  try {
    const grades = await Grade.find()
      .populate("scholar", "fullname batchYear email")
      .sort({ schoolYear: -1, semester: -1 });

    res.json(grades);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching grades", error: err.message });
  }
});

// ✅ Admin fetch grades of a specific scholar
app.get("/api/admin/grades/:scholarId", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

  try {
    const grades = await Grade.find({ scholar: req.params.scholarId })
      .populate("scholar", "fullname batchYear email")
      .sort({ dateSubmitted: -1 });   // newest first
    res.json(grades);
  } catch (err) {
    console.error("Error fetching scholar grades:", err);
    res.status(500).json({ msg: "Error fetching scholar grades", error: err.message });
  }
});


// ✅ Admin updates grade status
app.put("/api/admin/grades/:id/status", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

  try {
    let { status } = req.body; // "accepted" or "rejected"
    if (status === "accepted") status = "Accepted";
    if (status === "rejected") status = "Rejected";

    const updated = await Grade.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ msg: "Grade not found" });

    res.json({ msg: "Grade status updated successfully", grade: updated });
  } catch (err) {
    res.status(500).json({ msg: "Error updating grade status", error: err.message });
  }
});




// ✅ Scholar submits a document
app.post("/api/documents/me", authMiddleware, upload.single("document"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.verified || user.role !== "scholar") {
      return res.status(400).json({ msg: "Scholar not verified or not found" });
    }
    if (!req.file) return res.status(400).json({ msg: "No file uploaded" });

    // helpful debug (keep for now)
    console.log("Upload doc:", {
      userId: req.user.id,
      docType: req.body.docType,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    const file = await putToGridFS({
      buffer: req.file.buffer,
      filename: `${Date.now()}-${req.file.originalname}`,
      bucketName: "submittedDocs",
      contentType: req.file.mimetype,
      metadata: { userId: req.user.id, docType: req.body.docType, field: "document" }
    });

    if (!file || !file._id) {
      console.error("GridFS returned no file/_id:", file);
      return res.status(500).json({ msg: "Upload failed: no file id returned from GridFS" });
    }

    const newDoc = new SubmittedDocument({
      scholar: user._id,
      fullname: user.fullname,
      batchYear: user.batchYear,
      docType: req.body.docType,
      fileId: file._id,
      bucket: "submittedDocs",
      status: "Pending"
    });

    const saved = await newDoc.save();
    console.log("✅ SubmittedDocument saved:", saved._id);

    res.json({
      msg: "Document submitted successfully",
      document: saved,
      fileUrl: `/files/submittedDocs/${file._id}`
    });
  } catch (err) {
    console.error("❌ Submit document error:", err);
    res.status(500).json({ msg: "Error submitting document", error: err.message });
  }
});





// ✅ Scholar fetches their own submitted documents
app.get("/api/documents/me", authMiddleware, async (req, res) => {
  try {
    const docs = await SubmittedDocument.find({ scholar: req.user.id })
      .populate("scholar", "fullname batchYear")
      .sort({ createdAt: -1 }); // <-- use createdAt
    res.json(docs);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching documents", error: err.message });
  }
});

// DELETE a submitted document (scholar can delete only if Pending and owner)
app.delete("/api/documents/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "scholar") {
      return res.status(403).json({ msg: "Access denied" });
    }

    const doc = await SubmittedDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ msg: "Document not found" });

    // Robust owner check
    const isOwner =
      doc.scholar && typeof doc.scholar.equals === "function"
        ? doc.scholar.equals(req.user.id)
        : String(doc.scholar) === String(req.user.id);

    if (!isOwner) return res.status(403).json({ msg: "Forbidden" });

    // Normalize status: treat null/undefined/empty/whitespace as "Pending"
    const raw = doc.status;
    const statusStr =
      raw == null || String(raw).trim() === "" ? "Pending" : String(raw);
    const normalizedStatus = statusStr.trim().toLowerCase();

    // helpful debug
    console.log("DELETE /api/documents/:id", {
      docId: String(doc._id),
      scholar: String(doc.scholar),
      user: String(req.user.id),
      rawStatus: raw,
      statusStr,
      normalizedStatus
    });

    if (normalizedStatus !== "pending") {
      return res
        .status(400)
        .json({ msg: "Only pending documents can be deleted", statusSeen: statusStr });
    }

    // Delete GridFS file if present
    if (doc.fileId && doc.bucket) {
      try {
        const db = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: doc.bucket });
        await bucket.delete(new mongoose.Types.ObjectId(doc.fileId));
      } catch (e) {
        console.warn("GridFS delete warning:", e?.message || e);
      }
    }

    await SubmittedDocument.findByIdAndDelete(doc._id);
    return res.json({ msg: "Deleted" });
  } catch (err) {
    console.error("Delete error:", err);
    return res.status(500).json({ msg: "Server error", error: err.message });
  }
});


// ✅ Admin fetches all documents
app.get("/api/admin/documents", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });
  try {
    const docs = await SubmittedDocument.find()
      .populate("scholar", "fullname batchYear email")
      .sort({ createdAt: -1 });

    const shaped = docs.map(d => ({
      ...d.toObject(),
      fileUrl: d.fileId && d.bucket ? `/files/${d.bucket}/${d.fileId}` : d.filePath || null
    }));

    res.json(shaped);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching documents", error: err.message });
  }
});



// with changes
// Admin updates document status (now supports optional rejection reason)
app.put("/api/admin/documents/:id/status", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

  try {
    let { status, reason } = req.body; // accept optional reason

    if (!status) return res.status(400).json({ msg: "Missing status" });

    // normalize status
    const norm = String(status).trim().toLowerCase();
    const mappedStatus = norm === "accepted" ? "Accepted"
                     : norm === "rejected" ? "Rejected"
                     : status; // fallback (if you add more later)

    // build update payload
    const update = { status: mappedStatus };

    // store reason only when rejected (and a non-empty reason was provided)
    if (mappedStatus === "Rejected" && typeof reason === "string" && reason.trim()) {
      update.rejectionReason = reason.trim();
      update.rejectedAt = new Date(); // optional timestamp
    }

    // (optional) clear any old rejection reason if now accepted
    // if (mappedStatus === "Accepted") update.rejectionReason = undefined;

    const updated = await SubmittedDocument.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ msg: "Document not found" });

    res.json({ msg: "Status updated successfully", document: updated });
  } catch (err) {
    res.status(500).json({ msg: "Error updating status", error: err.message });
  }
});


// Admin: Get all submitted tasks
app.get("/api/admin/submitted-tasks", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

  try {
    const submissions = await SubmittedTask.find()
      .populate("scholar", "fullname batchYear email")
      .sort({ createdAt: -1 })
      .lean({ virtuals: true });

    res.json(submissions);
  } catch (err) {
    console.error("Error fetching submissions:", err);
    res.status(500).json({ msg: "Error fetching all submissions", error: err.message });
  }
});

// Admin: Get submissions for a specific task
app.get("/api/admin/submitted-tasks/:taskId", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

  try {
    const submissions = await SubmittedTask.find({ task: req.params.taskId })
      .populate("scholar", "fullname batchYear email")
      .sort({ createdAt: -1 })
      .lean({ virtuals: true });

    res.json(submissions);
  } catch (err) {
    console.error("Error fetching submissions:", err);
    res.status(500).json({ msg: "Error fetching submissions", error: err.message });
  }
});

// Scholar: Submit a task
app.post("/api/tasks/:taskId/submit", authMiddleware, upload.single("file"), async (req, res) => {
  if (req.user.role !== "scholar") return res.status(403).json({ msg: "Access denied" });

  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.verified) return res.status(400).json({ msg: "Scholar not verified or not found" });
    if (!req.file) return res.status(400).json({ msg: "No file uploaded" });

    const file = await putToGridFS({
      buffer: req.file.buffer,
      filename: `${Date.now()}-${req.file.originalname}`,
      bucketName: 'tasks',
      contentType: req.file.mimetype,
      metadata: { userId: req.user.id, taskId: req.params.taskId, field: 'file' }
    });

    const submission = new SubmittedTask({
      task: req.params.taskId,
      scholar: user._id,
      fullname: user.fullname,
      batchYear: user.batchYear,
      fileId: file._id,
      bucket: 'tasks'
    });

    await submission.save();
    res.json({ msg: "Task submitted successfully", submission, fileUrl: `/files/tasks/${file._id}` });
  } catch (err) {
    res.status(500).json({ msg: "Error submitting task", error: err.message });
  }
});


const ALLOWED_BUCKETS = new Set(['grades','submittedDocs','tasks','profilePics']);

function assertBucket(name) {
  if (!ALLOWED_BUCKETS.has(name)) throw new Error('Invalid bucket');
  return name;
}

app.get('/files/:bucket/:id', authMiddleware, async (req, res) => {
  try {
    const bucketName = assertBucket(req.params.bucket);
    const fileId = new mongoose.Types.ObjectId(req.params.id);

    const db = mongoose.connection.db;
    const filesCol = db.collection(`${bucketName}.files`);
    const fileDoc = await filesCol.findOne({ _id: fileId });
    if (!fileDoc) return res.status(404).json({ msg: 'File not found' });

    // Example ownership gate (uncomment to enforce):
    // if (req.user.role !== 'admin' && String(fileDoc.metadata?.userId) !== req.user.id) {
    //   return res.status(403).json({ msg: 'Forbidden' });
    // }

    res.set('Content-Type', fileDoc.contentType || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${fileDoc.filename}"`);

    const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName });
    bucket.openDownloadStream(fileId).pipe(res);
  } catch (e) {
    res.status(400).json({ msg: 'Invalid file/bucket', error: e.message });
  }
});

app.get('/files/:bucket/:id/download', authMiddleware, async (req, res) => {
  try {
    const bucketName = assertBucket(req.params.bucket);
    const fileId = new mongoose.Types.ObjectId(req.params.id);

    const db = mongoose.connection.db;
    const filesCol = db.collection(`${bucketName}.files`);
    const fileDoc = await filesCol.findOne({ _id: fileId });
    if (!fileDoc) return res.status(404).json({ msg: 'File not found' });

    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${fileDoc.filename}"`);

    const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName });
    bucket.openDownloadStream(fileId).pipe(res);
  } catch (e) {
    res.status(400).json({ msg: 'Invalid file/bucket', error: e.message });
  }
});

app.get('/files/:bucket/:id/meta', authMiddleware, async (req, res) => {
  try {
    const bucketName = assertBucket(req.params.bucket);
    const fileId = new mongoose.Types.ObjectId(req.params.id);

    const db = mongoose.connection.db;
    const filesCol = db.collection(`${bucketName}.files`);
    const fileDoc = await filesCol.findOne({ _id: fileId });
    if (!fileDoc) return res.status(404).json({ msg: 'File not found' });

    res.json({
      filename: fileDoc.filename,
      contentType: fileDoc.contentType || 'application/octet-stream',
      length: fileDoc.length,
      uploadDate: fileDoc.uploadDate
    });
  } catch (e) {
    res.status(400).json({ msg: 'Invalid file/bucket', error: e.message });
  }
});






/* ============= PROTECTED ROUTES ============= */
// --- Admin dashboard (only for role "admin")
app.get('/admin', authMiddleware, (req, res) => {
  if (req.user.role !== "admin") {
    // Redirect to login if not admin
    return res.redirect("/");
  }
  res.sendFile(path.join(__dirname, '/adminPage/navigation.html')); 
});

// --- Scholar dashboard
app.get('/scholar', authMiddleware, (req, res) => {
  if (req.user.role !== "scholar") {
    // Redirect to login if not scholar
    return res.redirect("/");
  }
  res.sendFile(path.join(__dirname, '/scholarPage/scholarNav.html')); 
});

// --- Task page (example direct link)
app.get('/task', authMiddleware, (req, res) => {
  if (req.user.role !== "admin") return res.redirect("/");
  res.sendFile(path.join(__dirname, '/adminPage/task.html'));
});


/* ============= EVENTS + TASKS ============= */

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
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

  try {
    const newEvent = await Event.create(req.body);
    res.json(newEvent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin event page
app.get("/admin/events", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") return res.redirect("/");
  res.sendFile(path.join(__dirname, "adminPage/event.html"));
});


// Scholar marks attendance
app.post("/events/:id/attendance", authMiddleware, async (req, res) => {
  try {
    console.log("Incoming attendance request:", req.params.id, req.user, req.body);

    const user = await User.findById(req.user.id);
    if (!user || !user.verified || user.role !== "scholar") {
      return res.status(400).json({ msg: "Scholar not verified or not found" });
    }

    const { status } = req.body;
    console.log("Attendance status:", status);

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ msg: "Event not found" });

    const existing = event.attendees.find(
      a => a.scholar.toString() === user._id.toString()
    );

    if (existing) {
      existing.status = status;
      console.log("Updating existing attendance");
    } else {
      event.attendees.push({ scholar: user._id, status });
      console.log("Pushing new attendance:", { scholar: user._id, status });
    }

    await event.save();
    console.log("Event saved:", event.attendees);

    res.json({ msg: "Attendance updated", event });
  } catch (err) {
    console.error("Error saving attendance:", err);
    res.status(500).json({ msg: "Error saving attendance", error: err.message });
  }
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


/* ============= EVENT ROUTES ============= */

// Create new event
app.post("/api/events", async (req, res) => {
  try {
    const { title, description, dateTime, duration, location } = req.body;

    const newEvent = new Event({
      title,
      description,
      dateTime,
      duration,
      location,
      attendees: [] // empty by default
    });

    await newEvent.save();
    res.json(newEvent);
  } catch (err) {
    res.status(500).json({ msg: "Error creating event", error: err.message });
  }
});

// Get all events
app.get("/api/events", async (req, res) => {
  try {
    const events = await Event.find().sort({ dateTime: 1 }); // upcoming first
    res.json(events);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching events", error: err.message });
  }
});

// Get attendance counts
app.get("/api/events/:id/attendance", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ msg: "Event not found" });

    const attendCount = event.attendees.filter(a => a.status === "attend").length;
    const notAttendCount = event.attendees.filter(a => a.status === "not_attend").length;

    res.json({ attendCount, notAttendCount });
  } catch (err) {
    res.status(500).json({ msg: "Error fetching attendance", error: err.message });
  }
});



// --- API: Create Task
app.post('/api/tasks', authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });
  const newTask = await Task.create(req.body);
  res.status(201).json({ message: 'Task saved', task: newTask });
});

// --- API: Get Tasks
app.get('/api/tasks', async (req, res) => {
  const tasks = await Task.find().sort({ startDate: 1 });
  res.json(tasks);
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

// ================= TASK ROUTES =================

// Get all tasks (admin + scholar)
app.get("/api/tasks", authMiddleware, async (req, res) => {
  try {
    const tasks = await Task.find().sort({ dueDate: 1 }); // upcoming tasks first
    res.json(tasks);
  } catch (err) {
    console.error("Error fetching tasks:", err);
    res.status(500).json({ msg: "Error fetching tasks", error: err.message });
  }
});

// Create a new task (admin only)
app.post("/api/tasks", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

  try {
    const { title, description, startDate, dueDate } = req.body;

    const newTask = new Task({ title, description, startDate, dueDate });
    await newTask.save();

    res.status(201).json({ msg: "Task created successfully", task: newTask });
  } catch (err) {
    console.error("Error creating task:", err);
    res.status(500).json({ msg: "Error creating task", error: err.message });
  }
});


/* ============= START SERVER ============= */
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
