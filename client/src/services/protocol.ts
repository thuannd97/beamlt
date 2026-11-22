// Kiểu dữ liệu cho tin nhắn signaling (qua Socket.IO) và DataChannel (giữa 2 peer).

/** Payload WebRTC được chuyển tiếp qua signaling server. */
export type SignalPayload = RTCSessionDescriptionInit | { candidate: RTCIceCandidateInit };

/** Tin nhắn signaling client nhận được (đã chuẩn hoá trong services/signaling.ts). */
export type IncomingSignal =
  | { type: "room-created"; roomId: string }
  | { type: "peer-joined"; id: string }
  | { type: "signal"; payload: SignalPayload }
  | { type: "error"; message: string };

/** Tin nhắn signaling client gửi lên server. */
export type OutgoingSignal =
  | { type: "create-room" }
  | { type: "join-room"; roomId: string }
  | { type: "signal"; roomId: string; payload: SignalPayload };

export interface FileMetadata {
  name: string;
  size: number;
  mimeType: string;
}

/** Tin nhắn điều khiển dạng JSON trên DataChannel (dữ liệu file gửi dạng ArrayBuffer). */
export type ControlMessage =
  | ({ type: "metadata" } & FileMetadata)
  | { type: "done" };

export function isDescription(p: SignalPayload): p is RTCSessionDescriptionInit {
  return "type" in p && (p.type === "offer" || p.type === "answer");
}

export function isCandidate(p: SignalPayload): p is { candidate: RTCIceCandidateInit } {
  return "candidate" in p && !!p.candidate;
}

export function parseControlMessage(data: string): ControlMessage | null {
  try {
    const msg = JSON.parse(data);
    return msg && typeof msg.type === "string" ? (msg as ControlMessage) : null;
  } catch {
    return null;
  }
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}
