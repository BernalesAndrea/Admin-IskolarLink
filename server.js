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
app.set('trust proxy', parseInt(process.env.TRUST_PROXY || '0', 10));


const User = require("./models/User");
const Expense = require("./models/Expense");
const Grade = require("./models/Grades");
const SubmittedDocument = require("./models/SubmittedDocument");
const messagesRoutes = require("./routes/messages");
const usersRoutes = require("./routes/users");
const SubmittedTask = require("./models/SubmittedTask");
const allowancesRoutes = require("./routes/allowances");
const bookRoutes = require("./routes/book");
const tuitionTrackerRoutes = require("./routes/tuitionTracker");

const TOKEN_TTL = `${process.env.TOKEN_TTL_HOURS || 1}h`;

// --- JWT helpers (smooth rotation ready) ---
const JWT_ISSUER = process.env.JWT_ISSUER || undefined;
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || undefined;
const JWT_ALG = (process.env.JWT_ALG || 'HS256');

const JWT_PRIMARY = process.env.JWT_SECRET_PRIMARY || process.env.JWT_SECRET; // fallback
const JWT_SECONDARY = process.env.JWT_SECRET_SECONDARY; // optional

function signJwt(payload, opts = {}) {
  return jwt.sign(payload, JWT_PRIMARY, {
    ...opts,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: JWT_ALG
  });
}

function verifyJwt(token) {
  try {
    return jwt.verify(token, JWT_PRIMARY, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: [JWT_ALG]
    });
  } catch (e1) {
    if (JWT_SECONDARY) {
      return jwt.verify(token, JWT_SECONDARY, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: [JWT_ALG]
      });
    }
    throw e1;
  }
}


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
    const decoded = verifyJwt(token);
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
app.use("/api/tuition", authMiddleware, tuitionTrackerRoutes);
app.use("/api/allowances", authMiddleware, allowancesRoutes);
app.use("/api/book", authMiddleware, bookRoutes);



// ✅ Force root ("/") to always load login.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// ✅ Serve static files (CSS, JS, images, etc.)
// ✅ Keep only public folders
app.use('/assets',      express.static(path.join(__dirname, 'assets')));
app.use('/adminPage',   express.static(path.join(__dirname, 'adminPage')));
app.use('/scholarPage', express.static(path.join(__dirname, 'scholarPage')));

app.get('/', (req,res)=>res.sendFile(path.join(__dirname, 'login.html')));
app.get('/signup.html', (req,res)=>res.sendFile(path.join(__dirname, 'signup.html'))); 
app.get('/forgot.html', (req, res) => res.sendFile(path.join(__dirname, 'forgot.html')));



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
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
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

    email = String(email || "").trim().toLowerCase();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    if (!emailOk) return res.status(400).json({ msg: "Please enter a valid email address" });

    // check existing
    const existingUser = await User.findOne({ email }); // email already normalized
    if (existingUser) return res.status(400).json({ msg: "Email already registered" });

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

    // replace jwt.sign(... process.env.JWT_SECRET ...)
    const token = signJwt({ id: user._id, role: user.role }, { expiresIn: TOKEN_TTL });


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

// 🔎 Step 1: check if email exists
app.post('/auth/forgot-check', async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ msg: 'Email is required' });

    const found = await User.exists({ email });
    if (!found) return res.status(404).json({ msg: 'Email does not exist' });

    return res.json({ msg: 'Email found' });
  } catch (err) {
    console.error('POST /auth/forgot-check error:', err);
    return res.status(500).json({ msg: 'Server error' });
  }
});

