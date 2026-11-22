// Test thuần (không cần browser) cho phần tính tốc độ / thời gian còn lại.
import { test, expect } from "@playwright/test";
import { createTransferMeter, formatEta, formatSpeed } from "../../src/services/transferStats";

test("meter computes speed over the recent window and ETA", () => {
  let t = 0;
  const meter = createTransferMeter(() => t);
  for (let i = 0; i <= 10; i++) {
    t = i * 500; // mỗi 0.5s truyền thêm 1 MB -> 2 MB/s
    meter.update(i * 1024 * 1024);
  }
  expect(meter.speed()).toBeCloseTo(2 * 1024 * 1024, -3);
  // còn 10 MB / 2 MB/s = 5s
  expect(meter.etaSeconds(20 * 1024 * 1024)).toBeCloseTo(5, 1);
});

test("formatting", () => {
  expect(formatSpeed(12.34 * 1024 * 1024)).toBe("12.3 MB/s");
  expect(formatSpeed(300 * 1024)).toBe("300 KB/s");
  expect(formatEta(42)).toBe("0:42 left");
  expect(formatEta(125.2)).toBe("2:06 left");
  expect(formatEta(3725)).toBe("1:02:05 left");
  expect(formatEta(null)).toBe("");
});
