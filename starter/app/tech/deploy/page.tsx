"use client";

import { useState, useEffect } from "react";
import { ScanInput } from "@/components/ScanInput";
import { ScanModeToggle } from "@/components/ScanModeToggle";
import { CameraScanner } from "@/components/CameraScanner";
import { ScanSuccess } from "@/components/ScanSuccess";
import { api, ApiError } from "@/lib/api-client";
import { getCurrentUserId } from "@/lib/auth";
import { getScanMode, setScanMode, type ScanMode } from "@/lib/scan-mode";
import { formatLocation, buildFacilitiesString } from "@/lib/location";
import type { Asset, AssetState } from "@/lib/types";

type Step =
  | { kind: "idle" }
  | { kind: "fetching"; tag: string }
  | { kind: "asset_ready"; asset: Asset; locationErr: string | null }
  | { kind: "committing"; asset: Asset }
  | { kind: "success"; asset: Asset; writeBackFailed: boolean }
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
  if (asset.state === "rma_pending")
    return {
      title: "Pending RMA",
      message:
        "This asset is pending RMA and can't be deployed. Contact your manager.",
    };
  if (asset.state === "in_service")
    return {
      title: "Already deployed",
      message: `This asset is already in service${asset.location.rack ? ` at ${formatLocation(asset.location)}` : ""}. To move it, store it first and then deploy again.`,
    };
  return null;
}

