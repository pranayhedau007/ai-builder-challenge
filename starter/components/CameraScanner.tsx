"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface CameraScannerProps {
  onScan: (value: string) => void;
  active: boolean;
  label?: string;
}

export function CameraScanner({ onScan, active, label }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastScanRef = useRef<{ value: string; time: number }>({
    value: "",
    time: 0,
  });
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Debounce: ignore the same value within 2 seconds to prevent double-fires
  const handleResult = useCallback(
    (text: string) => {
      const now = Date.now();
      const trimmed = text.trim();
      if (
        trimmed === lastScanRef.current.value &&
        now - lastScanRef.current.time < 2000
      )
        return;
      lastScanRef.current = { value: trimmed, time: now };
      onScan(trimmed);
    },
    [onScan],
  );

  useEffect(() => {
    if (!active) return;
    setCameraError(null);
    let stopped = false;
    let controlsRef: { stop(): void } | null = null;

    async function start() {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      if (stopped || !videoRef.current) return;
      const reader = new BrowserMultiFormatReader();
      try {
        controlsRef = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoRef.current,
          (result) => {
            if (result) handleResult(result.getText());
          },
        );
      } catch {
        if (!stopped) setCameraError("Camera unavailable. Check permissions and try again, or switch to handheld mode.");
      }
    }

    start().catch(() => {
      if (!stopped) setCameraError("Could not start camera. Switch to handheld mode.");
    });

    return () => {
      stopped = true;
      controlsRef?.stop();
      // Release any held streams
      import("@zxing/browser")
        .then(({ BrowserMultiFormatReader }) => {
          BrowserMultiFormatReader.releaseAllStreams();
        })
        .catch(() => {});
    };
  }, [active, handleResult]);

  if (!active) return null;

  if (cameraError) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {cameraError}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {label && (
        <p className="text-sm font-medium text-gray-700">{label}</p>
      )}
      <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          playsInline
        />
        {/* viewfinder guide */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-48 h-24 border-2 border-white opacity-60 rounded" />
        </div>
        <p className="absolute bottom-2 left-0 right-0 text-center text-white text-xs opacity-75">
          Point camera at barcode
        </p>
      </div>
    </div>
  );
}
