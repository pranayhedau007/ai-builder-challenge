"use client";

import { useState, useEffect } from "react";
import { ScanInput } from "@/components/ScanInput";
import { ScanModeToggle } from "@/components/ScanModeToggle";
import { CameraScanner } from "@/components/CameraScanner";
import { ScanSuccess } from "@/components/ScanSuccess";
import { api, ApiError } from "@/lib/api-client";
import { getCurrentUserId } from "@/lib/auth";
import { getScanMode, setScanMode, type ScanMode } from "@/lib/scan-mode";
import type { Asset, AssetState } from "@/lib/types";

type Step =
  | { kind: "idle" }
  | { kind: "fetching"; tag: string }
  | { kind: "asset_ready"; asset: Asset }
  | { kind: "committing"; asset: Asset; badge: string }
  | { kind: "success"; asset: Asset; toCustodian: string }
  | { kind: "error"; title: string; message: string };

const STATE_LABELS: Partial<Record<AssetState, string>> = {
  received: "in receiving",
  stored: "in storage",
  in_service: "in service",
  rma_pending: "pending RMA",
  disposed: "disposed",
};

function checkState(asset: Asset): { title: string; message: string } | null {
  if (asset.state === "disposed")
    return {
      title: "Asset disposed",
      message: "This asset has been disposed. No scans are accepted.",
    };
  if (asset.state === "unreceived")
    return {
      title: "Not yet received",
      message:
        "This asset hasn't been received yet. Receive it first at /tech/receive.",
    };
  return null;
}

export default function TransferPage() {
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
      const stateErr = checkState(asset);
      if (stateErr) {
        setStep({ kind: "error", ...stateErr });
        return;
      }
      setStep({ kind: "asset_ready", asset });
    } catch (err) {
      if (err instanceof ApiError && err.code === "unknown_asset") {
        setStep({
          kind: "error",
          title: "Asset not found",
          message: `No asset with tag ${tag}. Check the label or try scanning again.`,
        });
      } else if (err instanceof ApiError && err.code === "invalid_tag_format") {
        setStep({
          kind: "error",
          title: "Invalid tag",
          message: `"${tag}" is not a valid asset tag. Tags start with C followed by 7 digits — for example, C0009001.`,
        });
      } else {
        setStep({
          kind: "error",
          title: "Connection error",
          message:
            "Could not reach the server. Check your connection and try again.",
        });
      }
    }
  }

  async function handleBadgeScan(badge: string) {
    if (step.kind !== "asset_ready") return;
    const { asset } = step;
    const fromUser = getCurrentUserId();

    setStep({ kind: "committing", asset, badge });

    try {
      const result = await api.scans.transfer({
        asset_tag: asset.asset_tag,
        to_custodian: badge,
        user_id: fromUser,
        scan_payload: badge,
      });
      setStep({ kind: "success", asset: result, toCustodian: badge });
    } catch (err) {
      if (err instanceof ApiError && err.code === "same_custodian") {
        setStep({
          kind: "asset_ready",
          asset: { ...asset, custodian: badge },
        });
        // Re-surface as inline error on the badge step
        setStep({
          kind: "error",
          title: "Same person",
          message: `This asset is already with ${badge}. Scan a different badge to hand it off.`,
        });
      } else if (err instanceof ApiError && err.code === "invalid_transition") {
        setStep({
          kind: "error",
          title: "Transfer not allowed",
          message: `Transfer is not allowed for an asset that is ${STATE_LABELS[asset.state] ?? asset.state}.`,
        });
      } else if (err instanceof ApiError) {
        setStep({
          kind: "error",
          title: "Transfer failed",
          message: err.message,
        });
      } else {
        setStep({
          kind: "error",
          title: "Connection error",
          message:
            "Could not reach the server. Check your connection and try again.",
        });
      }
    }
  }

  function reset() {
    setStep({ kind: "idle" });
    setResetKey((k) => k + 1);
  }

  // ── Success ─────────────────────────────────────────────────────────────────

  if (step.kind === "success") {
    const stateStr = STATE_LABELS[step.asset.state] ?? step.asset.state;
    return (
      <ScanSuccess
        title="Transferred"
        assetName={step.asset.model}
        assetTag={step.asset.asset_tag}
        detail={`Handed off to ${step.toCustodian}. State unchanged: ${stateStr}.`}
        onReset={reset}
      />
    );
  }

  // ── Header ──────────────────────────────────────────────────────────────────

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold">Transfer custody</h1>
      <ScanModeToggle value={scanMode} onChange={handleModeChange} />
    </div>
  );

  // ── Asset ready — waiting for badge scan ─────────────────────────────────────

  if (step.kind === "asset_ready" || step.kind === "committing") {
    const { asset } = step;
    const fromUser = getCurrentUserId();
    const stateStr = STATE_LABELS[asset.state] ?? asset.state;

    return (
      <div className="space-y-5">
        {header}

        <div className="rounded-lg border bg-white px-4 py-4 space-y-1">
          <p className="font-semibold text-gray-900">{asset.model}</p>
          <p className="text-xs font-mono text-gray-500">{asset.asset_tag}</p>
          <p className="text-sm text-gray-600">
            <span className="font-medium">{stateStr}</span>
            {" · "}currently with{" "}
            <span className="font-medium">{asset.custodian}</span>
          </p>
        </div>

        <p className="text-sm text-gray-700">
          Scan the receiving person&apos;s badge. You ({fromUser}) are the
          sender — only the receiver needs to scan.
        </p>

        {step.kind === "committing" ? (
          <p className="text-sm text-gray-500">Transferring to {step.badge}…</p>
        ) : scanMode === "handheld" ? (
          <ScanInput
            key={`badge-${resetKey}`}
            onScan={handleBadgeScan}
            placeholder="Scan receiving party's badge…"
            label="Receiver badge"
          />
        ) : (
          <CameraScanner
            onScan={handleBadgeScan}
            active={true}
            label="Receiver badge"
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
          <button
            type="button"
            onClick={reset}
            className="text-xs text-red-700 underline mt-1 min-h-[44px]"
          >
            Scan a different asset
          </button>
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
