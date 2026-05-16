"use client";

import { useState, useEffect } from "react";
import { ScanInput } from "@/components/ScanInput";
import { ScanModeToggle } from "@/components/ScanModeToggle";
import { CameraScanner } from "@/components/CameraScanner";
import { ScanSuccess } from "@/components/ScanSuccess";
import { api, ApiError } from "@/lib/api-client";
import { getCurrentUserId } from "@/lib/auth";
import { getScanMode, setScanMode, type ScanMode } from "@/lib/scan-mode";
import { parseLocationString, formatLocation, buildFacilitiesString } from "@/lib/location";
import type { Asset, AssetState } from "@/lib/types";

type Step =
  | { kind: "idle" }
  | { kind: "fetching"; tag: string }
  | { kind: "asset_ready"; asset: Asset }
  | { kind: "committing"; asset: Asset; location: string }
  | { kind: "success"; asset: Asset; prevState: AssetState; newLocation: string; writeBackFailed: boolean }
  // "idempotent" shares the calm-blue visual pattern with duplicate-receive:
  // the system is correct, nothing needs to happen, tell the tech and move on.
  | { kind: "idempotent"; asset: Asset; detail: string }
  | { kind: "error"; title: string; message: string; canRetry: boolean };

const STATE_LABELS: Partial<Record<AssetState, string>> = {
  received: "in receiving",
  stored: "in storage",
  in_service: "in service",
  rma_pending: "pending RMA",
  disposed: "disposed",
};

function stateLabel(s: AssetState): string {
  return STATE_LABELS[s] ?? s;
}

type StateGateResult =
  | { kind: "error"; title: string; message: string }
  | { kind: "idempotent"; detail: string }
  | null;

// Client-side state gate before hitting the API.
function checkState(asset: Asset): StateGateResult {
  if (asset.state === "disposed")
    return {
      kind: "error",
      title: "Asset disposed",
      message: "This asset has been disposed. No scans are accepted.",
    };
  if (asset.state === "rma_pending")
    return {
      kind: "error",
      title: "Pending RMA",
      message:
        "This asset is pending RMA and can't be stored. Contact your manager.",
    };
  if (asset.state === "stored")
    return {
      kind: "idempotent",
      detail: `Already in storage${asset.location.rack ? ` at ${formatLocation(asset.location)}` : ""}. Nothing to do.`,
    };
  return null;
}

