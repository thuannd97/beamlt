import express from "express";
import http from "http";
import { Server } from "socket.io";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "BeamLT Signaling Server",
    rooms: rooms.size,
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

// ---------------------------------------------------------------------------
// Rooms: tối đa 2 người (1 gửi, 1 nhận).
// ---------------------------------------------------------------------------
const MAX_MEMBERS = 2;
const EMPTY_ROOM_TTL_MS = 2 * 60 * 1000; // giữ room trống 2 phút để người rớt mạng quay lại
const MAX_ROOM_AGE_MS = 24 * 60 * 60 * 1000;
// Bỏ các ký tự dễ nhầm: 0/O, 1/I/L
const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_ID_RE = new RegExp(`^[${ROOM_ALPHABET}]{6}$`);

interface Room {
  members: Set<string>;
  createdAt: number;
  emptySince?: number;
}
const rooms = new Map<string, Room>();

function newRoomId(): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < 6; i++) id += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
    if (!rooms.has(id)) return id;
  }
}

function normalizeRoomId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim().toUpperCase();
  return ROOM_ID_RE.test(id) ? id : null;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    const expiredEmpty = room.emptySince !== undefined && now - room.emptySince > EMPTY_ROOM_TTL_MS;
    if (expiredEmpty || now - room.createdAt > MAX_ROOM_AGE_MS) {
      rooms.delete(id);
      console.log(`[Room ${id}] removed (${expiredEmpty ? "empty" : "too old"})`);
    }
  }
}, 30_000).unref();

io.on("connection", (socket) => {
  /** Rời room hiện tại (nếu có) và báo cho người còn lại. */
  const leaveCurrentRoom = () => {
    const roomId: string | undefined = socket.data.roomId;
    if (!roomId) return;
    socket.data.roomId = undefined;
    socket.leave(roomId);
    const room = rooms.get(roomId);
    if (!room) return;
    room.members.delete(socket.id);
    socket.to(roomId).emit("peer-left", { id: socket.id });
    if (room.members.size === 0) room.emptySince = Date.now();
    console.log(`[Room ${roomId}] member left (${room.members.size}/${MAX_MEMBERS})`);
  };

  /** Vào room có sẵn, tôn trọng giới hạn 2 người. */
  const enterRoom = (rawRoomId: unknown, isRejoin: boolean, reconnectPeer = false) => {
    const roomId = normalizeRoomId(rawRoomId);
    const room = roomId ? rooms.get(roomId) : undefined;
    if (!roomId || !room) {
      socket.emit("error", { code: "room-not-found", message: "Room not found or expired" });
      return;
    }
    if (!room.members.has(socket.id) && room.members.size >= MAX_MEMBERS) {
      socket.emit("room-full", { roomId });
      console.log(`[Room ${roomId}] rejected: full`);
      return;
    }
    if (socket.data.roomId !== roomId) leaveCurrentRoom();
    room.members.add(socket.id);
    room.emptySince = undefined;
    socket.data.roomId = roomId;
    socket.join(roomId);
    socket.emit("room-joined", { roomId });
    // Vào lại sau khi rớt socket: kết nối P2P có thể vẫn đang chạy tốt,
    // nên dùng event riêng để bên kia tự quyết có cần kết nối lại không.
    if (isRejoin) socket.to(roomId).emit("peer-rejoined", { id: socket.id, reconnectPeer });
    else socket.to(roomId).emit("peer-joined", { id: socket.id });
    console.log(`[Room ${roomId}] ${isRejoin ? "rejoined" : "joined"} (${room.members.size}/${MAX_MEMBERS})`);
  };

  socket.on("create-room", () => {
    leaveCurrentRoom();
    const roomId = newRoomId();
    rooms.set(roomId, { members: new Set([socket.id]), createdAt: Date.now() });
    socket.data.roomId = roomId;
    socket.join(roomId);
    socket.emit("room-created", { roomId });
    console.log(`[Room ${roomId}] created`);
  });

  socket.on("join-room", (msg) => enterRoom(msg?.roomId, false));
  // reconnectPeer: kết nối P2P của người này đã chết, bên kia nên tạo kết nối mới
  socket.on("rejoin-room", (msg) => enterRoom(msg?.roomId, true, msg?.reconnectPeer === true));

  socket.on("signal", (msg) => {
    // Chỉ chuyển tiếp signal của thành viên trong room. Không log payload (chứa IP người dùng).
    const roomId: string | undefined = socket.data.roomId;
    if (!roomId || roomId !== normalizeRoomId(msg?.roomId)) return;
    if (!rooms.get(roomId)?.members.has(socket.id)) return;
    socket.to(roomId).emit("signal", msg.payload);
  });

  socket.on("disconnect", leaveCurrentRoom);
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
