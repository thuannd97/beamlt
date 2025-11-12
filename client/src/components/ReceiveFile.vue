<template>
  <div class="receive-file">
    <h2>📥 Receiving File</h2>
    
    <div v-if="fileMetadata" class="file-preview">
      <div class="file-icon">📄</div>
      <div class="file-details">
        <h3>{{ fileMetadata.name }}</h3>
        <p class="file-size">{{ formatFileSize(fileMetadata.size) }}</p>
      </div>
    </div>
    
    <div v-if="fileStatus" class="status">{{ fileStatus }}</div>
    <progress v-if="progress > 0" :value="progress" max="100"></progress>
  </div>
</template>

<script lang="ts">
import { ref, onMounted } from "vue";
import { useConnectionStore } from "@/store/connection";
import { connectSignaling, sendSignal, onSignal } from "@/services/signaling";

const response = 
  await fetch("https://beamlt-turn.metered.live/api/v1/turn/credentials?apiKey=3446b53dbc24fad141ab5479793c30537f9c");

// Saving the response in the iceServers array
const iceServersMetered = await response.json();

export default {
  setup() {
    const store = useConnectionStore();
    const roomId = ref("");
    const fileStatus = ref("");
    const progress = ref(0);
    const fileMetadata = ref<{ name: string; size: number; mimeType: string } | null>(null);
    let receivedChunks: ArrayBuffer[] = [];
    let receivedSize = 0;
    const iceServers = ref<RTCIceServer[]>([]);

    onMounted(async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const roomCode = urlParams.get("room");
      if (roomCode) {
        roomId.value = roomCode;
        fileStatus.value = "Auto-joining room...";
        // Lấy ICE server từ Twilio khi khởi tạo component
        iceServers.value = iceServersMetered;
        joinRoom();
      }
    });

    const joinRoom = async () => {
      if (!roomId.value) return;
      store.roomId = roomId.value;
      await connectSignaling();
      onSignal(handleSignal);
      sendSignal({ type: "join-room", roomId: roomId.value });
      setupPeer();
    };

    const handleSignal = async (msg: any) => {
      const pc = store.pc;
      if (!pc) return;

      if (msg.type === "signal") {
        if (msg.payload.type === "offer") {
          console.log("[PC-B] Received offer");
          await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ type: "signal", roomId: store.roomId, payload: answer });
          console.log("[PC-B] Created and sent answer");
        } else if (msg.payload.candidate) {
          console.log("[PC-B] Adding ICE candidate");
          await pc.addIceCandidate(new RTCIceCandidate(msg.payload.candidate));
        }
      }
    };

    const setupPeer = () => {
      // Using the iceServers array in the RTCPeerConnection method
      var pc = new RTCPeerConnection({
        iceServers: iceServers
      });
      store.pc = pc;

      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal({ type: "signal", roomId: store.roomId, payload: { candidate: e.candidate } });
        console.log("[PC-B] ICE candidate:", e.candidate);
      };

      pc.onconnectionstatechange = () => console.log("[PC-B] connectionState", pc.connectionState);
      pc.oniceconnectionstatechange = () => console.log("[PC-B] iceConnectionState", pc.iceConnectionState);

      pc.ondatachannel = (event) => {
        console.log("[DC-B] Received data channel");
        store.dataChannel = event.channel;
        event.channel.onopen = () => {
          console.log("[DC-B] Open");
          fileStatus.value = "Connected! Waiting for file...";
        };
        event.channel.onmessage = (e) => {
          console.log("[DC-B] Received data", typeof e.data);
          if (typeof e.data === "string") {
            try {
              const message = JSON.parse(e.data);
              if (message.type === "metadata") {
                fileMetadata.value = message;
                receivedChunks = [];
                receivedSize = 0;
                progress.value = 0;
                console.log("[DC-B] Received metadata:", message);
                fileStatus.value = "Connecting...";
              }
              else if (message.type === "done") {
                // File đã nhận xong, ghép các chunks và download
                if (receivedChunks.length > 0 && fileMetadata.value) {
                  const blob = new Blob(receivedChunks, {
                    type: fileMetadata.value.mimeType || "application/octet-stream"
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = fileMetadata.value.name;
                  a.click();
                  URL.revokeObjectURL(url);
                  fileStatus.value = "Download complete! ✅";
                }
              }
            } catch (err) {
              console.error("[DC-B] Error parsing message:", err);
            }
          }
          else if (e.data instanceof ArrayBuffer) {
            receivedChunks.push(e.data);
            receivedSize += e.data.byteLength;
            if (fileMetadata.value) {
              const percent = Math.round((receivedSize / fileMetadata.value.size) * 100);
              progress.value = percent;
              fileStatus.value = `Receiving... ${percent}%`;
            }
          }
        };
        event.channel.onclose = () => {
          console.log("[DC-B] Closed");
          fileStatus.value = "Connection closed";
        };
      };
    };

    const formatFileSize = (bytes: number) => {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
    };

    return { fileStatus, progress, fileMetadata, formatFileSize };
  },
};
</script>

<style scoped>
.receive-file {
  text-align: center;
}

h2 {
  color: #333;
  margin-bottom: 30px;
}

.file-preview {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 30px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  margin: 20px 0;
  color: white;
}

.file-icon {
  font-size: 4rem;
  background: rgba(255, 255, 255, 0.2);
  padding: 20px;
  border-radius: 12px;
}

.file-details {
  flex: 1;
  text-align: left;
}

.file-details h3 {
  font-size: 1.5rem;
  margin-bottom: 5px;
  word-break: break-all;
}

.file-size {
  font-size: 1.2rem;
  opacity: 0.9;
}

.status {
  padding: 15px;
  background: #e3f2fd;
  border-left: 4px solid #2196F3;
  border-radius: 4px;
  margin: 20px 0;
  font-weight: 500;
}

progress {
  width: 100%;
  height: 30px;
  margin-top: 20px;
  border-radius: 15px;
}

progress::-webkit-progress-bar {
  background-color: #e0e0e0;
  border-radius: 15px;
}

progress::-webkit-progress-value {
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  border-radius: 15px;
}
</style>