export default function StorePage() {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [scanMode, setScanModeState] = useState<ScanMode>("handheld");
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    setScanModeState(getScanMode());
  }, []);

  function handleModeChange(mode: ScanMode) {
    setScanMode(mode);
    setScanModeState(mode);
  }

  async function handleTagScan(tag: string) {
    if (step.kind === "fetching" || step.kind === "committing") return;
    setStep({ kind: "fetching", tag });

    try {
      const asset = await api.assets.get(tag);
      const gate = checkState(asset);
      if (gate) {
        if (gate.kind === "idempotent") {
          setStep({ kind: "idempotent", asset, detail: gate.detail });
        } else {
          setStep({ kind: "error", title: gate.title, message: gate.message, canRetry: true });
        }
        return;
      }
      setStep({ kind: "asset_ready", asset });
    } catch (err) {
      if (err instanceof ApiError && err.code === "unknown_asset") {
        setStep({
          kind: "error",
          title: "Asset not found",
          message: `No asset with tag ${tag}. Check the label or try scanning again.`,
          canRetry: true,
        });
      } else if (err instanceof ApiError && err.code === "invalid_tag_format") {
        setStep({
          kind: "error",
          title: "Invalid tag",
          message: `"${tag}" is not a valid asset tag. Tags start with C followed by 7 digits — for example, C0009001.`,
          canRetry: true,
        });
      } else {
        setStep({
          kind: "error",
          title: "Connection error",
          message: "Could not reach the server. Check your connection and try again.",
          canRetry: true,
        });
      }
    }
  }

  async function handleLocationScan(locStr: string) {
    if (step.kind !== "asset_ready") return;
    const { asset } = step;
    const prevState = asset.state;
    const location = parseLocationString(locStr);

    setStep({ kind: "committing", asset, location: locStr });

    let writeBackFailed = false;
    try {
      const result = await api.scans.store({
        asset_tag: asset.asset_tag,
        location,
        user_id: getCurrentUserId(),
        scan_payload: locStr,
      });

      // Write-back: de-rack in facilities only when coming from in_service
      if (prevState === "in_service") {
        try {
          await api.mock.updateFacilities({
            tagged_id: asset.asset_tag,
            rack_location: null,
          });
        } catch {
          writeBackFailed = true;
        }
      }

      setStep({
        kind: "success",
        asset: result,
        prevState,
        newLocation: formatLocation(location),
        writeBackFailed,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_transition") {
        setStep({
          kind: "error",
          title: `Can't store this asset`,
          message: `This asset is ${stateLabel(asset.state)} and can't be moved to storage from that state.`,
          canRetry: true,
        });
      } else if (err instanceof ApiError) {
        setStep({
          kind: "error",
          title: "Store failed",
          message: err.message,
          canRetry: true,
        });
      } else {
        setStep({
          kind: "error",
          title: "Connection error",
          message: "Could not reach the server. Check your connection and try again.",
          canRetry: true,
        });
      }
    }
  }

  function reset() {
    setStep({ kind: "idle" });
    setResetKey((k) => k + 1);
  }

  // ── Idempotent confirmation (already stored) ────────────────────────────────
  // Calm blue card — same pattern as duplicate-receive. System is correct.

  if (step.kind === "idempotent") {
    return (
      <ScanSuccess
        variant="neutral"
        title="Already stored"
        assetName={step.asset.model}
        assetTag={step.asset.asset_tag}
        detail={step.detail}
        onReset={reset}
      />
    );
  }

  // ── Success ─────────────────────────────────────────────────────────────────

  if (step.kind === "success") {
    const wasInService = step.prevState === "in_service";
    const detail = wasInService
      ? `Removed from service. Moved to storage at ${step.newLocation}.${step.writeBackFailed ? "" : " Facilities updated."}`
      : `Moved to storage at ${step.newLocation}.`;
    return (
      <ScanSuccess
        title="Stored"
        assetName={step.asset.model}
        assetTag={step.asset.asset_tag}
        detail={detail}
        warningText={
          step.writeBackFailed
            ? "Facilities sync pending — this asset may appear as a ghost in the next reconciliation report. Notify your manager."
            : undefined
        }
        onReset={reset}
      />
    );
  }

  // ── Header ──────────────────────────────────────────────────────────────────

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold">Store</h1>
      <ScanModeToggle value={scanMode} onChange={handleModeChange} />
    </div>
  );

  // ── Asset ready — waiting for location scan ──────────────────────────────────

  if (step.kind === "asset_ready" || step.kind === "committing") {
    const { asset } = step;
    return (
      <div className="space-y-5">
        {header}

        {/* Asset preview */}
        <div className="rounded-lg border bg-white px-4 py-4 space-y-1">
          <p className="font-semibold text-gray-900">{asset.model}</p>
          <p className="text-xs font-mono text-gray-500">{asset.asset_tag}</p>
          <p className="text-sm text-gray-600">
            Currently{" "}
            <span className="font-medium">{stateLabel(asset.state)}</span>
            {asset.location.rack
              ? ` at ${formatLocation(asset.location)}`
              : ""}
          </p>
        </div>

        <p className="text-sm text-gray-500">
          Scan a storage location to move this asset to storage.
        </p>

        {step.kind === "committing" ? (
          <p className="text-sm text-gray-500">Storing…</p>
        ) : scanMode === "handheld" ? (
          <ScanInput
            key={`loc-${resetKey}`}
            onScan={handleLocationScan}
            placeholder="Scan storage location…"
            label="Storage location"
          />
        ) : (
          <CameraScanner
            onScan={handleLocationScan}
            active={true}
            label="Storage location"
          />
        )}
      </div>
    );
  }

  // ── Idle + fetching + error ─────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {header}

      {step.kind === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-1">
          <p className="font-semibold text-red-900 text-sm">{step.title}</p>
          <p className="text-sm text-red-800">{step.message}</p>
          {step.canRetry && (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-red-700 underline mt-1 min-h-[44px]"
            >
              Scan a different asset
            </button>
          )}
        </div>
      )}

      {step.kind === "fetching" && (
        <p className="text-sm text-gray-500">Looking up {step.tag}…</p>
      )}

      {scanMode === "handheld" ? (
        <ScanInput
          key={resetKey}
          onScan={handleTagScan}
          placeholder="Scan asset tag…"
          label="Asset tag"
          disabled={step.kind === "fetching"}
        />
      ) : (
        <CameraScanner
          onScan={handleTagScan}
          active={step.kind !== "fetching"}
          label="Asset tag"
        />
      )}
    </div>
  );
}
