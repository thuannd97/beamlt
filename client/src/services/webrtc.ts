import { config } from "../config";

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

let iceServersPromise: Promise<RTCIceServer[]> | null = null;

async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`${config.signalingUrl}/ice-servers`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const servers = await res.json();
    if (!Array.isArray(servers) || servers.length === 0) throw new Error("Empty ICE server list");
    const hasTurn = servers.some((s: RTCIceServer) =>
      [s.urls].flat().some((u) => String(u).startsWith("turn")),
    );
    if (!hasTurn) console.warn("[ICE] Server returned no TURN server — transfers over 4G/internet may fail");
    return servers;
  } catch (err) {
    console.warn("[ICE] Failed to fetch ICE servers, using STUN fallback:", err);
    iceServersPromise = null; // cho phép thử lại lần sau
    return FALLBACK_ICE_SERVERS;
  }
}

/** Lấy danh sách STUN/TURN từ signaling server (cache trong module). */
export function getIceServers(): Promise<RTCIceServer[]> {
  if (!iceServersPromise) iceServersPromise = fetchIceServers();
  return iceServersPromise;
}

/**
 * Tạo RTCPeerConnection với ICE servers từ server.
 * Thêm `&relay=1` vào URL để ép đi qua TURN (dùng khi test).
 */
export async function createPeerConnection(): Promise<RTCPeerConnection> {
  const forceRelay = new URLSearchParams(window.location.search).get("relay") === "1";
  return new RTCPeerConnection({
    iceServers: await getIceServers(),
    ...(forceRelay ? { iceTransportPolicy: "relay" as const } : {}),
  });
}

// ICE candidate đến trước khi có remote description phải được giữ lại,
// nếu không addIceCandidate sẽ lỗi và candidate (thường là srflx/relay) bị mất.
const pendingCandidates = new WeakMap<RTCPeerConnection, RTCIceCandidateInit[]>();

export async function addRemoteCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidateInit) {
  if (!pc.remoteDescription) {
    const list = pendingCandidates.get(pc) ?? [];
    list.push(candidate);
    pendingCandidates.set(pc, list);
    return;
  }
  try {
    await pc.addIceCandidate(candidate);
  } catch (err) {
    console.warn("[ICE] addIceCandidate failed:", err);
  }
}

export async function setRemoteDescription(pc: RTCPeerConnection, desc: RTCSessionDescriptionInit) {
  await pc.setRemoteDescription(desc);
  const list = pendingCandidates.get(pc) ?? [];
  pendingCandidates.delete(pc);
  for (const c of list) await addRemoteCandidate(pc, c);
}

/** Hàng đợi chạy các tác vụ async lần lượt (signal, ICE restart...) để không đè nhau. */
export function createQueue() {
  let chain = Promise.resolve();
  return (task: () => Promise<void>) => {
    chain = chain.then(task).catch((err) => console.error("[Queue] task error:", err));
    return chain;
  };
}

/** Đảm bảo các tin signal được xử lý tuần tự, đúng thứ tự nhận. */
export function serialize<T>(fn: (msg: T) => Promise<void>, run = createQueue()): (msg: T) => void {
  return (msg: T) => {
    run(() => fn(msg));
  };
}

/**
 * Theo dõi kết nối và gọi `restart` khi cần ICE restart:
 * ngay khi "failed", hoặc khi "disconnected" kéo dài quá `graceMs`.
 */
export function watchForIceRestart(pc: RTCPeerConnection, restart: () => void, graceMs = 5000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    clearTimeout(timer);
    if (pc.connectionState === "failed") restart();
    else if (pc.connectionState === "disconnected") {
      timer = setTimeout(() => {
        if (pc.connectionState === "disconnected") restart();
      }, graceMs);
    }
  };
  pc.addEventListener("connectionstatechange", check);
  return () => {
    clearTimeout(timer);
    pc.removeEventListener("connectionstatechange", check);
  };
}

/** Thông báo dễ hiểu khi kết nối P2P thất bại. */
export function describeConnectionState(state: RTCPeerConnectionState): string | null {
  if (state === "failed") {
    return "❌ Could not connect to the other device (the TURN server may be unavailable).";
  }
  if (state === "disconnected") return "⚠️ Connection lost, trying to reconnect...";
  return null;
}

export type ConnectionType = "direct" | "relay";

/**
 * Kết nối đang đi thẳng giữa 2 thiết bị hay qua TURN (relay)?
 * Đọc candidate-pair đang được dùng trong getStats().
 */
export async function getConnectionType(pc: RTCPeerConnection): Promise<ConnectionType | null> {
  try {
    const stats = await pc.getStats();
    let pair: RTCIceCandidatePairStats | undefined;
    stats.forEach((r) => {
      if (r.type === "transport" && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
    });
    // Firefox không có selectedCandidatePairId trên transport
    if (!pair) {
      stats.forEach((r) => {
        if (r.type === "candidate-pair" && (r.selected || (r.nominated && r.state === "succeeded"))) pair = r;
      });
    }
    if (!pair) return null;
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    if (!local || !remote) return null;
    return local.candidateType === "relay" || remote.candidateType === "relay" ? "relay" : "direct";
  } catch {
    return null;
  }
}

export function describeConnectionType(type: ConnectionType | null): string {
  if (type === "relay") return "🔁 Via relay server (TURN)";
  if (type === "direct") return "⚡ Direct connection";
  return "";
}

/** Kích thước chunk: tối đa 64 KB, không vượt giới hạn bên kia công bố (Safari/Firefox khác Chrome). */
export function chunkSizeFor(pc: RTCPeerConnection): number {
  const max = pc.sctp?.maxMessageSize;
  if (!max || !Number.isFinite(max)) return 16 * 1024;
  return Math.max(16 * 1024, Math.min(max, 64 * 1024));
}
