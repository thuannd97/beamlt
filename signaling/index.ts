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

// ICE servers (STUN/TURN) cho client. Secret Metered chỉ nằm trong env của server.
const FALLBACK_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const ICE_CACHE_TTL_MS = 10 * 60 * 1000;
let iceCache: { servers: unknown[]; expiresAt: number } | null = null;

async function getIceServers(): Promise<unknown[]> {
  if (iceCache && iceCache.expiresAt > Date.now()) return iceCache.servers;

  const appName = process.env.METERED_APP_NAME;
  const apiKey = process.env.METERED_API_KEY;
  if (!appName || !apiKey) {
    console.warn("[ICE] METERED_APP_NAME/METERED_API_KEY not set, using STUN fallback");
    return FALLBACK_ICE_SERVERS;
  }

  try {
    const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Metered responded ${res.status}`);
    const servers = await res.json();
    if (!Array.isArray(servers) || servers.length === 0) {
      throw new Error("Unexpected Metered response format");
    }
    iceCache = { servers, expiresAt: Date.now() + ICE_CACHE_TTL_MS };
    return servers;
  } catch (err) {
    console.warn("[ICE] Failed to fetch Metered credentials, using STUN fallback:", (err as Error).message);
    return FALLBACK_ICE_SERVERS;
  }
}

app.get("/ice-servers", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "no-store");
  res.json(await getIceServers());
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
