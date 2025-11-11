import { io, Socket } from "socket.io-client";
import { config } from "../config";

let socket: Socket | null = null;
let signalCallback: ((msg: any) => void) | null = null;

export const connectSignaling = async () => {
  if (socket) return;
  socket = io(config.signalingUrl);
  console.log("[Signaling] Connecting to:", config.signalingUrl);

  socket.on("connect", () => console.log("[Signaling] Connected:", socket!.id));
  socket.on("disconnect", () => console.log("[Signaling] Disconnected"));
  socket.on("room-created", (msg) => signalCallback?.({ type: "room-created", ...msg }));
  socket.on("peer-joined", (msg) => signalCallback?.({ type: "peer-joined", ...msg }));
  socket.on("signal", (payload) => signalCallback?.({ type: "signal", payload }));
};

export const sendSignal = (msg: any) => {
  if (!socket) return console.warn("[Signaling] Socket not connected");
  socket.emit(msg.type === "signal" ? "signal" : msg.type, msg);
  console.log("[Signaling] Sent:", msg);
};

export const onSignal = (callback: (msg: any) => void) => { signalCallback = callback; };
