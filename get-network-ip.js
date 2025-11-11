const os = require("os");

function getNetworkIP() {
  const interfaces = os.networkInterfaces();
  
  console.log("\n🌐 Network Access Info:");
  console.log("=" .repeat(50));
  
  let foundIP = false;
  Object.keys(interfaces).forEach((name) => {
    interfaces[name]?.forEach((iface) => {
      if (iface.family === "IPv4" && !iface.internal) {
        foundIP = true;
        console.log(`\n📱 iPad/Mobile Access:`);
        console.log(`   Client: http://${iface.address}:5173`);
        console.log(`   Server: http://${iface.address}:3000`);
        console.log(`\n💡 Update your .env file:`);
        console.log(`   VITE_SIGNALING_URL=http://${iface.address}:3000`);
      }
    });
  });
  
  if (!foundIP) {
    console.log("\n⚠️  No network IP found. Make sure you're connected to WiFi.");
  }
  
  console.log("\n" + "=".repeat(50) + "\n");
}

getNetworkIP();
