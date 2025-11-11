import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "BeamLT Signaling Server",
    rooms: Object.keys(rooms).length,
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

interface RoomMap { [roomId: string]: Set<string> }
const rooms: RoomMap = {};

io.on("connection", (socket) => {
  console.log(`[Signaling] Client connected: ${socket.id}`);

  socket.on("create-room", () => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomId] = new Set([socket.id]);
    socket.join(roomId);
    socket.emit("room-created", { roomId });
    console.log(`[Signaling] Room created: ${roomId}`);
  });

  socket.on("join-room", ({ roomId }) => {
    if (!rooms[roomId]) {
      socket.emit("error", { message: "Room not found" });
      return;
    }
    rooms[roomId].add(socket.id);
    socket.join(roomId);
    console.log(`[Signaling] ${socket.id} joined room ${roomId}`);
    socket.to(roomId).emit("peer-joined", { id: socket.id });
  });

  socket.on("signal", ({ roomId, payload }) => {
    socket.to(roomId).emit("signal", payload);
    console.log(`[Signaling] Signal relayed in room ${roomId}:`, payload);
  });

  socket.on("disconnect", () => {
    console.log(`[Signaling] Client disconnected: ${socket.id}`);
    for (const roomId in rooms) {
      rooms[roomId].delete(socket.id);
      if (rooms[roomId].size === 0) delete rooms[roomId];
    }
  });
});

const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  
  // Show network IP
  const os = require("os");
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach((name) => {
    interfaces[name]?.forEach((iface: any) => {
      if (iface.family === "IPv4" && !iface.internal) {
        console.log(`Network: http://${iface.address}:${PORT}`);
      }
    });
  });
});
