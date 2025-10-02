// models/Grades.js
const mongoose = require("mongoose");

const gradeSchema = new mongoose.Schema(
  {
    scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fullname: String,
    batchYear: String,
    schoolYear: { type: String, required: true },
    semester:  { type: String, required: true },
    subjects: [
      {
        subjectCode: String,
        units: Number,
        grade: Number,
      }
    ],

    // 🔴 New (match what server.js actually saves):
    attachmentId:     { type: mongoose.Schema.Types.ObjectId },
    attachmentBucket: { type: String }, // e.g. "grades"

    // Optional legacy fallback if you used disk paths before:
    attachment: { type: String },

    status: { type: String, enum: ["Pending", "Accepted", "Rejected"], default: "Pending" },
    dateSubmitted: { type: Date, default: Date.now }
  },
  { timestamps: true } // adds createdAt/updatedAt (useful in admin sorting)
);

module.exports = mongoose.model("Grade", gradeSchema);