export default function DeployPage() {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [scanMode, setScanModeState] = useState<ScanMode>("handheld");
  const [resetKey, setResetKey] = useState(0);
  const [locForm, setLocForm] = useState({
    site: "",
    room: "",
    row: "",
    rack: "",
    ru: "",
  });

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
      // Pre-fill site from current location if available
      setLocForm({
        site: asset.location.site ?? "",
        room: asset.location.room ?? "",
        row: asset.location.row ?? "",
        rack: "",
        ru: "",
      });
      setStep({ kind: "asset_ready", asset, locationErr: null });
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

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== "asset_ready") return;

    // Client-side validation — rack and ru are both required
    if (!locForm.rack.trim() || !locForm.ru.trim()) {
      setStep({
        ...step,
        locationErr:
          "Rack and rack unit are both required to deploy. Fill in the rack (e.g. B-04) and rack unit (e.g. U18) to continue.",
      });
      return;
    }

    const { asset } = step;
    const location = {
      site: locForm.site.trim() || "Unknown",
      room: locForm.room.trim() || null,
      row: locForm.row.trim() || null,
      rack: locForm.rack.trim(),
      ru: locForm.ru.trim(),
    };

    setStep({ kind: "committing", asset });

    let writeBackFailed = false;
    try {
      const result = await api.scans.deploy({
        asset_tag: asset.asset_tag,
        location,
        user_id: getCurrentUserId(),
        scan_payload: asset.asset_tag,
      });

      // Write-back: facilities (set rack location) + finance (capitalize)
      const rackLocationStr = buildFacilitiesString(location);
      const today = new Date().toISOString().split("T")[0] ?? new Date().toISOString();

      try {
        await api.mock.updateFacilities({
          tagged_id: asset.asset_tag,
          rack_location: rackLocationStr,
        });
        await api.mock.updateFinance({
          tag: asset.asset_tag,
          site: location.site,
          status: "capitalized",
          capitalized_on: today,
        });
      } catch {
        writeBackFailed = true;
      }

      setStep({ kind: "success", asset: result, writeBackFailed });
    } catch (err) {
      if (err instanceof ApiError && err.code === "incomplete_deploy_location") {
        setStep({
          kind: "asset_ready",
          asset,
          locationErr:
            "Rack and rack unit are both required to deploy. Fill in the rack (e.g. B-04) and rack unit (e.g. U18) to continue.",
        });
      } else if (err instanceof ApiError && err.code === "invalid_transition") {
        setStep({
          kind: "error",
          title: "Can't deploy this asset",
          message: `This asset is ${STATE_LABELS[asset.state] ?? asset.state} and can't be deployed from that state.`,
        });
      } else if (err instanceof ApiError) {
        setStep({
          kind: "asset_ready",
          asset,
          locationErr: err.message,
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
    setLocForm({ site: "", room: "", row: "", rack: "", ru: "" });
    setResetKey((k) => k + 1);
  }

  // ── Success ─────────────────────────────────────────────────────────────────

  if (step.kind === "success") {
    const loc = step.asset.location;
    const locationStr = formatLocation(loc);
    return (
      <ScanSuccess
        title="Deployed"
        assetName={step.asset.model}
        assetTag={step.asset.asset_tag}
        detail={`Now in service at ${locationStr}. Facilities and finance updated.`}
        warningText={
          step.writeBackFailed
            ? "Facilities or finance sync failed. This asset may appear as an orphan in the next reconciliation report. Notify your manager."
            : undefined
        }
        onReset={reset}
      />
    );
  }

  // ── Header ──────────────────────────────────────────────────────────────────

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold">Deploy</h1>
      <ScanModeToggle value={scanMode} onChange={handleModeChange} />
    </div>
  );

  // ── Asset ready — location form ──────────────────────────────────────────────

  if (step.kind === "asset_ready" || step.kind === "committing") {
    const asset =
      step.kind === "asset_ready" ? step.asset : step.asset;
    const locationErr =
      step.kind === "asset_ready" ? step.locationErr : null;

    return (
      <div className="space-y-5">
        {header}

        <div className="rounded-lg border bg-white px-4 py-4 space-y-1">
          <p className="font-semibold text-gray-900">{asset.model}</p>
          <p className="text-xs font-mono text-gray-500">{asset.asset_tag}</p>
          <p className="text-sm text-gray-600">
            Currently{" "}
            <span className="font-medium">
              {STATE_LABELS[asset.state] ?? asset.state}
            </span>
          </p>
        </div>

        <form onSubmit={handleDeploy} className="space-y-4">
          <p className="text-sm font-medium text-gray-700">Deploy location</p>

          {locationErr && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {locationErr}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Site</span>
              <input
                type="text"
                value={locForm.site}
                onChange={(e) =>
                  setLocForm((p) => ({ ...p, site: e.target.value }))
                }
                placeholder="Lab-Building-A"
                className="mt-1 w-full p-3 rounded-lg border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-base min-h-[44px]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Room</span>
              <input
                type="text"
                value={locForm.room}
                onChange={(e) =>
                  setLocForm((p) => ({ ...p, room: e.target.value }))
                }
                placeholder="Bay-12"
                className="mt-1 w-full p-3 rounded-lg border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-base min-h-[44px]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Row</span>
              <input
                type="text"
                value={locForm.row}
                onChange={(e) =>
                  setLocForm((p) => ({ ...p, row: e.target.value }))
                }
                placeholder="Aisle-3 (optional)"
                className="mt-1 w-full p-3 rounded-lg border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-base min-h-[44px]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">
                Rack *
              </span>
              <input
                type="text"
                required
                value={locForm.rack}
                onChange={(e) =>
                  setLocForm((p) => ({ ...p, rack: e.target.value }))
                }
                placeholder="B-04"
                className="mt-1 w-full p-3 rounded-lg border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-base min-h-[44px]"
                autoFocus
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-gray-600">
              Rack unit *
            </span>
            <input
              type="text"
              required
              value={locForm.ru}
              onChange={(e) =>
                setLocForm((p) => ({ ...p, ru: e.target.value }))
              }
              placeholder="U18"
              className="mt-1 w-full p-3 rounded-lg border-2 border-gray-300 focus:border-blue-600 focus:outline-none text-base min-h-[44px]"
            />
          </label>

          <button
            type="submit"
            disabled={step.kind === "committing"}
            className="w-full py-4 rounded-xl bg-gray-900 text-white font-semibold text-lg min-h-[52px] disabled:opacity-50"
          >
            {step.kind === "committing" ? "Deploying…" : "Deploy"}
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

      <p className="text-xs text-gray-400">
        Rack and rack unit are required. Site and room are optional but
        recommended.
      </p>
    </div>
  );
}