// 🔐 Step 2: set new password (DEMO ONLY: no email token)
app.post('/auth/reset-password', async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !password) return res.status(400).json({ msg: 'Email and password are required' });
    if (String(password).length < 8) return res.status(400).json({ msg: 'Password must be at least 8 characters' });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: 'Email does not exist' });

    const hashed = await bcrypt.hash(password, 10);
    user.password = hashed;
    await user.save();

    // Optional: clear any login cookies if they exist
    res.clearCookie('scholarToken', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.clearCookie('adminToken', {   httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });

    return res.json({ msg: 'Password updated. You can now sign in.' });
  } catch (err) {
    console.error('POST /auth/reset-password error:', err);
    return res.status(500).json({ msg: 'Server error' });
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


// Verify scholar by ID + set scholar type
app.put("/api/verified-scholar/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    const { scholarType, course, schoolName } = req.body;

    // Normalize and map to our three buckets
    const norm = String(scholarType || "").trim().toLowerCase();
    let finalType = "";
    if (norm.startsWith("post")) finalType = "Post-Graduate";
    else if (norm.startsWith("special")) finalType = "Special";
    else finalType = "Regular"; // default

    const updates = {
      verified: true,
      scholarType: finalType,
      // type: finalType,          // mirror field for FE grouping
    };

    if (course) updates.course = course;
    if (schoolName) updates.schoolName = schoolName;

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!user) return res.status(404).json({ msg: "User not found" });

    return res.json({
      msg: "ok",
      user: {
        _id: String(user._id),
        fullname: user.fullname,
        verified: user.verified,
        scholarType: user.scholarType,
        course: user.course ?? null,
        schoolName: user.schoolName ?? null
      }
    });
  } catch (err) {
    console.error("PUT /api/verified-scholar/:id error:", err);
    return res.status(500).json({ msg: "Error updating user", error: err.message });
  }
});


// Reject (keep or delete) an unverified scholar
app.delete("/api/reject-scholar/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    const { id } = req.params;
    const { deleteAccount = false, reason = "" } = req.body || {};

    // Only for unverified scholars
    const user = await User.findOne({ _id: id, role: "scholar", verified: false });
    if (!user) return res.status(404).json({ msg: "Scholar not found or already processed" });

    if (deleteAccount) {
      await User.deleteOne({ _id: user._id });
      return res.json({ msg: "Scholar rejected and account deleted" });
    } else {
      user.isRejected = true;
      user.rejectedAt = new Date();
      user.rejectionReason = String(reason || "").trim();
      await user.save();
      return res.json({ msg: "Scholar marked as rejected (kept in database)" });
    }
  } catch (err) {
    console.error("DELETE /api/reject-scholar/:id error:", err);
    return res.status(500).json({ msg: "Server error while rejecting scholar", error: err.message });
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

// ✅ Fetch all unverified accounts
app.get("/api/unverified-scholars", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    // exclude isRejected from the queue
    const scholars = await User.find({ role: "scholar", verified: false, isRejected: { $ne: true } })
      .sort({ fullname: 1 });
    res.json(scholars);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch scholars" });
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

// Admin: get a single scholar's profile (minimal fields)
app.get("/api/scholars/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

    const user = await User.findById(req.params.id)
      .select("fullname batchYear barangay course schoolName email scholarType verified profilePicId profilePicBucket profilePic");
    if (!user) return res.status(404).json({ msg: "Scholar not found" });

    // Build a URL for the avatar, falling back to default
    const profilePicUrl =
      (user.profilePicBucket && user.profilePicId)
        ? `/files/${user.profilePicBucket}/${user.profilePicId}`
        : (user.profilePic || "/assets/default-avatar.png");

    // send the fields + the computed url
    res.json({
      ...user.toObject({ virtuals: true }),
      profilePicUrl
    });

  } catch (err) {
    console.error("GET /api/scholars/:id error:", err);
    res.status(500).json({ msg: "Server error", error: err.message });
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

//in the allowance, additional
app.put("/api/scholars/:id/budget", async (req, res) => {
  try {
    const { allottedBudget } = req.body;
    const scholar = await User.findByIdAndUpdate(
      req.params.id,
      { allottedBudget },
      { new: true }
    );
    res.json(scholar);
  } catch (err) {
    res.status(500).json({ msg: "Failed to update budget" });
  }
});



// ✅ Upload grades for the logged-in scholar
app.post("/api/grades/me", authMiddleware, upload.single("attachment"), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.verified || user.role !== "scholar") {
      return res.status(400).json({ msg: "Scholar not verified or not found" });
    }

    const { schoolYear, semester, academicTerm, subjects } = req.body; // <- include academicTerm

    // (Optional) quick validation; UI already enforces required fields
    if (!schoolYear || !semester || !academicTerm) {
      return res.status(400).json({ msg: "Missing schoolYear, semester, or academicTerm" });
    }

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
      academicTerm,                         // <- save it
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

// ✅ Scholar fetches their own grades (flat list; FE will group into folders)
app.get("/api/grades/me", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "scholar") return res.status(403).json({ msg: "Access denied" });

    // Optional filters ?schoolYear=2025-2026&semester=1st%20Semester
    const { schoolYear, semester } = req.query;
    const q = { scholar: req.user.id };
    if (schoolYear) q.schoolYear = schoolYear;
    if (semester) q.semester = semester;

    const grades = await Grade.find(q)
      .sort({ schoolYear: -1, semester: -1, createdAt: -1 })
      .lean();

    // Attach a fileUrl for convenience
    const shaped = grades.map(g => ({
      ...g,
      fileUrl:
        g.attachmentId && g.attachmentBucket
          ? `/files/${g.attachmentBucket}/${g.attachmentId}`
          : (g.attachment || null)
    }));

    res.json(shaped);
  } catch (err) {
    console.error("GET /api/grades/me error:", err);
    res.status(500).json({ msg: "Error fetching grades", error: err.message });
  }
});

