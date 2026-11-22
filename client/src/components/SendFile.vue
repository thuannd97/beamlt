<template>
  <div class="send-file">
    <h2>Send File</h2>
    
    <div v-if="!roomId" class="file-selector">
      <div class="upload-area">
        <div class="upload-icon">📁</div>
        <label for="file-input" class="file-label">
          <span v-if="!fileToSend">Click to select a file</span>
          <span v-else class="selected-file">
            <span class="file-emoji">✅</span>
            {{ fileToSend.name }}
          </span>
        </label>
        <input 
          id="file-input" 
          type="file" 
          @change="onFileSelected" 
          hidden 
        />
      </div>
      <button 
        @click="createRoom" 
        :disabled="!fileToSend"
        class="create-room-btn"
      >
        <span class="btn-icon">🚀</span>
        Create Room & Share
      </button>
    </div>
    
    <div v-if="roomId" class="share-section">
      <h3>Share this link or QR code:</h3>
      
      <div class="share-link">
        <input :value="shareLink" readonly @click="copyLink" />
        <button @click="copyLink">Copy</button>
      </div>
      
      <div class="qr-code">
        <qrcode-vue :value="shareLink" :size="200" level="H" />
      </div>
      
      <div class="file-info">
        <div class="file-icon-large">📄</div>
        <h3>{{ fileToSend?.name }}</h3>
        <p class="file-size-large">{{ formatFileSize(fileToSend?.size || 0) }}</p>
      </div>
      
      <div v-if="fileStatus" class="file-status">{{ fileStatus }}</div>
      <progress v-if="progress > 0" :value="progress" max="100"></progress>
    </div>
  </div>
</template>

<script setup lang="ts">
import QrcodeVue from "qrcode.vue";
import { useSender } from "@/composables/useSender";
import { formatFileSize } from "@/services/protocol";

const { roomId, fileToSend, fileStatus, progress, shareLink, selectFile, createRoom, copyLink } = useSender();

const onFileSelected = (e: Event) => selectFile((e.target as HTMLInputElement).files?.[0]);
</script>

<style scoped>
.send-file {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
}

.file-selector {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.upload-area {
  border: 3px dashed #667eea;
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
  cursor: pointer;
  transition: all 0.3s ease;
}

.upload-area:hover {
  border-color: #764ba2;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
  transform: translateY(-2px);
}

.upload-icon {
  font-size: 4rem;
  margin-bottom: 15px;
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.file-label {
  display: block;
  font-size: 1.2rem;
  color: #667eea;
  font-weight: 600;
  cursor: pointer;
}

.selected-file {
  color: #4CAF50;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.file-emoji {
  font-size: 1.5rem;
}

.create-room-btn {
  padding: 18px 40px;
  font-size: 1.2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.create-room-btn:hover:not(:disabled) {
  transform: translateY(-3px);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.6);
}

.btn-icon {
  font-size: 1.5rem;
}

.share-section {
  margin-top: 20px;
}

.share-link {
  display: flex;
  gap: 10px;
  margin: 20px 0;
}

.share-link input {
  flex: 1;
  padding: 10px;
  border: 2px solid #4CAF50;
  border-radius: 4px;
  font-size: 14px;
}

.share-link button {
  padding: 10px 20px;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.share-link button:hover {
  background: #45a049;
}

.qr-code {
  display: flex;
  justify-content: center;
  padding: 20px;
  background: white;
  border-radius: 8px;
  margin: 20px 0;
}

.file-info {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 30px;
  border-radius: 12px;
  margin: 20px 0;
  color: white;
  text-align: center;
}

.file-icon-large {
  font-size: 4rem;
  margin-bottom: 15px;
}

.file-info h3 {
  font-size: 1.5rem;
  margin-bottom: 10px;
  word-break: break-all;
}

.file-size-large {
  font-size: 1.2rem;
  opacity: 0.9;
  margin: 0;
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
  background: linear-gradient(90deg, #4CAF50 0%, #45a049 100%);
  border-radius: 15px;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-status {
  padding: 15px 20px;
  background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
  color: white;
  border-radius: 8px;
  margin: 20px 0;
  font-weight: 600;
  font-size: 1.1rem;
  text-align: center;
  box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
}
</style>
