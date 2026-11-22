import { defineStore } from "pinia";

export const useConnectionStore = defineStore("connection", {
  state: () => ({
    pc: null as RTCPeerConnection | null,
    dataChannel: null as RTCDataChannel | null,
    roomId: "",
  }),
});
