// models/Grades.js
const mongoose = require("mongoose");

const gradeSchema = new mongoose.Schema(
  {
    scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fullname: String,
    batchYear: String,
    schoolYear: { type: String, required: true },
    semester:  { type: String, required: true },

    // NEW: Academic term drop-down value
    academicTerm: { 
      type: String,
      enum: ["Preliminary Grades", "Mid-Semester Grades", "Final Grades"]
      // not required to preserve existing data
    },

    attachmentId:     { type: mongoose.Schema.Types.ObjectId },
    attachmentBucket: { type: String }, // e.g. "grades"
    attachment: { type: String },       // legacy

    status: { type: String, enum: ["Pending", "Accepted", "Rejected"], default: "Pending" },
    dateSubmitted: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Grade", gradeSchema);