// DELETE a submitted grade (scholar can delete only if Pending or Rejected and owner)
app.delete("/api/grades/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "scholar") {
      return res.status(403).json({ msg: "Access denied" });
    }

    const grade = await Grade.findById(req.params.id);
    if (!grade) return res.status(404).json({ msg: "Grade not found" });

    // owner check
    const isOwner =
      grade.scholar && typeof grade.scholar.equals === "function"
        ? grade.scholar.equals(req.user.id)
        : String(grade.scholar) === String(req.user.id);

    if (!isOwner) return res.status(403).json({ msg: "Forbidden" });

    const status = (grade.status || "Pending").trim().toLowerCase();
    if (status !== "pending" && status !== "rejected") {
      return res.status(400).json({ msg: "Only Pending or Rejected grades can be deleted" });
    }

    // Delete GridFS file if present
    if (grade.attachmentId && grade.attachmentBucket) {
      try {
        const db = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: grade.attachmentBucket });
        await bucket.delete(new mongoose.Types.ObjectId(grade.attachmentId));
      } catch (e) {
        console.warn("GridFS delete warning:", e?.message || e);
      }
    }

    await Grade.findByIdAndDelete(grade._id);
    return res.json({ msg: "Deleted" });
  } catch (err) {
    console.error("Delete grade error:", err);
    return res.status(500).json({ msg: "Server error", error: err.message });
  }
});







