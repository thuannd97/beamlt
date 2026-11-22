// Khi URL có ?debug=1, gắn trạng thái vào window.__beamlt để e2e test đọc được.
export const debugEnabled =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";

export function exposeDebug(values: Record<string, unknown>) {
  if (!debugEnabled) return;
  const w = window as unknown as { __beamlt?: Record<string, unknown> };
  w.__beamlt = Object.assign(w.__beamlt ?? {}, values);
}
