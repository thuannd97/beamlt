import { ref } from "vue";
import { createSHA256, type IHasher } from "hash-wasm";
import { useConnectionStore } from "@/store/connection";
import { connectSignaling, sendSignal, onSignal, requestPeerReconnect } from "@/services/signaling";
import {
  createPeerConnection,
  addRemoteCandidate,
  setRemoteDescription,
  serialize,
  describeConnectionState,
  getConnectionType,
  type ConnectionType,
} from "@/services/webrtc";
import { createTransferMeter, createStatsText, formatSpeed } from "@/services/transferStats";
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
  isMobile,
  SinkCancelledError,
  MEMORY_WARN_BYTES,
  type FileSink,
  type SinkKind,
} from "@/services/fileSink";
import { exposeDebug } from "@/services/debug";

/** Chờ bao lâu sau khi mất kết nối thì tự xin kết nối lại / bỏ cuộc */
const RECONNECT_REQUEST_DELAY_MS = 3_000;
const RECONNECT_RETRY_MS = 10_000;
const RESUME_GIVE_UP_MS = 2 * 60_000;

export function triggerDownload(file: Blob, name: string) {
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

export type ReceiverPhase = "connecting" | "offer" | "receiving" | "interrupted" | "done" | "failed";

export function useReceiver() {
  const store = useConnectionStore();
  const fileStatus = ref("");
  const progress = ref(0);
  const fileMetadata = ref<FileMetadata | null>(null);
  const phase = ref<ReceiverPhase>("connecting");
  const sinkKind = ref<SinkKind | null>(null);
  /** Cảnh báo hiển thị cạnh nút Nhận (ví dụ file quá lớn cho RAM) */
  const offerWarning = ref("");
  /** "12.3 MB/s · 0:42 left" */
  const statsText = ref("");
  const connectionType = ref<ConnectionType | null>(null);
  /** File đã nhận xong (để tải lại / chia sẻ). null nếu đã lưu thẳng ra đĩa. */
  const receivedFile = ref<File | null>(null);
  /** Trên điện thoại: dùng Share sheet để Lưu ảnh / Lưu vào Tệp thay vì tự tải về */
  const canShareFile = ref(false);
  /** Số lần đã gửi tiếp sau khi bị ngắt (cho test / hiển thị) */
  const resumeCount = ref(0);

  let sink: FileSink | null = null;
  let hasher: IHasher | null = null;
  let transferId = "";
  let gen = -1; // thế hệ kết nối P2P đang dùng (do bên gửi đặt)
  let updateStats: ((bytes: number, size: number, force?: boolean) => void) | null = null;
  let startedAt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let interruptedAt = 0;

  exposeDebug({ role: "receiver", store, sinkKind, phase, connectionType, resumeCount });

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

  const fail = async (message: string) => {
    clearTimeout(reconnectTimer);
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
    sendSignal({ type: "join-room", roomId: store.roomId });
  };

  const handleSignal = serialize(async (msg: IncomingSignal) => {
    switch (msg.type) {
      case "room-joined":
        if (phase.value === "connecting") fileStatus.value = "Joined room, waiting for the sender...";
        return;
      case "room-full":
        phase.value = "failed";
        fileStatus.value = "This room already has two people. Ask the sender for a new link.";
        store.pc?.close();
        return;
      case "peer-left":
        if (phase.value !== "done" && store.pc?.connectionState !== "connected") {
          fileStatus.value = "The sender disconnected. Waiting for them to come back...";
        }
        return;
      case "error":
        if (phase.value !== "done") fileStatus.value = `Error: ${msg.message}`;
        return;
      case "signal": {
        const p = msg.payload;
        const payloadGen = p.gen ?? 0;
        if (isDescription(p) && p.type === "offer") {
          // Offer của kết nối mới (gen mới) -> tạo pc mới; cùng gen -> ICE restart trên pc cũ
          if (payloadGen !== gen || !store.pc) await setupPeer(payloadGen);
          const pc = store.pc!;
          await setRemoteDescription(pc, p);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({
            type: "signal",
            roomId: store.roomId,
            payload: { type: answer.type, sdp: answer.sdp, gen: payloadGen },
          });
          if (phase.value === "connecting") fileStatus.value = "Connecting to sender...";
        } else if (isCandidate(p) && store.pc && payloadGen === gen) {
          await addRemoteCandidate(store.pc, p.candidate);
        }
        return;
      }
    }
  });

  const setupPeer = async (newGen: number) => {
    const oldPc = store.pc;
    const oldDc = store.dataChannel;
    store.pc = null;
    store.dataChannel = null;
    oldDc?.close();
    oldPc?.close();
    gen = newGen;

    const pc = await createPeerConnection();
    store.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate && store.pc === pc) {
        sendSignal({ type: "signal", roomId: store.roomId, payload: { candidate: e.candidate.toJSON(), gen: newGen } });
      }
    };
    pc.onconnectionstatechange = () => {
      if (store.pc !== pc) return;
      console.log("[PC-B] connectionState", pc.connectionState);
      if (pc.connectionState === "connected") refreshConnectionType(pc);
      if (pc.connectionState === "failed" && phase.value === "receiving") onInterrupted();
      if (phase.value === "done" || phase.value === "failed" || phase.value === "interrupted") return;
      const msg = describeConnectionState(pc.connectionState);
      if (msg) fileStatus.value = msg;
      else if (pc.connectionState === "connected" && phase.value === "receiving") {
        fileStatus.value = `Receiving... ${progress.value}%`;
      }
    };
    pc.oniceconnectionstatechange = () => console.log("[PC-B] iceConnectionState", pc.iceConnectionState);
    pc.ondatachannel = (event) => {
      if (store.pc === pc) setupDataChannel(event.channel);
    };
  };

  /** Mất kết nối giữa chừng: giữ phần đã nhận, chờ kết nối lại để gửi tiếp. */
  const onInterrupted = () => {
    if (phase.value !== "receiving") return;
    phase.value = "interrupted";
    interruptedAt = Date.now();
    fileStatus.value = `Connection lost at ${progress.value}%. Reconnecting to resume...`;
    const scheduleRequest = (delay: number) => {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (phase.value !== "interrupted") return;
        if (Date.now() - interruptedAt > RESUME_GIVE_UP_MS) {
          fail("Could not reconnect to the sender. Ask them to send the file again.");
          return;
        }
        // Bên gửi có thể chưa nhận ra kết nối đã chết: nhờ nó tạo kết nối mới
        requestPeerReconnect();
        scheduleRequest(RECONNECT_RETRY_MS);
      }, delay);
    };
    scheduleRequest(RECONNECT_REQUEST_DELAY_MS);
  };

  const setupDataChannel = (dc: RTCDataChannel) => {
    store.dataChannel = dc;
    dc.binaryType = "arraybuffer";
    dc.onopen = () => {
      if (phase.value === "connecting") fileStatus.value = "Connected! Waiting for file...";
    };
    dc.onclose = () => {
      if (store.dataChannel !== dc) return; // kênh cũ, đã được thay
      if (phase.value === "receiving") onInterrupted();
      else if (phase.value === "connecting" || phase.value === "offer") fileStatus.value = "Connection closed";
    };
    dc.onmessage = (e) => {
      if (store.dataChannel !== dc) return;
      if (typeof e.data === "string") {
        const message = parseControlMessage(e.data);
        if (message?.type === "metadata") {
          onMetadata(dc, message.transferId, { name: message.name, size: message.size, mimeType: message.mimeType });
        } else if (message?.type === "done") {
          onDone(dc, message.sha256);
        }
      } else if (e.data instanceof ArrayBuffer && sink && hasher && phase.value === "receiving") {
        hasher.update(new Uint8Array(e.data)); // hash trước: write() chuyển buffer sang worker
        sink.write(e.data);
        const size = fileMetadata.value?.size || 1;
        updateStats?.(sink.bytesWritten, size);
        const pct = Math.floor((sink.bytesWritten / size) * 100);
        if (pct !== progress.value) {
          progress.value = pct;
          fileStatus.value = `Receiving... ${pct}%`;
        }
      }
    };
  };

  const onMetadata = (dc: RTCDataChannel, id: string, meta: FileMetadata) => {
    const sameTransfer = id === transferId && fileMetadata.value?.size === meta.size;
    if (sameTransfer && (phase.value === "interrupted" || phase.value === "receiving") && sink) {
      // Kết nối mới cho cùng lượt gửi: xin gửi tiếp từ chỗ đã nhận
      clearTimeout(reconnectTimer);
      phase.value = "receiving";
      resumeCount.value++;
      const offset = sink.bytesWritten;
      updateStats = createStatsText(createTransferMeter(), (t) => (statsText.value = t));
      fileStatus.value = `Reconnected! Resuming from ${progress.value}%...`;
      sendControl(dc, { type: "resume", offset });
      return;
    }
    if (sameTransfer && phase.value === "done") {
      sendControl(dc, { type: "received", ok: true }); // bên gửi chưa nhận được xác nhận lần trước
      return;
    }
    if (sameTransfer && phase.value === "offer") return; // vẫn đang hiện nút Accept
    if (phase.value === "receiving" || phase.value === "interrupted") return; // lượt khác đang chạy

    transferId = id;
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
    if (!meta || !store.dataChannel || phase.value !== "offer") return;
    try {
      if (preferredSinkKind() !== "fs-access") {
        const storageError = await checkStorage(meta.size);
        if (storageError) {
          fileStatus.value = storageError;
          return;
        }
      }
      sink = await createSink(meta);
      hasher = await createSHA256();
    } catch (err) {
      if (err instanceof SinkCancelledError) return; // người dùng huỷ hộp thoại Save, vẫn ở bước offer
      fileStatus.value = `Could not prepare the file: ${(err as Error).message}`;
      return;
    }
    const dc = store.dataChannel;
    if (!dc || dc.readyState !== "open") {
      // Kết nối rớt trong lúc chọn chỗ lưu: chờ kết nối mới rồi gửi tiếp từ 0
      phase.value = "receiving";
      onInterrupted();
    } else {
      phase.value = "receiving";
      sendControl(dc, { type: "accept" });
    }
    sinkKind.value = sink.kind;
    sink.onError = (err) => {
      fail(`Could not save the file: ${err.message}`);
      store.dataChannel?.close();
    };
    statsText.value = "";
    updateStats = createStatsText(createTransferMeter(), (t) => (statsText.value = t));
    startedAt = performance.now();
    if (phase.value === "receiving") fileStatus.value = "Receiving... 0%";
  };

  const reject = () => {
    const dc = store.dataChannel;
    if (phase.value !== "offer" || !dc) return;
    sendControl(dc, { type: "reject" });
    phase.value = "failed";
    fileStatus.value = "You declined the file.";
  };

  const onDone = async (dc: RTCDataChannel, expectedSha256: string) => {
    const s = sink;
    const h = hasher;
    const meta = fileMetadata.value;
    if (!s || !h || !meta || phase.value !== "receiving") return;
    sink = null;
    hasher = null;
    try {
      if (s.bytesWritten !== meta.size) {
        throw new Error(`incomplete file (${s.bytesWritten} of ${meta.size} bytes)`);
      }
      if (h.digest("hex") !== expectedSha256) {
        await s.abort();
        phase.value = "failed";
        fileStatus.value = "❌ The file arrived corrupted and was discarded. Ask the sender to try again.";
        sendControl(dc, { type: "received", ok: false });
        return;
      }
      const file = await s.finish();
      phase.value = "done";
      progress.value = 100;
      const seconds = (performance.now() - startedAt) / 1000;
      statsText.value = seconds > 0 ? `Average ${formatSpeed(meta.size / seconds)}` : "";
      sendControl(dc, { type: "received", ok: true });
      receivedFile.value = file;
      if (!file) {
        fileStatus.value = `Saved ${meta.name} ✅ (integrity verified)`;
        return;
      }
      // Điện thoại: Share sheet cho phép "Lưu ảnh" vào Photos / "Lưu vào Tệp"; tải tự động
      // trong PWA trên iOS hay trục trặc nên để người dùng bấm nút.
      canShareFile.value = isMobile() && !!navigator.canShare?.({ files: [file] });
      if (canShareFile.value) {
        fileStatus.value = "File received ✅ (integrity verified). Tap Save to keep it.";
      } else {
        triggerDownload(file, meta.name);
        fileStatus.value = "Download complete! ✅ (integrity verified)";
      }
    } catch (err) {
      await s.abort();
      phase.value = "failed";
      fileStatus.value = `Receive failed: ${(err as Error).message}`;
    }
  };

  const shareFile = async () => {
    const file = receivedFile.value;
    if (!file) return;
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      if ((err as Error).name !== "AbortError") fileStatus.value = `Could not share: ${(err as Error).message}`;
    }
  };

  const downloadAgain = () => {
    const file = receivedFile.value;
    if (file && fileMetadata.value) triggerDownload(file, fileMetadata.value.name);
  };

  return {
    fileStatus,
    progress,
    fileMetadata,
    phase,
    sinkKind,
    offerWarning,
    statsText,
    connectionType,
    receivedFile,
    canShareFile,
    joinRoom,
    accept,
    reject,
    shareFile,
    downloadAgain,
  };
}
