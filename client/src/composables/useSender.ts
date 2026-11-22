import { ref, computed } from "vue";
import { createSHA256 } from "hash-wasm";
import { useConnectionStore } from "@/store/connection";
import { connectSignaling, sendSignal, onSignal } from "@/services/signaling";
import {
  createPeerConnection,
  getIceServers,
  addRemoteCandidate,
  setRemoteDescription,
  serialize,
  createQueue,
  describeConnectionState,
  watchForIceRestart,
  chunkSizeFor,
  getConnectionType,
  type ConnectionType,
} from "@/services/webrtc";
import { createTransferMeter, createStatsText, formatSpeed } from "@/services/transferStats";
import {
  isCandidate,
  isDescription,
  parseControlMessage,
  sendControl,
  type IncomingSignal,
} from "@/services/protocol";
import { exposeDebug } from "@/services/debug";

// Không đẩy quá nhiều dữ liệu vào buffer của DataChannel: qua 4G/TURN mạng chậm hơn
// tốc độ đọc file rất nhiều, buffer đầy (~16MB) thì trình duyệt sẽ đóng kênh.
const MAX_BUFFERED = 4 * 1024 * 1024;
const LOW_WATER_MARK = 1024 * 1024;
const MAX_ICE_RESTARTS = 3;
const HASH_READ_SIZE = 4 * 1024 * 1024;

class TransferAborted extends Error {}

function waitForDrain(dc: RTCDataChannel, threshold: number) {
  return new Promise<void>((resolve, reject) => {
    if (dc.bufferedAmount <= threshold) return resolve();
    const prev = dc.bufferedAmountLowThreshold;
    dc.bufferedAmountLowThreshold = threshold;
    const cleanup = () => {
      dc.removeEventListener("bufferedamountlow", onLow);
      dc.removeEventListener("close", onClose);
      dc.bufferedAmountLowThreshold = prev;
    };
    const onLow = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new TransferAborted("Connection lost during transfer")); };
    dc.addEventListener("bufferedamountlow", onLow);
    dc.addEventListener("close", onClose);
  });
}

