"use client";

import { useEffect, useRef } from "react";
// bwip-js types aren't resolved in bundler mode; import via path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bwipjs = require("bwip-js/dist/bwip-js.js") as {
  toCanvas: (
    canvas: HTMLCanvasElement,
    options: { bcid: string; text: string; scale?: number; height?: number; includetext?: boolean; textxalign?: string },
  ) => void;
};

interface BarcodeCanvasProps {
  text: string;
  label?: string;
  note?: string;
  scale?: number;
  height?: number;
}

export function BarcodeCanvas({
  text,
  label,
  note,
  scale = 2,
  height = 10,
}: BarcodeCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    try {
      bwipjs.toCanvas(canvas, {
        bcid: "code128",
        text,
        scale,
        height,
        includetext: true,
        textxalign: "center",
      });
    } catch (e) {
      console.error("Barcode render error for", text, e);
    }
  }, [text, scale, height]);

  return (
    <div className="border rounded-lg p-3 bg-white text-center space-y-1">
      <canvas ref={ref} className="mx-auto max-w-full" />
      {label && (
        <p className="font-mono text-xs font-semibold text-gray-800 break-all">
          {label}
        </p>
      )}
      {note && <p className="text-xs text-gray-500 leading-tight">{note}</p>}
    </div>
  );
}
