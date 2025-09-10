const mongoose = require("mongoose");

const gradeSchema = new mongoose.Schema({
  scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // linked to User
  fullname: String,
  batchYear: String,
  schoolYear: { type: String, required: true },
  semester: { type: String, required: true },
  subjects: [
    {
      subjectCode: String,
      units: Number,
      grade: Number,
    }
  ],
  attachment: { type: String }, // file path or URL
  dateSubmitted: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Grade", gradeSchema);
