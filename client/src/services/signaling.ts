import { io, Socket } from "socket.io-client";
import { config } from "../config";
import type { IncomingSignal, OutgoingSignal } from "./protocol";

let socket: Socket | null = null;
let signalCallback: ((msg: IncomingSignal) => void) | null = null;

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

  socket.on("connect", () => console.log("[Signaling] Connected:", socket!.id));
  socket.on("connect_error", (err) => console.warn("[Signaling] Connect error (retrying):", err.message));
  socket.on("disconnect", () => console.log("[Signaling] Disconnected"));
  socket.on("error", (msg) => emit({ type: "error", message: String(msg?.message ?? msg) }));
  socket.on("room-created", (msg) => emit({ type: "room-created", roomId: msg.roomId }));
  socket.on("peer-joined", (msg) => emit({ type: "peer-joined", id: msg.id }));
  socket.on("signal", (payload) => emit({ type: "signal", payload }));
  await connected;
};

export const sendSignal = (msg: OutgoingSignal) => {
  if (!socket) return console.warn("[Signaling] Socket not connected");
  socket.emit(msg.type, msg);
  console.log("[Signaling] Sent:", msg.type);
};

export const onSignal = (callback: (msg: IncomingSignal) => void) => {
  signalCallback = callback;
};