// ✅ Admin fetch all submitted grades
// Admin: all submitted grades
app.get("/api/admin/grades", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });
  try {
    const grades = await Grade.find()
      .populate("scholar", "fullname batchYear email")
      .sort({ schoolYear: -1, semester: -1, academicTerm: 1, createdAt: -1 }); // added academicTerm
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
      .sort({ createdAt: -1, _id: -1 })
      .lean({ virtuals: true });

    const shaped = docs.map(d => ({
      ...d,
      fileUrl: d.fileId && d.bucket ? `/files/${d.bucket}/${d.fileId}` : d.filePath || null
    }));

    res.json(shaped);
  } catch (err) {
    console.error("GET /api/admin/documents error:", err);
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

// Admin: upload a document for a scholar
// Admin: upload a document for a scholar
app.post("/api/admin/upload",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ msg: "Access denied" });
      }

      const { scholarId, docType, initialStatus, backdateISO } = req.body;

      // ✅ Validate inputs early
      if (!scholarId) return res.status(400).json({ msg: "Missing scholarId" });
      if (!mongoose.Types.ObjectId.isValid(scholarId)) {
        return res.status(400).json({ msg: "Invalid scholarId" });
      }
      if (!docType) return res.status(400).json({ msg: "Missing docType" });
      if (!req.file) return res.status(400).json({ msg: "No file uploaded" });

      console.log("[ADMIN UPLOAD] scholarId=%s docType=%s file=%s (%s bytes)",
        scholarId, docType, req.file.originalname, req.file.size);

      const user = await User.findOne({ _id: scholarId, role: "scholar", verified: true });
      if (!user) return res.status(404).json({ msg: "Scholar not found or not verified" });

      const file = await putToGridFS({
        buffer: req.file.buffer,
        filename: `${Date.now()}-${req.file.originalname}`,
        bucketName: "submittedDocs",
        contentType: req.file.mimetype,
        metadata: { userId: String(user._id), uploadedBy: "admin", field: "document", docType }
      });

      let status = "Pending";
      if (typeof initialStatus === "string") {
        const s = initialStatus.trim().toLowerCase();
        status = s === "accepted" ? "Accepted" : s === "rejected" ? "Rejected" : "Pending";
      }

      const doc = new SubmittedDocument({
        scholar: user._id,
        fullname: user.fullname,
        batchYear: user.batchYear,
        docType,
        fileId: file._id,
        bucket: "submittedDocs",
        status
      });

      if (backdateISO) {
        const d = new Date(backdateISO);
        if (!Number.isNaN(d.getTime())) doc.createdAt = d;
      }

      await doc.save();
      return res.json({
        msg: "Document uploaded for scholar",
        document: doc,
        fileUrl: `/files/submittedDocs/${file._id}`
      });

    } catch (err) {
      console.error("Admin upload error:", err?.message, err?.stack);
      // ✅ surface a clearer error string to the frontend
      return res.status(500).json({ msg: "Server error during admin upload", error: err.message });
    }
  }
);




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

// ================= MY SUBMISSIONS (SCHOLAR) =================

// Return this scholar's task submissions (minimal payload for left tabs)
app.get("/api/my-submissions", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "scholar") return res.status(403).json({ msg: "Access denied" });

    const subs = await SubmittedTask.find({ scholar: req.user.id })
      .select("task status createdAt fileId bucket")
      .populate("task", "title startDate dueDate description") // optional but nice
      .sort({ createdAt: -1 })
      .lean();

    const shaped = subs.map(s => ({
      _id: String(s._id),
      task: s.task?._id ? String(s.task._id) : String(s.task),
      taskInfo: s.task && s.task.title ? {
        title: s.task.title,
        startDate: s.task.startDate,
        dueDate: s.task.dueDate,
        description: s.task.description
      } : null,
      status: s.status || "Pending",
      submittedAt: s.createdAt,
      fileUrl: (s.fileId && s.bucket) ? `/files/${s.bucket}/${s.fileId}` : null
    }));

    res.json(shaped);
  } catch (err) {
    console.error("GET /api/my-submissions error:", err);
    res.status(500).json({ msg: "Error fetching submissions", error: err.message });
  }
});

// Alias to match your front-end's fallback probe
app.get("/api/submissions/me", authMiddleware, async (req, res) => {
  // simply delegate to the same logic
  req.url = "/api/my-submissions";
  return app._router.handle(req, res);
});