export function useSender() {
  const store = useConnectionStore();
  const roomId = ref("");
  const fileToSend = ref<File | null>(null);
  const fileStatus = ref("");
  const progress = ref(0);
  /** "12.3 MB/s · 0:42 left" */
  const statsText = ref("");
  const connectionType = ref<ConnectionType | null>(null);
  /** Bên nhận đã xác nhận nhận đủ và đúng hash */
  const finished = ref(false);
  let transferId = "";
  let gen = 0; // thế hệ kết nối P2P hiện tại
  let activeSend = 0; // id của vòng gửi đang chạy (vòng cũ tự dừng khi có vòng mới)
  let iceRestarts = 0;
  let stopWatching: (() => void) | undefined;
  const run = createQueue();

  exposeDebug({ role: "sender", store, connectionType, finished });

  const shareLink = computed(() => {
    if (!roomId.value) return "";
    return `${window.location.origin}${window.location.pathname}?room=${roomId.value}`;
  });

  const selectFile = (file: File | null | undefined) => {
    if (!file) return;
    fileToSend.value = file;
    transferId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    fileStatus.value = "File selected. Click 'Create Room & Share' to start.";
  };

  const createRoom = async () => {
    if (!fileToSend.value) {
      fileStatus.value = "Please select a file first!";
      return;
    }
    fileStatus.value = "Connecting to server (may take up to a minute if it was asleep)...";
    await connectSignaling();
    getIceServers(); // prefetch để sẵn sàng khi peer join
    onSignal(handleSignal);
    sendSignal({ type: "create-room" });
  };

  /** Đọc loại kết nối (thử lại vì stats có thể chưa sẵn ngay khi vừa connected) */
  const refreshConnectionType = async (pc: RTCPeerConnection) => {
    for (let i = 0; i < 3 && store.pc === pc; i++) {
      const type = await getConnectionType(pc);
      if (type) {
        connectionType.value = type;
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  const peerIsBroken = () => {
    const state = store.pc?.connectionState;
    return !store.pc || state === "failed" || state === "closed" || store.dataChannel?.readyState === "closed";
  };

  const handleSignal = serialize(async (msg: IncomingSignal) => {
    const pc = store.pc;
    switch (msg.type) {
      case "room-created":
        roomId.value = msg.roomId;
        store.roomId = msg.roomId;
        fileStatus.value = "Room created! Share the link or QR code.";
        return;
      case "peer-joined":
        if (finished.value) return;
        fileStatus.value = "Receiver joined, connecting...";
        await setupPeer();
        return;
      case "peer-rejoined":
        // Bên nhận chỉ rớt socket thì P2P có thể vẫn chạy: chỉ kết nối lại khi cần
        if (!finished.value && (msg.reconnectPeer || peerIsBroken())) {
          fileStatus.value = "Reconnecting to the receiver...";
          await setupPeer();
        }
        return;
      case "peer-left":
        if (!finished.value && pc?.connectionState !== "connected") {
          fileStatus.value = "Receiver disconnected. Waiting for them to come back...";
        }
        return;
      case "error":
        fileStatus.value = `Error: ${msg.message}`;
        return;
      case "signal": {
        const p = msg.payload;
        if (!pc || (p.gen !== undefined && p.gen !== gen)) return; // tín hiệu của kết nối cũ
        if (isDescription(p) && p.type === "answer") {
          if (pc.signalingState === "have-local-offer") await setRemoteDescription(pc, p);
          else console.warn("Skip setRemoteDescription(answer), wrong signalingState", pc.signalingState);
        } else if (isCandidate(p)) {
          await addRemoteCandidate(pc, p.candidate);
        }
        return;
      }
    }
  }, run);

  const sendOffer = async (pc: RTCPeerConnection, iceRestart = false) => {
    const offer = await pc.createOffer({ iceRestart });
    await pc.setLocalDescription(offer);
    sendSignal({ type: "signal", roomId: store.roomId, payload: { type: offer.type, sdp: offer.sdp, gen } });
  };

  /** Tạo kết nối P2P mới (lần đầu, hoặc khi kết nối cũ đã chết). */
  const setupPeer = async () => {
    stopWatching?.();
    // Bỏ tham chiếu TRƯỚC khi đóng: sự kiện close đến bất đồng bộ, onclose của kênh cũ
    // phải thấy nó không còn là kênh hiện tại, nếu không sẽ gọi setupPeer lặp lại.
    const oldDc = store.dataChannel;
    const oldPc = store.pc;
    store.dataChannel = null;
    store.pc = null;
    oldDc?.close();
    oldPc?.close();
    iceRestarts = 0;
    gen++;
    const myGen = gen;

    const pc = await createPeerConnection();
    store.pc = pc;
    const dc = pc.createDataChannel("file");
    store.dataChannel = dc;
    setupDataChannel(dc);

    pc.onicecandidate = (e) => {
      if (e.candidate && store.pc === pc) {
        sendSignal({ type: "signal", roomId: store.roomId, payload: { candidate: e.candidate.toJSON(), gen: myGen } });
      }
    };
    pc.onconnectionstatechange = () => {
      if (store.pc !== pc) return;
      console.log("[PC] connectionState", pc.connectionState);
      if (pc.connectionState === "connected") {
        iceRestarts = 0;
        refreshConnectionType(pc); // có thể đổi sau ICE restart
      }
      if (finished.value) return;
      const msg = describeConnectionState(pc.connectionState);
      if (msg) fileStatus.value = msg;
    };
    pc.oniceconnectionstatechange = () => console.log("[PC] iceConnectionState", pc.iceConnectionState);
    // Mạng chập chờn / đổi WiFi -> 4G: thử ICE restart trước (giữ nguyên DataChannel).
    // Hết lượt thử mà vẫn hỏng thì tạo kết nối mới, bên nhận sẽ xin gửi tiếp.
    stopWatching = watchForIceRestart(pc, () => {
      if (finished.value || store.pc !== pc) return;
      if (iceRestarts >= MAX_ICE_RESTARTS) {
        console.log("[PC] ICE restarts exhausted, creating a new connection");
        run(setupPeer);
        return;
      }
      iceRestarts++;
      console.log(`[PC] ICE restart #${iceRestarts}`);
      fileStatus.value = "Connection unstable, trying to reconnect...";
      run(() => sendOffer(pc, true));
    });

    await sendOffer(pc);
  };

  const setupDataChannel = (dc: RTCDataChannel) => {
    dc.onopen = () => {
      const file = fileToSend.value;
      if (!file || finished.value) return;
      sendControl(dc, { type: "metadata", transferId, name: file.name, size: file.size, mimeType: file.type });
      fileStatus.value = "Connected! Waiting for the receiver to accept...";
    };
    dc.onmessage = (e) => {
      if (typeof e.data !== "string" || !fileToSend.value) return;
      const msg = parseControlMessage(e.data);
      if (msg?.type === "accept") sendFile(dc, fileToSend.value, 0);
      else if (msg?.type === "resume") sendFile(dc, fileToSend.value, msg.offset);
      else if (msg?.type === "reject") fileStatus.value = "The receiver declined the file.";
      else if (msg?.type === "received") {
        if (msg.ok) {
          finished.value = true;
          fileStatus.value = "File sent and verified! ✅";
        } else {
          fileStatus.value = "❌ The file arrived corrupted. Create a new room to try again.";
        }
      }
    };
    dc.onclose = () => {
      if (store.dataChannel !== dc || finished.value) return;
      // Kênh chết giữa chừng: tạo kết nối mới (nếu bên nhận vẫn trong room sẽ gửi tiếp được)
      if (activeSend || store.pc?.connectionState !== "closed") {
        fileStatus.value = "Connection lost, reconnecting...";
        run(setupPeer);
      }
    };
  };

  /** Hash `length` byte đầu của file (khi gửi tiếp từ giữa chừng). */
  const hashPrefix = async (file: File, length: number, isCurrent: () => boolean) => {
    const hasher = await createSHA256();
    for (let pos = 0; pos < length; pos += HASH_READ_SIZE) {
      if (!isCurrent()) throw new TransferAborted("superseded");
      const buf = await file.slice(pos, Math.min(length, pos + HASH_READ_SIZE)).arrayBuffer();
      hasher.update(new Uint8Array(buf));
    }
    return hasher;
  };

  const sendFile = async (dc: RTCDataChannel, file: File, startOffset: number) => {
    const sendId = ++activeSend;
    const isCurrent = () => activeSend === sendId && store.dataChannel === dc;
    const resuming = startOffset > 0;
    if (startOffset < 0 || startOffset > file.size) startOffset = 0;
    progress.value = Math.round((startOffset / file.size) * 100);
    statsText.value = "";
    fileStatus.value = resuming ? `Resuming from ${progress.value}%...` : `Sending ${file.name}...`;
    const chunkSize = chunkSizeFor(store.pc!);
    const updateStats = createStatsText(createTransferMeter(), (t) => (statsText.value = t));
    const startedAt = performance.now();
    try {
      const hasher = resuming ? await hashPrefix(file, startOffset, isCurrent) : await createSHA256();
      let offset = startOffset;
      while (offset < file.size) {
        if (!isCurrent()) throw new TransferAborted("superseded");
        if (dc.readyState !== "open") throw new TransferAborted("Connection lost during transfer");
        if (dc.bufferedAmount > MAX_BUFFERED) await waitForDrain(dc, LOW_WATER_MARK);
        const data = await file.slice(offset, offset + chunkSize).arrayBuffer();
        hasher.update(new Uint8Array(data));
        dc.send(data);
        offset += data.byteLength;
        // Byte đã thực sự rời khỏi buffer, không tính phần còn chờ trong bufferedAmount
        updateStats(Math.max(startOffset, offset - dc.bufferedAmount) - startOffset, file.size - startOffset);
        progress.value = Math.round((offset / file.size) * 100);
        fileStatus.value = `Sending ${file.name}... ${progress.value}%`;
      }
      sendControl(dc, { type: "done", sha256: hasher.digest("hex") });
      await waitForDrain(dc, 0);
      const seconds = (performance.now() - startedAt) / 1000;
      statsText.value = seconds > 0 ? `Average ${formatSpeed((file.size - startOffset) / seconds)}` : "";
      if (!finished.value) fileStatus.value = "All data sent, waiting for the receiver to verify...";
    } catch (err) {
      // Kênh bị đóng giữa lúc đang đọc chunk -> dc.send ném InvalidStateError: cũng là mất kết nối
      if (err instanceof TransferAborted || dc.readyState !== "open" || !isCurrent()) {
        console.log("[Send] stopped:", (err as Error).message);
        return; // kết nối mới sẽ gửi tiếp
      }
      console.error("[Send] Error:", err);
      fileStatus.value = `Send failed: ${(err as Error).message}`;
    } finally {
      if (activeSend === sendId) activeSend = 0;
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink.value);
      const copied = "Link copied to clipboard!";
      const previous = fileStatus.value;
      fileStatus.value = copied;
      // Chỉ trả lại trạng thái cũ nếu trong 2s không có trạng thái mới
      setTimeout(() => {
        if (fileStatus.value === copied) fileStatus.value = previous;
      }, 2000);
    } catch {
      fileStatus.value = "Failed to copy link";
    }
  };

  return {
    roomId,
    fileToSend,
    fileStatus,
    progress,
    statsText,
    connectionType,
    shareLink,
    selectFile,
    createRoom,
    copyLink,
  };
}
