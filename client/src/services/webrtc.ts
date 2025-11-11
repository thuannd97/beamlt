import { useConnectionStore } from "@/store/connection";
import { sendSignal } from "./signaling";

export async function createConnection(isSender: boolean) {
  const store = useConnectionStore();

  store.pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  if (isSender) {
    store.dataChannel = store.pc.createDataChannel("beamtl");

    store.dataChannel.onopen = () => console.log("DataChannel open");
    store.dataChannel.onmessage = (e) => console.log("Received:", e.data);
  } else {
    store.pc.ondatachannel = (e) => {
      store.dataChannel = e.channel;
      store.dataChannel.onopen = () => console.log("DataChannel open");
      store.dataChannel.onmessage = (e) => console.log("Received:", e.data);
    };
  }

  store.pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({ type: "signal", payload: { candidate: event.candidate }, roomId: store.roomId });
    }
  };

  return store.pc;
}
