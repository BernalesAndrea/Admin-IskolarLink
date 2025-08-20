const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ✅ MongoDB connection
mongoose.connect('mongodb+srv://hondrea321:bernalesandrea09112003@iskolarlinkcluster.k5dvw5y.mongodb.net/?retryWrites=true&w=majority&appName=IskolarLinkCluster')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// 1️⃣ Event Schema & Model (place here, after MongoDB connect)
const eventSchema = new mongoose.Schema({
  title: String,
  description: String,
  dateTime: String,
  duration: String,
  location: String
});
const Event = mongoose.model('Event', eventSchema);

// Task Schema & Model
const taskSchema = new mongoose.Schema({
  title: String,
  description: String,
  startDate: String,
  dueDate: String
});
const Task = mongoose.model('Task', taskSchema);

// 2️⃣ Routes
// Serve dashboard by default
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashBoard.html'));
});

app.get('/task', (req, res) => {
  res.sendFile(path.join(__dirname, 'task.html'));
});

// POST - Create Event
app.post('/events', async (req, res) => {
  try {
    const newEvent = new Event(req.body);
    await newEvent.save();
    res.status(201).json({ message: 'Event saved', event: newEvent });
  } catch (err) {
    res.status(500).json({ message: 'Error saving event', error: err.message });
  }
});

// GET - Retrieve all Events
app.get('/events', async (req, res) => {
  try {
    const events = await Event.find();
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching events', error: err.message });
  }
});

// POST - Create Task
app.post('/tasks', async (req, res) => {
  try {
    const newTask = new Task(req.body);
    await newTask.save();
    res.status(201).json({ message: 'Task saved', task: newTask });
  } catch (err) {
    res.status(500).json({ message: 'Error saving task', error: err.message });
  }
});

// GET - Fetch Tasks
app.get('/tasks', async (req, res) => {
  try {
    const tasks = await Task.find().sort({ startDate: 1 });;
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching tasks' });
  }
});


// Start Server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
