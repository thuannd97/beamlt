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
  sendControl,
  type FileMetadata,
  type IncomingSignal,
} from "@/services/protocol";
import {
  createSink,
  checkStorage,
  cleanupOpfs,
  preferredSinkKind,
  SinkCancelledError,
  MEMORY_WARN_BYTES,
  type FileSink,
  type SinkKind,
} from "@/services/fileSink";
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

export type ReceiverPhase = "connecting" | "offer" | "receiving" | "done" | "failed";

export function useReceiver() {
  const store = useConnectionStore();
  const fileStatus = ref("");
  const progress = ref(0);
  const fileMetadata = ref<FileMetadata | null>(null);
  const phase = ref<ReceiverPhase>("connecting");
  const sinkKind = ref<SinkKind | null>(null);
  /** Cảnh báo hiển thị cạnh nút Nhận (ví dụ file quá lớn cho RAM) */
  const offerWarning = ref("");
  let sink: FileSink | null = null;

  exposeDebug({ role: "receiver", store, sinkKind, phase });

  const fail = async (message: string) => {
    phase.value = "failed";
    fileStatus.value = message;
    const s = sink;
    sink = null;
    await s?.abort();
  };

  const joinRoom = async (roomId: string) => {
    if (!roomId) return;
    cleanupOpfs();
    store.roomId = roomId.trim().toUpperCase();
    fileStatus.value = "Connecting to server (may take up to a minute if it was asleep)...";
    await connectSignaling();
    fileStatus.value = "Joining room...";
    onSignal(handleSignal);
    // Tạo pc TRƯỚC khi join, để offer đến sau không bị bỏ qua (handleSignal cần store.pc)
    await setupPeer();
    sendSignal({ type: "join-room", roomId: store.roomId });
  };

  const handleSignal = serialize(async (msg: IncomingSignal) => {
    const pc = store.pc;
    switch (msg.type) {
      case "room-joined":
        if (phase.value === "connecting") fileStatus.value = "Joined room, waiting for the sender...";
        return;
      case "room-full":
        phase.value = "failed";
        fileStatus.value = "This room already has two people. Ask the sender for a new link.";
        pc?.close();
        return;
      case "peer-left":
        if (phase.value !== "done" && pc?.connectionState !== "connected") {
          fileStatus.value = "The sender disconnected. Waiting for them to come back...";
        }
        return;
      case "error":
        if (phase.value !== "done") fileStatus.value = `Error: ${msg.message}`;
        return;
      case "signal": {
        if (!pc) return;
        const p = msg.payload;
        if (isDescription(p) && p.type === "offer") {
          // Offer đầu tiên, hoặc offer ICE restart khi mạng chập chờn
          await setRemoteDescription(pc, p);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ type: "signal", roomId: store.roomId, payload: answer });
          if (phase.value === "connecting") fileStatus.value = "Connecting to sender...";
        } else if (isCandidate(p)) {
          await addRemoteCandidate(pc, p.candidate);
        }
        return;
      }
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
      if (phase.value === "done" || phase.value === "failed") return;
      const msg = describeConnectionState(pc.connectionState);
      if (msg) fileStatus.value = msg;
      else if (pc.connectionState === "connected" && phase.value === "receiving") {
        fileStatus.value = `Receiving... ${progress.value}%`;
      }
    };
    pc.oniceconnectionstatechange = () => console.log("[PC-B] iceConnectionState", pc.iceConnectionState);
    pc.ondatachannel = (event) => setupDataChannel(event.channel);
  };

  const setupDataChannel = (dc: RTCDataChannel) => {
    store.dataChannel = dc;
    dc.binaryType = "arraybuffer";
    dc.onopen = () => {
      if (phase.value === "connecting") fileStatus.value = "Connected! Waiting for file...";
    };
    dc.onclose = () => {
      if (phase.value === "receiving") fail("Connection lost during transfer. Ask the sender to try again.");
      else if (phase.value !== "done" && phase.value !== "failed") fileStatus.value = "Connection closed";
    };
    dc.onmessage = (e) => {
      if (typeof e.data === "string") {
        const message = parseControlMessage(e.data);
        if (message?.type === "metadata") onOffer({ name: message.name, size: message.size, mimeType: message.mimeType });
        else if (message?.type === "done") onDone();
      } else if (e.data instanceof ArrayBuffer && sink && phase.value === "receiving") {
        sink.write(e.data);
        const size = fileMetadata.value?.size || 1;
        const pct = Math.floor((sink.bytesWritten / size) * 100);
        if (pct !== progress.value) {
          progress.value = pct;
          fileStatus.value = `Receiving... ${pct}%`;
        }
      }
    };
  };

  const onOffer = (meta: FileMetadata) => {
    fileMetadata.value = meta;
    progress.value = 0;
    phase.value = "offer";
    const kind = preferredSinkKind();
    offerWarning.value =
      kind === "memory" && meta.size > MEMORY_WARN_BYTES
        ? "This browser keeps the whole file in memory. Very large files may crash the page."
        : "";
    fileStatus.value = "The sender wants to send you a file.";
  };

  /** Gọi trực tiếp từ click "Accept" (fs-access cần thao tác người dùng). */
  const accept = async () => {
    const meta = fileMetadata.value;
    const dc = store.dataChannel;
    if (!meta || !dc || phase.value !== "offer") return;
    try {
      if (preferredSinkKind() !== "fs-access") {
        const storageError = await checkStorage(meta.size);
        if (storageError) {
          fileStatus.value = storageError;
          return;
        }
      }
      sink = await createSink(meta);
    } catch (err) {
      if (err instanceof SinkCancelledError) return; // người dùng huỷ hộp thoại Save, vẫn ở bước offer
      fileStatus.value = `Could not prepare the file: ${(err as Error).message}`;
      return;
    }
    sinkKind.value = sink.kind;
    sink.onError = (err) => {
      fail(`Could not save the file: ${err.message}`);
      dc.close();
    };
    phase.value = "receiving";
    fileStatus.value = "Receiving... 0%";
    sendControl(dc, { type: "accept" });
  };

  const reject = () => {
    const dc = store.dataChannel;
    if (phase.value !== "offer" || !dc) return;
    sendControl(dc, { type: "reject" });
    phase.value = "failed";
    fileStatus.value = "You declined the file.";
  };

  const onDone = async () => {
    const s = sink;
    const meta = fileMetadata.value;
    if (!s || !meta || phase.value !== "receiving") return;
    sink = null;
    try {
      if (s.bytesWritten !== meta.size) {
        throw new Error(`incomplete file (${s.bytesWritten} of ${meta.size} bytes)`);
      }
      const file = await s.finish();
      phase.value = "done";
      progress.value = 100;
      if (file) {
        triggerDownload(file, meta.name);
        fileStatus.value = "Download complete! ✅";
      } else {
        fileStatus.value = `Saved ${meta.name} ✅`;
      }
    } catch (err) {
      await s.abort();
      phase.value = "failed";
      fileStatus.value = `Receive failed: ${(err as Error).message}`;
    }
  };

  return { fileStatus, progress, fileMetadata, phase, sinkKind, offerWarning, joinRoom, accept, reject };
}
