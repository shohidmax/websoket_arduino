/*
  Project: Node.js Backend for Arduino GSM Controller
  Author: Gemini
  Date: 02-Aug-2025
  
  Features:
  - Express API endpoint for Arduino to send data.
  - WebSocket server for real-time communication with the web dashboard.
  - Stores device status and logs in MongoDB.
  - Relays commands from the dashboard to the Arduino.
*/

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');

// ============== CONFIGURATION ==============
const PORT = process.env.PORT || 3000;
const MONGO_URI = 'mongodb+srv://shohidmax:UOCr2X3PhKle0xF1@esp32.tekfkcv.mongodb.net/?retryWrites=true&w=majority&appName=esp32'; // <-- আপনার MongoDB Atlas Connection String দিন

// ============== DATABASE SETUP ==============
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected successfully.'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mongoose Schema for device status log
const DeviceLogSchema = new mongoose.Schema({
  sql_status: String,
  dql_status: String,
  timestamp: { type: Date, default: Date.now }
});
const DeviceLog = mongoose.model('DeviceLog', DeviceLogSchema);

// ============== APP & SERVER SETUP ==============
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Global state variables
let lastDeviceStatus = {
  sql: 'N/A',
  dql: 'N/A',
  last_update: 'N/A'
};
let pendingCommand = null; // Command to be sent to Arduino

// ============== WEBSOCKET LOGIC ==============
wss.on('connection', (ws) => {
  console.log('Dashboard client connected.');

  // Send the last known status to the newly connected client
  ws.send(JSON.stringify({ type: 'status', data: lastDeviceStatus }));

  ws.on('message', (message) => {
    console.log(`Received command from dashboard: ${message}`);
    try {
      const command = JSON.parse(message);
      if (command.action === 'R1ON') {
        pendingCommand = 'R1ON';
        broadcastMessage({ type: 'log', data: 'Relay 1 command queued for device.' });
      } else if (command.action === 'R2ON') {
        pendingCommand = 'R2ON';
        broadcastMessage({ type: 'log', data: 'Relay 2 command queued for device.' });
      }
    } catch (e) {
      console.error('Failed to parse command from dashboard:', e);
    }
  });

  ws.on('close', () => {
    console.log('Dashboard client disconnected.');
  });
});

// Function to broadcast messages to all connected dashboard clients
function broadcastMessage(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// ============== EXPRESS API ENDPOINTS ==============
app.use(express.static('public')); // Serve the HTML dashboard from a 'public' folder

// This is the endpoint the Arduino will hit
app.get('/device-heartbeat', async (req, res) => {
  const { sql, dql } = req.query;
  console.log(`Heartbeat from device: SQL=${sql}, DQL=${dql}`);

  if (sql !== undefined && dql !== undefined) {
    // Update last known status
    lastDeviceStatus = {
      sql: sql === '1' ? 'HIGH' : 'LOW',
      dql: dql === '1' ? 'HIGH' : 'LOW',
      last_update: new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" })
    };

    // Broadcast the new status to all dashboard clients
    broadcastMessage({ type: 'status', data: lastDeviceStatus });

    // Save the log to MongoDB
    const newLog = new DeviceLog({ sql_status: sql, dql_status: dql });
    await newLog.save();

    // Check if there is a pending command and send it back to the Arduino
    if (pendingCommand) {
      res.send(pendingCommand);
      broadcastMessage({ type: 'log', data: `Command '${pendingCommand}' sent to device.` });
      pendingCommand = null; // Clear the command after sending
    } else {
      res.send('OK'); // Acknowledge the heartbeat
    }

  } else {
    res.status(400).send('Bad Request: Missing sql or dql parameters.');
  }
});

// ============== START SERVER ==============
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
