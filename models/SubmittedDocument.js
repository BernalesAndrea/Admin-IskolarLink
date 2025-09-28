const mongoose = require("mongoose");

const submittedDocumentSchema = new mongoose.Schema({
  scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  docType: { type: String, required: true },
  filePath: { type: String, required: true },
  dateSubmitted: { type: Date, default: Date.now },
  status: { type: String, enum: ["Pending", "Accepted", "Rejected"], default: "Pending" }
});

module.exports = mongoose.model("SubmittedDocument", submittedDocumentSchema);
