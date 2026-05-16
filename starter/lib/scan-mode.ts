export type ScanMode = "handheld" | "camera";

const KEY = "asset-scan-mode";

export function getScanMode(): ScanMode {
  if (typeof window === "undefined") return "handheld";
  return (localStorage.getItem(KEY) as ScanMode) ?? "handheld";
}

export function setScanMode(mode: ScanMode): void {
  localStorage.setItem(KEY, mode);
}
