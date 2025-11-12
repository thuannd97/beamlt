export async function fetchTwilioICEServers(): Promise<RTCIceServer[]> {
  const res = await fetch(
    'https://api.twilio.com/2010-04-01/Accounts/AC97068062d95a4122708d265a321a07d1/Tokens.json',
    {
      method: "POST",
      headers: {
        "Authorization": "Basic QUM5NzA2ODA2MmQ5NWE0MTIyNzA4ZDI2NWEzMjFhMDdkMTo1Yzc2MGY2NGMwYjU3Yjc2YTdlOTQzZGQ2ZDE2MTYxZA==",
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );
  if (!res.ok) throw new Error("Cannot fetch Twilio ICE servers");
  const data = await res.json();
  // Trả về danh sách server đúng định dạng RTCIceServer[]
  return data.ice_servers as RTCIceServer[];
}
