import { ref } from "vue";
import { useConnectionStore } from "@/store/connection";
import { connectSignaling, sendSignal, onSignal } from "@/services/signaling";
import {
  createPeerConnection,
  addRemoteCandidate,
  setRemoteDescription,
  serialize,
  describeConnectionState,
} from "@/services/webrtc";
import {
  isCandidate,
  isDescription,
  parseControlMessage,
  type FileMetadata,
  type IncomingSignal,
} from "@/services/protocol";
import { exposeDebug } from "@/services/debug";

function triggerDownload(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari/iPad cần URL còn sống một lúc sau click
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function useReceiver() {
  const store = useConnectionStore();
  const fileStatus = ref("");
  const progress = ref(0);
  const fileMetadata = ref<FileMetadata | null>(null);
  let receivedChunks: ArrayBuffer[] = [];
  let receivedSize = 0;

  exposeDebug({ role: "receiver", store });

  const joinRoom = async (roomId: string) => {
    if (!roomId) return;
    store.roomId = roomId;
    fileStatus.value = "Connecting to server (may take up to a minute if it was asleep)...";
    await connectSignaling();
    fileStatus.value = "Joining room...";
    onSignal(handleSignal);
    // Tạo pc TRƯỚC khi join, để offer đến sau không bị bỏ qua (handleSignal cần store.pc)
    await setupPeer();
    sendSignal({ type: "join-room", roomId });
  };

  const handleSignal = serialize(async (msg: IncomingSignal) => {
    if (msg.type === "error") {
      fileStatus.value = `Error: ${msg.message}`;
      return;
    }
    const pc = store.pc;
    if (!pc || msg.type !== "signal") return;
    const p = msg.payload;
    if (isDescription(p) && p.type === "offer") {
      await setRemoteDescription(pc, p);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ type: "signal", roomId: store.roomId, payload: answer });
      fileStatus.value = "Connecting to sender...";
    } else if (isCandidate(p)) {
      await addRemoteCandidate(pc, p.candidate);
    }
  });

  const setupPeer = async () => {
    const pc = await createPeerConnection();
    store.pc = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal({ type: "signal", roomId: store.roomId, payload: { candidate: e.candidate.toJSON() } });
      }
    };
    pc.onconnectionstatechange = () => {
      console.log("[PC-B] connectionState", pc.connectionState);
      const msg = describeConnectionState(pc.connectionState);
      if (msg) fileStatus.value = msg;
    };
    pc.oniceconnectionstatechange = () => console.log("[PC-B] iceConnectionState", pc.iceConnectionState);
    pc.ondatachannel = (event) => setupDataChannel(event.channel);
  };

  const setupDataChannel = (dc: RTCDataChannel) => {
    store.dataChannel = dc;
    dc.binaryType = "arraybuffer";
    dc.onopen = () => {
      fileStatus.value = "Connected! Waiting for file...";
    };
    dc.onclose = () => {
      fileStatus.value = "Connection closed";
    };
    dc.onmessage = (e) => {
      if (typeof e.data === "string") {
        const message = parseControlMessage(e.data);
        if (message?.type === "metadata") {
          const { name, size, mimeType } = message;
          fileMetadata.value = { name, size, mimeType };
          receivedChunks = [];
          receivedSize = 0;
          progress.value = 0;
          fileStatus.value = "Receiving...";
        } else if (message?.type === "done") {
          if (receivedChunks.length > 0 && fileMetadata.value) {
            const blob = new Blob(receivedChunks, {
              type: fileMetadata.value.mimeType || "application/octet-stream",
            });
            receivedChunks = [];
            triggerDownload(blob, fileMetadata.value.name);
            fileStatus.value = "Download complete! ✅";
          }
        }
      } else if (e.data instanceof ArrayBuffer) {
        receivedChunks.push(e.data);
        receivedSize += e.data.byteLength;
        if (fileMetadata.value) {
          progress.value = Math.round((receivedSize / fileMetadata.value.size) * 100);
          fileStatus.value = `Receiving... ${progress.value}%`;
        }
      }
    };
  };

  return { fileStatus, progress, fileMetadata, joinRoom };
}