// ================= SUBMIT TASK (SCHOLAR) =================
app.post("/api/tasks/:taskId/submit", authMiddleware, upload.single("file"), async (req, res) => {
  if (req.user.role !== "scholar") return res.status(403).json({ msg: "Access denied" });

  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.verified) return res.status(400).json({ msg: "Scholar not verified or not found" });
    if (!req.file) return res.status(400).json({ msg: "No file uploaded" });

    // Ensure task exists
    const task = await mongoose.model("Task").findById(req.params.taskId).lean();
    if (!task) return res.status(404).json({ msg: "Task not found" });

    // Upload file to GridFS
    const file = await putToGridFS({
      buffer: req.file.buffer,
      filename: `${Date.now()}-${req.file.originalname}`,
      bucketName: "tasks",
      contentType: req.file.mimetype,
      metadata: { userId: req.user.id, taskId: req.params.taskId, field: "file" }
    });

    // Upsert one submission per (task, scholar)
    const submission = await SubmittedTask.findOneAndUpdate(
      { task: req.params.taskId, scholar: user._id },
      {
        $setOnInsert: {
          task: req.params.taskId,
          scholar: user._id,
          fullname: user.fullname,
          batchYear: user.batchYear,
          fileId: file._id,
          bucket: "tasks",
          status: "Pending"
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    // If an older submission existed, update to the latest file
    if (submission && String(submission.fileId) !== String(file._id)) {
      submission.fileId = file._id;
      await submission.save();
    }

    return res.json({
      msg: "Task submitted successfully",
      submission,
      fileUrl: `/files/tasks/${file._id}`
    });
  } catch (err) {
    // If you added the compound unique index, this provides a nice conflict signal
    if (err && err.code === 11000) {
      return res.status(409).json({ msg: "You already submitted this task" });
    }
    console.error("Error submitting task:", err);
    return res.status(500).json({ msg: "Error submitting task", error: err.message });
  }
});





const ALLOWED_BUCKETS = new Set(['grades', 'submittedDocs', 'tasks', 'profilePics']);

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


/* ============= EVENT ROUTES ============= */

// ✅ Create event (ADMIN only)
app.post("/api/events", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });

  try {
    const { title, description, dateTime, duration, location } = req.body;
    const newEvent = await Event.create({ title, description, dateTime, duration, location, attendees: [] });
    res.json(newEvent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ✅ Fetch events with optional filter (?status=upcoming|past|all)
app.get("/api/events", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store"); // avoid stale cached lists

    const { status = "all" } = req.query;
    const now = new Date();

    let query = {};
    let sort = { dateTime: 1 };

    if (status === "upcoming") {
      query = { dateTime: { $gt: now } };
      sort = { dateTime: 1 };
    } else if (status === "past" || status === "finished" || status === "done") {
      // small buffer to eliminate boundary flakiness
      const skewMs = 1000;
      query = { dateTime: { $lte: new Date(now.getTime() - skewMs) } };
      sort = { dateTime: -1 };
    }

    const events = await Event.find(query).sort(sort).lean();

    // helpful one-line visibility
    console.log(`[GET /api/events] status=${status} now=${now.toISOString()} count=${events.length}`);

    res.json(events);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching events", error: err.message });
  }
});

// ✅ One-shot partition to avoid any FE mixing/race issues
app.get("/api/events/partition", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const now = new Date();

    const [upcoming, past] = await Promise.all([
      Event.find({ dateTime: { $gt: now } }).sort({ dateTime: 1 }).lean(),
      // small 1s buffer avoids boundary flicker
      Event.find({ dateTime: { $lte: new Date(now.getTime() - 1000) } })
        .sort({ dateTime: -1 }).lean()
    ]);

    res.json({
      now: now.toISOString(),
      upcoming,
      past
    });
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



// // --- API: Create Task
// app.post('/api/tasks', authMiddleware, async (req, res) => {
//   if (req.user.role !== "admin") return res.status(403).json({ msg: "Access denied" });
//   const newTask = await Task.create(req.body);
//   res.status(201).json({ message: 'Task saved', task: newTask });
// });

// // --- API: Get Tasks
// app.get('/api/tasks', async (req, res) => {
//   const tasks = await Task.find().sort({ startDate: 1 });
//   res.json(tasks);
// });

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

// --- API: Delete Announcement (admin only)
app.delete("/announcements/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Access denied" });

    const deleted = await Announcement.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Announcement not found" });

    res.json({ message: "Announcement deleted" });
  } catch (err) {
    console.error("DELETE /announcements/:id error:", err);
    res.status(500).json({ message: "Error deleting announcement", error: err.message });
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
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
