// Kiểm tra luật của signaling server trực tiếp bằng socket.io-client (không cần browser).
import { test, expect } from "@playwright/test";
import { io, type Socket } from "socket.io-client";
import { SIGNALING_PORT } from "../../playwright.config";

const URL = `http://localhost:${SIGNALING_PORT}`;
const sockets: Socket[] = [];

function connect(): Promise<Socket> {
  const s = io(URL, { transports: ["websocket"], forceNew: true, reconnection: false });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
}

function next<T = any>(s: Socket, event: string, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    s.once(event, (msg: T) => {
      clearTimeout(t);
      resolve(msg);
    });
  });
}

/** true nếu KHÔNG nhận được event trong khoảng thời gian chờ */
async function silent(s: Socket, event: string, ms = 700) {
  try {
    await next(s, event, ms);
    return false;
  } catch {
    return true;
  }
}

async function createRoom() {
  const a = await connect();
  const created = next<{ roomId: string }>(a, "room-created");
  a.emit("create-room");
  return { a, roomId: (await created).roomId };
}

test.afterEach(() => {
  sockets.splice(0).forEach((s) => s.disconnect());
});

test("room id uses unambiguous characters", async () => {
  const { roomId } = await createRoom();
  expect(roomId).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
});

test("third member gets room-full", async () => {
  const { a, roomId } = await createRoom();
  const b = await connect();
  const joined = next(a, "peer-joined");
  b.emit("join-room", { roomId: roomId.toLowerCase() }); // không phân biệt hoa thường
  await joined;

  const c = await connect();
  const full = next(c, "room-full");
  c.emit("join-room", { roomId });
  expect(await full).toEqual({ roomId });
  expect(await silent(a, "peer-joined")).toBe(true);
});

test("signals from non-members are not relayed", async () => {
  const { a, roomId } = await createRoom();
  const outsider = await connect();
  outsider.emit("signal", { roomId, payload: { type: "offer", sdp: "fake" } });
  expect(await silent(a, "signal")).toBe(true);
});

test("signals between members are relayed", async () => {
  const { a, roomId } = await createRoom();
  const b = await connect();
  const joined = next(b, "room-joined");
  b.emit("join-room", { roomId });
  await joined;
  const got = next(a, "signal");
  b.emit("signal", { roomId, payload: { type: "answer", sdp: "x" } });
  expect(await got).toEqual({ type: "answer", sdp: "x" });
});

test("unknown room gives an error", async () => {
  const b = await connect();
  const err = next(b, "error");
  b.emit("join-room", { roomId: "ZZZZZZ" });
  expect((await err).code).toBe("room-not-found");
});

test("member can rejoin after disconnect, peer gets peer-left then peer-rejoined", async () => {
  const { a, roomId } = await createRoom();
  const b = await connect();
  const joined = next(b, "room-joined");
  b.emit("join-room", { roomId });
  await joined;

  const left = next(a, "peer-left");
  b.disconnect();
  await left;

  const b2 = await connect();
  const rejoined = next(a, "peer-rejoined");
  b2.emit("rejoin-room", { roomId });
  await rejoined;
});

test("empty room survives briefly so the creator can come back", async () => {
  const { a, roomId } = await createRoom();
  a.disconnect();
  await new Promise((r) => setTimeout(r, 300));
  const a2 = await connect();
  const back = next(a2, "room-joined");
  a2.emit("rejoin-room", { roomId });
  expect(await back).toEqual({ roomId });
});
