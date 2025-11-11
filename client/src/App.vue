<template>
  <div id="app">
    <header>
      <h1>🚀 BeamLT - P2P File Transfer</h1>
      <p>Share files directly between browsers using WebRTC</p>
    </header>

    <div class="mode-selector" v-if="!hasRoomParam">
      <button 
        @click="mode='send'" 
        :class="{ active: mode === 'send' }"
      >
        📤 Send File
      </button>
      <button 
        @click="mode='receive'" 
        :class="{ active: mode === 'receive' }"
      >
        📥 Receive File
      </button>
    </div>

    <main>
      <SendFile v-if="mode === 'send'" />
      <ReceiveFile v-if="mode === 'receive'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import SendFile from "./components/SendFile.vue";
import ReceiveFile from "./components/ReceiveFile.vue";

const mode = ref<'send' | 'receive'>('send');
const hasRoomParam = ref(false);

onMounted(() => {
  // Nếu có room code trong URL, tự động chuyển sang receive mode
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("room")) {
    mode.value = 'receive';
    hasRoomParam.value = true;
  }
});
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
}

#app {
  min-height: 100vh;
  padding: 20px;
}

header {
  text-align: center;
  color: white;
  margin-bottom: 40px;
}

header h1 {
  font-size: 2.5rem;
  margin-bottom: 10px;
}

header p {
  opacity: 0.9;
  font-size: 1.1rem;
}

.mode-selector {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-bottom: 30px;
}

.mode-selector button {
  padding: 15px 30px;
  font-size: 16px;
  font-weight: 600;
  border: 2px solid white;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.mode-selector button:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
}

.mode-selector button.active {
  background: white;
  color: #667eea;
}

main {
  background: white;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  max-width: 800px;
  margin: 0 auto;
  padding: 40px;
}

h2 {
  color: #333;
  margin-bottom: 20px;
}

.status {
  padding: 10px;
  background: #e3f2fd;
  border-left: 4px solid #2196F3;
  border-radius: 4px;
  margin: 15px 0;
}
</style>
