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
    return "❌ Không kết nối được tới thiết bị kia (TURN server có thể chưa được cấu hình).";
  }
  if (state === "disconnected") return "⚠️ Mất kết nối, đang thử lại...";
  return null;
}
