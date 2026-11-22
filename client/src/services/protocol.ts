// Kiểu dữ liệu cho tin nhắn signaling (qua Socket.IO) và DataChannel (giữa 2 peer).

/**
 * Payload WebRTC được chuyển tiếp qua signaling server.
 * `gen`: số thế hệ của kết nối P2P do bên gửi tạo. Mỗi lần tạo kết nối mới (sau khi kết nối cũ chết)
 * gen tăng lên; bên nhận thấy offer có gen mới thì bỏ kết nối cũ và tạo kết nối mới.
 */
export type SignalPayload = (RTCSessionDescriptionInit | { candidate: RTCIceCandidateInit }) & { gen?: number };

/** Tin nhắn signaling client nhận được (đã chuẩn hoá trong services/signaling.ts). */
export type IncomingSignal =
  | { type: "room-created"; roomId: string }
  | { type: "room-joined"; roomId: string }
  | { type: "room-full"; roomId: string }
  | { type: "peer-joined"; id: string }
  | { type: "peer-rejoined"; id: string; reconnectPeer?: boolean }
  | { type: "peer-left"; id: string }
  | { type: "signal"; payload: SignalPayload }
  | { type: "error"; code?: string; message: string };

/** Tin nhắn signaling client gửi lên server. */
export type OutgoingSignal =
  | { type: "create-room" }
  | { type: "join-room"; roomId: string }
  /** reconnectPeer: kết nối P2P của mình đã chết, nhờ bên kia tạo kết nối mới */
  | { type: "rejoin-room"; roomId: string; reconnectPeer?: boolean }
  | { type: "signal"; roomId: string; payload: SignalPayload };

export interface FileMetadata {
  name: string;
  size: number;
  mimeType: string;
}

/** Tin nhắn điều khiển dạng JSON trên DataChannel (dữ liệu file gửi dạng ArrayBuffer). */
export type ControlMessage =
  // gửi -> nhận: đề nghị gửi file. transferId giữ nguyên qua các lần kết nối lại
  | ({ type: "metadata"; transferId: string } & FileMetadata)
  | { type: "accept" } // nhận -> gửi: đồng ý, gửi từ đầu
  | { type: "resume"; offset: number } // nhận -> gửi: đã có `offset` byte, gửi tiếp phần còn lại
  | { type: "reject" } // nhận -> gửi: từ chối
  | { type: "done"; sha256: string } // gửi -> nhận: đã gửi hết dữ liệu, kèm hash toàn file
  | { type: "received"; ok: boolean }; // nhận -> gửi: đã nhận đủ, hash khớp hay không

export function sendControl(dc: RTCDataChannel, msg: ControlMessage) {
  dc.send(JSON.stringify(msg));
}

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
