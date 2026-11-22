<template>
  <div class="receive-file">
    <h2>📥 Receiving File</h2>

    <form v-if="!started" class="join-form" @submit.prevent="joinWithCode">
      <label for="room-code">Enter the room code shown on the sender's screen</label>
      <div class="join-row">
        <input
          id="room-code"
          v-model="roomCode"
          maxlength="6"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          placeholder="ABC234"
        />
        <button type="submit" :disabled="roomCode.trim().length !== 6">Join</button>
      </div>
    </form>
    
    <div v-if="fileMetadata" class="file-preview">
      <div class="file-icon">📄</div>
      <div class="file-details">
        <h3>{{ fileMetadata.name }}</h3>
        <p class="file-size">{{ formatFileSize(fileMetadata.size) }}</p>
      </div>
    </div>
    
    <div v-if="fileStatus" class="status">{{ fileStatus }}</div>

    <div v-if="phase === 'offer'" class="offer-actions">
      <p v-if="offerWarning" class="offer-warning">⚠️ {{ offerWarning }}</p>
      <button class="accept-btn" @click="accept">✅ Accept</button>
      <button class="reject-btn" @click="reject">Decline</button>
    </div>

    <div v-if="phase === 'done' && receivedFile" class="done-actions">
      <button v-if="canShareFile" class="share-btn" @click="shareFile">📲 Save / Share</button>
      <button class="download-btn" @click="downloadAgain">{{ canShareFile ? "⬇️ Download" : "⬇️ Download again" }}</button>
    </div>

    <progress v-if="progress > 0" :value="progress" max="100"></progress>
    <div v-if="statsText || connectionType" class="transfer-info">
      <span v-if="connectionType" class="connection-type" :data-type="connectionType">{{ describeConnectionType(connectionType) }}</span>
      <span v-if="statsText" class="transfer-stats">{{ statsText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useReceiver } from "@/composables/useReceiver";
import { formatFileSize } from "@/services/protocol";
import { describeConnectionType } from "@/services/webrtc";

const {
  fileStatus,
  progress,
  fileMetadata,
  phase,
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
} = useReceiver();

const roomCode = ref("");
const started = ref(false);

const start = (code: string) => {
  started.value = true;
  joinRoom(code.trim().toUpperCase());
};

const joinWithCode = () => {
  if (roomCode.value.trim().length === 6) start(roomCode.value);
};

onMounted(() => {
  const code = new URLSearchParams(window.location.search).get("room");
  if (code) start(code);
});
</script>

<style scoped>
.transfer-info {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 16px;
  margin-top: 12px;
  color: #555;
  font-size: 0.95rem;
}

.connection-type {
  padding: 2px 10px;
  border-radius: 999px;
  background: #eef0ff;
  color: #4c51bf;
}

.connection-type[data-type="relay"] {
  background: #fff4e0;
  color: #8a5300;
}

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

.join-form {
  margin: 10px auto 20px;
  max-width: 360px;
}

.join-form label {
  display: block;
  margin-bottom: 10px;
  color: #555;
}

.join-row {
  display: flex;
  gap: 8px;
}

.join-row input {
  flex: 1;
  min-width: 0;
  padding: 12px;
  font-size: 1.4rem;
  letter-spacing: 0.3em;
  text-align: center;
  text-transform: uppercase;
  border: 2px solid #ddd;
  border-radius: 10px;
}

.join-row button {
  padding: 12px 20px;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  cursor: pointer;
}

.join-row button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.done-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin: 20px 0;
}

.done-actions button {
  padding: 12px 24px;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 10px;
  cursor: pointer;
}

.share-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.download-btn {
  background: #eee;
  color: #333;
}

.offer-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin: 20px 0;
}

.offer-warning {
  flex-basis: 100%;
  color: #8a5300;
  background: #fff4e0;
  padding: 10px;
  border-radius: 8px;
}

.offer-actions button {
  padding: 14px 28px;
  font-size: 1.1rem;
  font-weight: 600;
  border: none;
  border-radius: 10px;
  cursor: pointer;
}

.accept-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.reject-btn {
  background: #eee;
  color: #333;
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
