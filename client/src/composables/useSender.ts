import { ref, computed } from "vue";
import { useConnectionStore } from "@/store/connection";
import { connectSignaling, sendSignal, onSignal } from "@/services/signaling";
import {
  createPeerConnection,
  getIceServers,
  addRemoteCandidate,
  setRemoteDescription,
  serialize,
  describeConnectionState,
} from "@/services/webrtc";
import { isCandidate, isDescription, type IncomingSignal } from "@/services/protocol";
import { exposeDebug } from "@/services/debug";

// Không đẩy quá nhiều dữ liệu vào buffer của DataChannel: qua 4G/TURN mạng chậm hơn
// tốc độ đọc file rất nhiều, buffer đầy (~16MB) thì trình duyệt sẽ đóng kênh.
const CHUNK_SIZE = 16 * 1024;
const MAX_BUFFERED = 4 * 1024 * 1024;
const LOW_WATER_MARK = 1024 * 1024;

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
    const onClose = () => { cleanup(); reject(new Error("DataChannel closed")); };
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

  const handleSignal = serialize(async (msg: IncomingSignal) => {
    const pc = store.pc;
    switch (msg.type) {
      case "room-created":
        roomId.value = msg.roomId;
        store.roomId = msg.roomId;
        fileStatus.value = "Room created! Share the link or QR code.";
        return;
      case "peer-joined":
        fileStatus.value = "Peer joined, connecting...";
        await setupPeer();
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
      }
    }
  });

  const setupPeer = async () => {
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
      const msg = describeConnectionState(pc.connectionState);
      if (msg) fileStatus.value = msg;
    };
    pc.oniceconnectionstatechange = () => console.log("[PC] iceConnectionState", pc.iceConnectionState);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal({ type: "signal", roomId: store.roomId, payload: offer });
  };

  const setupDataChannel = (dc: RTCDataChannel) => {
    dc.onopen = () => {
      fileStatus.value = "Connected! Ready to send file.";
      if (fileToSend.value) sendFile(fileToSend.value);
    };
    dc.onclose = () => {
      if (!sending) fileStatus.value = "Connection closed";
    };
    dc.onerror = () => {
      fileStatus.value = "Connection error";
    };
  };

  const sendFile = async (file: File) => {
    if (sending) return;
    sending = true;
    const dc = store.dataChannel!;
    fileStatus.value = `Sending ${file.name}...`;
    try {
      dc.send(JSON.stringify({ type: "metadata", name: file.name, size: file.size, mimeType: file.type }));
      let offset = 0;
      while (offset < file.size) {
        if (dc.bufferedAmount > MAX_BUFFERED) await waitForDrain(dc, LOW_WATER_MARK);
        const data = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
        dc.send(data);
        offset += data.byteLength;
        progress.value = Math.round((offset / file.size) * 100);
        fileStatus.value = `Sending ${file.name}... ${progress.value}%`;
      }
      dc.send(JSON.stringify({ type: "done" }));
      await waitForDrain(dc, 0);
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
      fileStatus.value = "Link copied to clipboard!";
      setTimeout(() => {
        fileStatus.value = "Waiting for peer to join...";
      }, 2000);
    } catch {
      fileStatus.value = "Failed to copy link";
    }
  };

  return { roomId, fileToSend, fileStatus, progress, shareLink, selectFile, createRoom, copyLink };
}
