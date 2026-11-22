import { io, Socket } from "socket.io-client";
import { config } from "../config";
import type { IncomingSignal, OutgoingSignal } from "./protocol";

let socket: Socket | null = null;
let signalCallback: ((msg: IncomingSignal) => void) | null = null;
/** Room đang ở, để tự vào lại khi socket kết nối lại (rớt mạng, đổi WiFi -> 4G...). */
let currentRoomId: string | null = null;

const emit = (msg: IncomingSignal) => signalCallback?.(msg);

/**
 * Kết nối tới signaling server và chờ tới khi kết nối xong
 * (Render free tier có thể mất ~30-60s để thức dậy).
 */
export const connectSignaling = async () => {
  if (socket) {
    if (!socket.connected) await new Promise<void>((resolve) => socket!.once("connect", () => resolve()));
    return;
  }
  socket = io(config.signalingUrl);
  console.log("[Signaling] Connecting to:", config.signalingUrl);
  const connected = new Promise<void>((resolve) => socket!.once("connect", () => resolve()));

  let hasConnectedBefore = false;
  socket.on("connect", () => {
    console.log("[Signaling] Connected:", socket!.id);
    if (hasConnectedBefore && currentRoomId) {
      console.log("[Signaling] Reconnected, rejoining room", currentRoomId);
      socket!.emit("rejoin-room", { roomId: currentRoomId });
    }
    hasConnectedBefore = true;
  });
  socket.on("connect_error", (err) => console.warn("[Signaling] Connect error (retrying):", err.message));
  socket.on("disconnect", (reason) => console.log("[Signaling] Disconnected:", reason));

  socket.on("error", (msg) => {
    if (msg?.code === "room-not-found") currentRoomId = null;
    emit({ type: "error", code: msg?.code, message: String(msg?.message ?? msg) });
  });
  socket.on("room-created", (msg) => {
    currentRoomId = msg.roomId;
    emit({ type: "room-created", roomId: msg.roomId });
  });
  socket.on("room-joined", (msg) => {
    currentRoomId = msg.roomId;
    emit({ type: "room-joined", roomId: msg.roomId });
  });
  socket.on("room-full", (msg) => emit({ type: "room-full", roomId: msg.roomId }));
  socket.on("peer-joined", (msg) => emit({ type: "peer-joined", id: msg.id }));
  socket.on("peer-rejoined", (msg) => emit({ type: "peer-rejoined", id: msg.id, reconnectPeer: msg.reconnectPeer }));
  socket.on("peer-left", (msg) => emit({ type: "peer-left", id: msg.id }));
  socket.on("signal", (payload) => emit({ type: "signal", payload }));
  await connected;
};

export const sendSignal = (msg: OutgoingSignal) => {
  if (!socket) return console.warn("[Signaling] Socket not connected");
  socket.emit(msg.type, msg);
};

/** Kết nối P2P của mình đã chết: nhờ bên kia tạo kết nối mới (server chuyển thành peer-rejoined). */
export const requestPeerReconnect = () => {
  if (!socket?.connected || !currentRoomId) return false;
  socket.emit("rejoin-room", { roomId: currentRoomId, reconnectPeer: true });
  return true;
};

export const onSignal = (callback: (msg: IncomingSignal) => void) => {
  signalCallback = callback;
};
