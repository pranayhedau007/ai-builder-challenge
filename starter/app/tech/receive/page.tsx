"use client";

import { useState, useEffect, useRef } from "react";
import { ScanInput } from "@/components/ScanInput";
import { ScanModeToggle } from "@/components/ScanModeToggle";
import { CameraScanner } from "@/components/CameraScanner";
import { ScanSuccess } from "@/components/ScanSuccess";
import { api, ApiError } from "@/lib/api-client";
import { getCurrentUserId } from "@/lib/auth";
import { getScanMode, setScanMode, type ScanMode } from "@/lib/scan-mode";
import type { Asset, AssetClass } from "@/lib/types";

type Step =
  | { kind: "idle" }
  | { kind: "checking"; tag: string }
  | { kind: "form"; tag: string }
  | { kind: "submitting"; tag: string }
  | { kind: "success_new"; asset: Asset }
  | { kind: "success_dup"; asset: Asset; receivedAt: string; receivedBy: string }
  | { kind: "error"; tag: string; title: string; message: string };

const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "instrument", label: "Instrument" },
  { value: "compute", label: "Compute" },
  { value: "network", label: "Network" },
  { value: "power", label: "Power" },
  { value: "consumable_durable", label: "Consumable / durable" },
];

function formatReceivedTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const timeStr = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .toLowerCase()
    .replace(" ", ""); // "9:42pm" with no space
  if (isToday) return timeStr;
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${timeStr}`;
}

export default function ReceivePage() {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [scanMode, setScanModeState] = useState<ScanMode>("handheld");
  const [resetKey, setResetKey] = useState(0);
  const [formData, setFormData] = useState({
    serial: "",
    model: "",
    manufacturer: "",
    asset_class: "instrument" as AssetClass,
    site: "",
    room: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setScanModeState(getScanMode());
  }, []);

  function handleModeChange(mode: ScanMode) {
    setScanMode(mode);
    setScanModeState(mode);
  }

  async function handleTagScan(tag: string) {
    if (step.kind === "checking" || step.kind === "submitting") return;
    setFormError(null);
    setStep({ kind: "checking", tag });

    try {
      const existing = await api.assets.get(tag);
      // Disposed is always a hard stop — check before the idempotent duplicate path
      if (existing.state === "disposed") {
        setStep({
          kind: "error",
          tag,
          title: "Asset disposed",
          message: "This asset has been disposed. No scans are accepted.",
        });
        return;
      }
      // Asset exists — auto-POST the receive to log the duplicate_receive event
      // and collect the canonical idempotent response
      const result = await api.scans.receive({
        asset_tag: tag,
        serial: existing.serial,
        model: existing.model,
        manufacturer: existing.manufacturer,
        asset_class: existing.asset_class,
        location: existing.location,
        user_id: getCurrentUserId(),
        scan_payload: tag,
      });
      // Find the original receive event for the "received at / by" text
      const events = await api.assets.history(tag);
      // findLast not in ES2022 lib — iterate from the end manually
      const firstReceive = [...events].reverse().find((e) => e.event_type === "receive");
      setStep({
        kind: "success_dup",
        asset: result,
        receivedAt: firstReceive
          ? formatReceivedTime(firstReceive.timestamp)
          : "an earlier time",
        receivedBy: firstReceive?.user_id ?? existing.custodian,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "unknown_asset") {
        // New tag — open the registration form
        setStep({ kind: "form", tag });
      } else if (err instanceof ApiError && err.code === "invalid_tag_format") {
        setStep({
          kind: "error",
          tag,
          title: "Invalid tag",
          message: `"${tag}" is not a valid asset tag. Tags start with C followed by 7 digits — for example, C0009001. Check the label and try again.`,
        });
      } else {
        setStep({
          kind: "error",
          tag,
          title: "Connection error",
          message:
            "Could not reach the server. Check your connection and try again.",
        });
      }
    }
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== "form") return;
    setFormError(null);
    const tag = step.tag;
    setStep({ kind: "submitting", tag });

    try {
      const result = await api.scans.receive({
        asset_tag: tag,
        serial: formData.serial,
        model: formData.model,
        manufacturer: formData.manufacturer,
        asset_class: formData.asset_class,
        location: {
          site: formData.site || "Unknown",
          room: formData.room || null,
          row: null,
          rack: null,
          ru: null,
        },
        user_id: getCurrentUserId(),
        scan_payload: tag,
      });
      setStep({ kind: "success_new", asset: result });
    } catch (err) {
      if (err instanceof ApiError && err.code === "and_match_failed") {
        // Tag exists with a different serial — surface the existing one
        let existingSerial = "(unknown)";
        try {
          const existing = await api.assets.get(tag);
          existingSerial = existing.serial;
        } catch {
          // ignore
        }
        setFormError(
          `Tag ${tag} is registered with serial ${existingSerial}, but you entered ${formData.serial}. Don't re-label the asset — escalate to your manager.`,
        );
        setStep({ kind: "form", tag });
      } else if (err instanceof ApiError) {
        setFormError(err.message);
        setStep({ kind: "form", tag });
      } else {
        setFormError(
          "Could not reach the server. Check your connection and try again.",
        );
        setStep({ kind: "form", tag });
      }
    }
  }

  function reset() {
    setStep({ kind: "idle" });
    setFormData({
      serial: "",
      model: "",
      manufacturer: "",
      asset_class: "instrument",
      site: "",
      room: "",
    });
    setFormError(null);
    setResetKey((k) => k + 1);
  }

  // ── Success screens ─────────────────────────────────────────────────────────

  if (step.kind === "success_new") {
    return (
      <ScanSuccess
        title="Received"
        assetName={step.asset.model}
        assetTag={step.asset.asset_tag}
        detail="Created and logged. Ready to store or deploy."
        onReset={reset}
      />
    );
  }

  if (step.kind === "success_dup") {
    return (
      <ScanSuccess
        variant="neutral"
        title="Already received"
        assetName={step.asset.model}
        assetTag={step.asset.asset_tag}
        // Idempotent confirmation: person first, time second — at 11pm the
        // tech's first question is "who touched it?" not "when?". Calm blue
        // card, not red error, because the system state is correct.
        detail={`${step.receivedBy} logged it at ${step.receivedAt}. Nothing to do.`}
        onReset={reset}
      />
    );
  }

  // ── Header ──────────────────────────────────────────────────────────────────

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold">Receive</h1>
      <ScanModeToggle value={scanMode} onChange={handleModeChange} />
    </div>
  );

  // ── Form (new asset) ────────────────────────────────────────────────────────

  if (step.kind === "form" || step.kind === "submitting") {
    const tag = step.tag;
    return (
      <div className="space-y-5">
        {header}
        <div className="rounded-lg bg-gray-50 border px-4 py-3 text-sm font-mono text-gray-700">
          New asset · {tag}
        </div>

        {formError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {formError}
          </div>
        )}

        <form onSubmit={handleFormSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Serial number *
            </span>
            <input
              type="text"
              required
              value={formData.serial}
              onChange={(e) =>
                setFormData((p) => ({ ...p, serial: e.target.value }))
              }
              placeholder="e.g. SN-DEMO-1"
              className="mt-1 w-full p-3 rounded-lg border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-base min-h-[44px]"
              autoFocus
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Model *</span>
            <input
              type="text"
              required
              value={formData.model}
              onChange={(e) =>
                setFormData((p) => ({ ...p, model: e.target.value }))
              }
              placeholder="e.g. Genomics Sequencer 2000"
              className="mt-1 w-full p-3 rounded-lg border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-base min-h-[44px]"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Manufacturer *
            </span>
            <input
              type="text"
              required
              value={formData.manufacturer}
              onChange={(e) =>
                setFormData((p) => ({ ...p, manufacturer: e.target.value }))
              }
              placeholder="e.g. BioSystems Inc"
              className="mt-1 w-full p-3 rounded-lg border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-base min-h-[44px]"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Asset class *
            </span>
            <select
              required
              value={formData.asset_class}
              onChange={(e) =>
                setFormData((p) => ({
                  ...p,
                  asset_class: e.target.value as AssetClass,
                }))
              }
              className="mt-1 w-full p-3 rounded-lg border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-base min-h-[44px] bg-white"
            >
              {ASSET_CLASSES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Site</span>
              <input
                type="text"
                value={formData.site}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, site: e.target.value }))
                }
                placeholder="e.g. Lab-Building-A"
                className="mt-1 w-full p-3 rounded-lg border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-base min-h-[44px]"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Room</span>
              <input
                type="text"
                value={formData.room}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, room: e.target.value }))
                }
                placeholder="e.g. Receiving"
                className="mt-1 w-full p-3 rounded-lg border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-base min-h-[44px]"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={step.kind === "submitting"}
            className="w-full py-4 rounded-xl bg-gray-900 text-white font-semibold text-lg min-h-[52px] disabled:opacity-50"
          >
            {step.kind === "submitting" ? "Receiving…" : "Receive asset"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="w-full py-2 text-sm text-gray-500 min-h-[44px]"
          >
            Cancel
          </button>
        </form>
      </div>
    );
  }

  // ── Idle + error (both show the scan input) ─────────────────────────────────

  return (
    <div className="space-y-5">
      {header}

      {step.kind === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-1">
          <p className="font-semibold text-red-900 text-sm">{step.title}</p>
          <p className="text-sm text-red-800">{step.message}</p>
        </div>
      )}

      {step.kind === "checking" && (
        <p className="text-sm text-gray-500">Checking {step.tag}…</p>
      )}

      {scanMode === "handheld" ? (
        <ScanInput
          key={resetKey}
          onScan={handleTagScan}
          placeholder="Scan or type an asset tag…"
          label="Asset tag"
          disabled={step.kind === "checking"}
        />
      ) : (
        <CameraScanner
          onScan={handleTagScan}
          active={step.kind !== "checking"}
          label="Asset tag"
        />
      )}

      <p className="text-xs text-gray-400">
        Scan the barcode on the asset label.
      </p>
    </div>
  );
}
