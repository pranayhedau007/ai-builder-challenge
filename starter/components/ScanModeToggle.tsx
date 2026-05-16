"use client";

import type { ScanMode } from "@/lib/scan-mode";

interface ScanModeToggleProps {
  value: ScanMode;
  onChange: (mode: ScanMode) => void;
}

export function ScanModeToggle({ value, onChange }: ScanModeToggleProps) {
  return (
    <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
      <button
        type="button"
        onClick={() => onChange("handheld")}
        className={`px-3 py-2 min-h-[44px] transition-colors ${
          value === "handheld"
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:bg-gray-50"
        }`}
        aria-label="Use handheld scanner"
      >
        Handheld
      </button>
      <button
        type="button"
        onClick={() => onChange("camera")}
        className={`px-3 py-2 min-h-[44px] border-l border-gray-200 transition-colors ${
          value === "camera"
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:bg-gray-50"
        }`}
        aria-label="Use phone camera"
      >
        Camera
      </button>
    </div>
  );
}
