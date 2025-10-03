const mongoose = require("mongoose");

const submittedTaskSchema = new mongoose.Schema(
  {
    // the assigned Task being submitted to
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true },

    // who submitted
    scholar: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // denormalized snapshots (nice for quicker admin listing)
    fullname: { type: String, required: true },
    batchYear: { type: String, required: true },

    // uploaded proof (GridFS)
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    bucket: { type: String, enum: ["tasks"], required: true },

    // optional status if you plan to review
    status: { type: String, enum: ["Pending", "Accepted", "Rejected"], default: "Pending" }
  },
  { timestamps: true } // createdAt will be your "Date Submitted"
);

submittedTaskSchema.virtual("submittedAt").get(function () {
  return this.createdAt || this._id.getTimestamp();
});

submittedTaskSchema.set("toObject", { virtuals: true });
submittedTaskSchema.set("toJSON",   { virtuals: true });

module.exports = mongoose.model("SubmittedTask", submittedTaskSchema);