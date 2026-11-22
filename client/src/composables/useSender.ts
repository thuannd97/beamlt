import { ref, computed } from "vue";
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
} from "@/services/webrtc";
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
const CHUNK_SIZE = 16 * 1024;
const MAX_BUFFERED = 4 * 1024 * 1024;
const LOW_WATER_MARK = 1024 * 1024;
const MAX_ICE_RESTARTS = 3;

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
    const onClose = () => { cleanup(); reject(new Error("Connection lost during transfer")); };
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
  let sending = false;
  let finished = false;
  let iceRestarts = 0;
  let stopWatching: (() => void) | undefined;
  const run = createQueue();

  exposeDebug({ role: "sender", store });

  const shareLink = computed(() => {
    if (!roomId.value) return "";
    return `${window.location.origin}${window.location.pathname}?room=${roomId.value}`;
  });

  const selectFile = (file: File | null | undefined) => {
    if (!file) return;
    fileToSend.value = file;
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
        if (finished) return;
        fileStatus.value = "Receiver joined, connecting...";
        await setupPeer();
        return;
      case "peer-rejoined":
        // Bên nhận chỉ rớt socket: nếu P2P vẫn chạy thì để nguyên
        if (!finished && peerIsBroken()) {
          fileStatus.value = "Receiver is back, reconnecting...";
          await setupPeer();
        }
        return;
      case "peer-left":
        if (!finished && pc?.connectionState !== "connected") {
          fileStatus.value = "Receiver disconnected. Waiting for them to come back...";
        }
        return;
      case "error":
        fileStatus.value = `Error: ${msg.message}`;
        return;
      case "signal": {
        if (!pc) return;
        const p = msg.payload;
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
    sendSignal({ type: "signal", roomId: store.roomId, payload: offer });
  };

  const setupPeer = async () => {
    // Có kết nối cũ (bên nhận tải lại trang / vào lại): đóng trước khi tạo mới
    stopWatching?.();
    store.dataChannel?.close();
    store.pc?.close();
    iceRestarts = 0;

    const pc = await createPeerConnection();
    store.pc = pc;
    const dc = pc.createDataChannel("file");
    store.dataChannel = dc;
    setupDataChannel(dc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal({ type: "signal", roomId: store.roomId, payload: { candidate: e.candidate.toJSON() } });
      }
    };
    pc.onconnectionstatechange = () => {
      console.log("[PC] connectionState", pc.connectionState);
      if (pc.connectionState === "connected") iceRestarts = 0;
      if (finished) return;
      const msg = describeConnectionState(pc.connectionState);
      if (msg) fileStatus.value = msg;
    };
    pc.oniceconnectionstatechange = () => console.log("[PC] iceConnectionState", pc.iceConnectionState);
    // Mạng chập chờn / đổi WiFi -> 4G: thử ICE restart, giữ nguyên DataChannel
    stopWatching = watchForIceRestart(pc, () => {
      if (finished || store.pc !== pc || iceRestarts >= MAX_ICE_RESTARTS) return;
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
      if (!file) return;
      sendControl(dc, { type: "metadata", name: file.name, size: file.size, mimeType: file.type });
      fileStatus.value = "Connected! Waiting for the receiver to accept...";
    };
    dc.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const msg = parseControlMessage(e.data);
      if (msg?.type === "accept" && fileToSend.value) sendFile(dc, fileToSend.value);
      else if (msg?.type === "reject") fileStatus.value = "The receiver declined the file.";
    };
    dc.onclose = () => {
      if (!sending && !finished && store.dataChannel === dc) fileStatus.value = "Connection closed";
    };
  };

  const sendFile = async (dc: RTCDataChannel, file: File) => {
    if (sending) return;
    sending = true;
    progress.value = 0;
    fileStatus.value = `Sending ${file.name}...`;
    try {
      let offset = 0;
      while (offset < file.size) {
        if (dc.readyState !== "open") throw new Error("Connection lost during transfer");
        if (dc.bufferedAmount > MAX_BUFFERED) await waitForDrain(dc, LOW_WATER_MARK);
        const data = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
        dc.send(data);
        offset += data.byteLength;
        progress.value = Math.round((offset / file.size) * 100);
        fileStatus.value = `Sending ${file.name}... ${progress.value}%`;
      }
      sendControl(dc, { type: "done" });
      await waitForDrain(dc, 0);
      finished = true;
      fileStatus.value = "File sent! ✅";
    } catch (err) {
      console.error("[Send] Error:", err);
      fileStatus.value = `Send failed: ${(err as Error).message}`;
    } finally {
      sending = false;
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

  return { roomId, fileToSend, fileStatus, progress, shareLink, selectFile, createRoom, copyLink };
}
