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

<script setup lang="ts">
import { onMounted } from "vue";
import { useReceiver } from "@/composables/useReceiver";
import { formatFileSize } from "@/services/protocol";

const { fileStatus, progress, fileMetadata, joinRoom } = useReceiver();

onMounted(() => {
  const roomCode = new URLSearchParams(window.location.search).get("room");
  if (roomCode) joinRoom(roomCode);
});
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
