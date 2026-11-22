// Tính tốc độ (trung bình trượt) và thời gian còn lại của lượt truyền file.

const WINDOW_MS = 2000;

export interface TransferMeter {
  /** Ghi nhận tổng số byte đã truyền tại thời điểm hiện tại */
  update(totalBytes: number): void;
  /** Byte/giây trong ~2 giây gần nhất */
  speed(): number;
  /** Số giây còn lại, null nếu chưa ước lượng được */
  etaSeconds(totalSize: number): number | null;
  reset(): void;
}

export function createTransferMeter(now: () => number = () => performance.now()): TransferMeter {
  let samples: Array<{ t: number; bytes: number }> = [];
  let last = 0;
  return {
    update(totalBytes) {
      const t = now();
      last = totalBytes;
      samples.push({ t, bytes: totalBytes });
      while (samples.length > 2 && t - samples[0]!.t > WINDOW_MS) samples.shift();
    },
    speed() {
      if (samples.length < 2) return 0;
      const first = samples[0]!;
      const lastSample = samples[samples.length - 1]!;
      const dt = (lastSample.t - first.t) / 1000;
      return dt > 0 ? (lastSample.bytes - first.bytes) / dt : 0;
    },
    etaSeconds(totalSize) {
      const s = this.speed();
      return s > 0 ? Math.max(0, (totalSize - last) / s) : null;
    },
    reset() {
      samples = [];
      last = 0;
    },
  };
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${Math.max(0, Math.round(bytesPerSec / 1024))} KB/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  const s = Math.ceil(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec} left` : `${m}:${sec} left`;
}

/** Chuỗi hiển thị, ví dụ "12.3 MB/s · 0:42 left". Cập nhật tối đa 2 lần/giây. */
export function createStatsText(meter: TransferMeter, onText: (text: string) => void, intervalMs = 500) {
  let lastEmit = 0;
  return (totalBytes: number, totalSize: number, force = false) => {
    meter.update(totalBytes);
    const t = performance.now();
    if (!force && t - lastEmit < intervalMs) return;
    lastEmit = t;
    const speed = meter.speed();
    if (speed <= 0) return;
    const eta = formatEta(meter.etaSeconds(totalSize));
    onText(eta ? `${formatSpeed(speed)} · ${eta}` : formatSpeed(speed));
  };
}
