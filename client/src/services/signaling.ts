import { io, Socket } from "socket.io-client";
import { config } from "../config";

let socket: Socket | null = null;
let signalCallback: ((msg: any) => void) | null = null;

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
  socket.on("error", (msg) => signalCallback?.({ type: "error", ...msg }));
  socket.on("disconnect", () => console.log("[Signaling] Disconnected"));
  socket.on("room-created", (msg) => signalCallback?.({ type: "room-created", ...msg }));
  socket.on("peer-joined", (msg) => signalCallback?.({ type: "peer-joined", ...msg }));
  socket.on("signal", (payload) => signalCallback?.({ type: "signal", payload }));
  await connected;
};

export const sendSignal = (msg: any) => {
  if (!socket) return console.warn("[Signaling] Socket not connected");
  socket.emit(msg.type === "signal" ? "signal" : msg.type, msg);
  console.log("[Signaling] Sent:", msg);
};

export const onSignal = (callback: (msg: any) => void) => { signalCallback = callback; };
