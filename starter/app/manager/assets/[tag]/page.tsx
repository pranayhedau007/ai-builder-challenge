import Link from "next/link";
import { notFound } from "next/navigation";
import { createApiClient, ApiError } from "@/lib/api-client";
import { categorizeAsset } from "@/lib/reconcile";
import { formatLocation } from "@/lib/location";
import type { Event, EventType, AssetState } from "@/lib/types";

const EVENT_LABELS: Record<EventType, string> = {
  receive: "Received",
  store: "Stored",
  deploy: "Deployed",
  rma_open: "RMA opened",
  rma_receive_back: "Returned from RMA",
  dispose: "Disposed",
  duplicate_receive: "Re-scanned (already received)",
  transfer_custody: "Custody transferred",
};

const STATE_LABELS: Record<AssetState, string> = {
  unreceived: "Unreceived",
  received: "Received",
  stored: "In storage",
  in_service: "In service",
  rma_pending: "Pending RMA",
  disposed: "Disposed",
};

const STATE_COLORS: Record<AssetState, string> = {
  unreceived: "bg-red-100 text-red-800",
  received: "bg-yellow-100 text-yellow-800",
  stored: "bg-blue-100 text-blue-800",
  in_service: "bg-green-100 text-green-800",
  rma_pending: "bg-orange-100 text-orange-800",
  disposed: "bg-gray-100 text-gray-600",
};

const RECONCILE_LABELS: Record<string, string> = {
  drift: "Location conflict",
  ghost_in_facilities: "Ghost in facilities",
  orphan_in_operations: "Missing rack record",
  finance_lag: "Finance lag",
  expected_gap: "Expected gap",
};

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function EventRow({ event }: { event: Event }) {
  return (
    <div className="flex gap-4 py-3.5 border-b border-gray-100 last:border-0">
      <div className="shrink-0 w-40 text-xs text-gray-400 pt-0.5 tabular-nums">
        {formatTimestamp(event.timestamp)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm">
          {EVENT_LABELS[event.event_type] ?? event.event_type}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 space-x-1">
          {event.from_state && (
            <span>{STATE_LABELS[event.from_state] ?? event.from_state} →</span>
          )}
          <span>{STATE_LABELS[event.to_state] ?? event.to_state}</span>
          <span>·</span>
          <span>{event.user_id}</span>
          {event.to_location?.rack && (
            <>
              <span>·</span>
              <span>{formatLocation(event.to_location)}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<React.ReactElement> {
  const { tag } = await params;
  const api = createApiClient();

  let asset, events, facilities, finance;
  try {
    [asset, events, facilities, finance] = await Promise.all([
      api.assets.get(tag),
      api.assets.history(tag),
      api.mock.facilities(),
      api.mock.finance(),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.code === "unknown_asset") notFound();
    throw err;
  }

  const facRecord = facilities.find((f) => f.tagged_id === tag);
  const finRecord = finance.find((f) => f.tag === tag);
  const reconcile = categorizeAsset(asset, facRecord, finRecord);
  const opsLocStr = asset.location.rack ? formatLocation(asset.location) : null;

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link href="/manager" className="text-sm text-gray-500 hover:underline">
        ← All assets
      </Link>

      {/* Asset summary */}
      <div className="rounded-lg border bg-white px-5 py-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{asset.model}</h1>
            <p className="text-xs text-gray-400 mt-0.5">{asset.manufacturer}</p>
          </div>
          <span
            className={`shrink-0 px-3 py-1 rounded-full text-sm font-medium ${STATE_COLORS[asset.state]}`}
          >
            {STATE_LABELS[asset.state]}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
          <span className="font-mono text-xs text-gray-500">{asset.asset_tag}</span>
          <span>
            Custodian: <span className="font-medium">{asset.custodian}</span>
          </span>
          {opsLocStr && (
            <span>
              Location: <span className="font-medium">{opsLocStr}</span>
            </span>
          )}
          <span>
            Serial: <span className="font-medium">{asset.serial}</span>
          </span>
        </div>
        {reconcile.category !== "clean" && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
            <span className="font-semibold">
              {RECONCILE_LABELS[reconcile.category] ?? reconcile.category}
            </span>
            {" — "}
            {reconcile.explanation}
            {reconcile.action && (
              <span className="block mt-1 text-amber-700">
                What to do: {reconcile.action}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Event log — dominant element */}
      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-3">
          Event log{" "}
          <span className="text-gray-400 font-normal text-sm">
            ({events.length} event{events.length !== 1 ? "s" : ""})
          </span>
        </h2>
        <div className="rounded-lg border bg-white px-5">
          {events.length === 0 ? (
            <p className="py-8 text-sm text-gray-400 text-center">
              No events recorded for this asset.
            </p>
          ) : (
            events.map((e) => <EventRow key={e.id} event={e} />)
          )}
        </div>
      </div>

      {/* Cross-system comparison */}
      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-3">
          Cross-system view
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {/* Operations */}
          <div className="rounded-lg border bg-white px-4 py-4 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Operations
            </p>
            <div className="space-y-1.5 text-sm">
              <p>
                <span className="text-gray-500">State</span>
                <br />
                <span className="font-medium">{STATE_LABELS[asset.state]}</span>
              </p>
              <p>
                <span className="text-gray-500">Custodian</span>
                <br />
                <span className="font-medium">{asset.custodian}</span>
              </p>
              <p>
                <span className="text-gray-500">Location</span>
                <br />
                <span className="font-medium">{opsLocStr ?? "—"}</span>
              </p>
            </div>
          </div>

          {/* Facilities */}
          <div className="rounded-lg border bg-white px-4 py-4 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Facilities
            </p>
            {facRecord ? (
              <div className="space-y-1.5 text-sm">
                <p>
                  <span className="text-gray-500">Rack</span>
                  <br />
                  <span className="font-medium">{facRecord.rack_location}</span>
                </p>
                <p>
                  <span className="text-gray-500">Last observed</span>
                  <br />
                  <span className="font-medium">{formatDate(facRecord.last_observed)}</span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">No record</p>
            )}
          </div>

          {/* Finance */}
          <div className="rounded-lg border bg-white px-4 py-4 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Finance
            </p>
            {finRecord ? (
              <div className="space-y-1.5 text-sm">
                <p>
                  <span className="text-gray-500">Status</span>
                  <br />
                  <span className="font-medium">{finRecord.status}</span>
                </p>
                <p>
                  <span className="text-gray-500">Book value</span>
                  <br />
                  <span className="font-medium">
                    ${finRecord.book_value_usd.toLocaleString()}
                  </span>
                </p>
                {finRecord.capitalized_on && (
                  <p>
                    <span className="text-gray-500">Capitalized</span>
                    <br />
                    <span className="font-medium">
                      {formatDate(finRecord.capitalized_on)}
                    </span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">No record</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
