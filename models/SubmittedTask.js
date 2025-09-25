const mongoose = require("mongoose");

const submittedTaskSchema = new mongoose.Schema({
  task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true }, // link to task
  scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // link to user
  fullname: { type: String, required: true },
  batchYear: { type: String, required: true },
  filePath: { type: String, required: true }, // uploaded file
  dateSubmitted: { type: Date, default: Date.now }
});

module.exports = mongoose.model("SubmittedTask", submittedTaskSchema);
