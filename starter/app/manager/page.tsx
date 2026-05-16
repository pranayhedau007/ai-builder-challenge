import Link from "next/link";
import { createApiClient } from "@/lib/api-client";
import { reconcileAssets } from "@/lib/reconcile";
import type { ReconcileCategory } from "@/lib/reconcile";
import type { EventType, Event } from "@/lib/types";
import { AssetListClient } from "@/components/AssetListClient";

const EVENT_LABELS: Record<EventType, string> = {
  receive: "Received",
  store: "Stored",
  deploy: "Deployed",
  rma_open: "RMA opened",
  rma_receive_back: "Returned from RMA",
  dispose: "Disposed",
  duplicate_receive: "Re-scanned",
  transfer_custody: "Transferred",
};

const ATTENTION_LABELS = {
  drift: "Location conflict",
  stalled_received: "Stalled receiving",
  orphan: "Missing rack record",
} as const;

function formatActivityTime(iso: string): string {
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
    .replace(" ", "");
  if (isToday) return timeStr;
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${timeStr}`;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default async function ManagerPage() {
  const api = createApiClient();
  const now = new Date();

  const [assets, facilities, finance] = await Promise.all([
    api.assets.list(),
    api.mock.facilities(),
    api.mock.finance(),
  ]);

  const reconcile = reconcileAssets(assets, facilities, finance, now);

  // ── Attention required ────────────────────────────────────────────────────

  type AttentionItem = {
    kind: "drift" | "stalled_received" | "orphan";
    asset_tag: string;
    model: string;
    context: string;
  };

  const attentionItems: AttentionItem[] = [];

  for (const item of reconcile.items.filter((i) => i.category === "drift")) {
    attentionItems.push({
      kind: "drift",
      asset_tag: item.asset_tag,
      model: item.model,
      context: `ops: ${item.ops_location ?? "—"} · fac: ${item.facilities_location ?? "—"}`,
    });
  }

  for (const asset of assets) {
    if (
      asset.state === "received" &&
      now.getTime() - new Date(asset.updated_at).getTime() > SEVEN_DAYS_MS
    ) {
      const days = Math.floor(
        (now.getTime() - new Date(asset.updated_at).getTime()) / (1000 * 60 * 60 * 24),
      );
      attentionItems.push({
        kind: "stalled_received",
        asset_tag: asset.asset_tag,
        model: asset.model,
        context: `${days} days in receiving`,
      });
    }
  }

  for (const item of reconcile.items.filter((i) => i.category === "orphan_in_operations")) {
    attentionItems.push({
      kind: "orphan",
      asset_tag: item.asset_tag,
      model: item.model,
      context: "deployed, no rack record",
    });
  }

  // ── Activity since yesterday ──────────────────────────────────────────────

  type ActivityRow = {
    asset_tag: string;
    model: string;
    event_type: EventType;
    user_id: string;
    timestamp: string;
  };

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentAssets = assets
    .filter((a) => new Date(a.updated_at) >= yesterday)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 8);

  const eventsPerAsset: Event[][] = await Promise.all(
    recentAssets.map((a) =>
      api.assets.history(a.asset_tag).catch(() => [] as Event[]),
    ),
  );

  const activityRows: ActivityRow[] = recentAssets
    .map((asset, i) => {
      const events = eventsPerAsset[i] ?? [];
      const latest = events[0];
      if (!latest) return null;
      return {
        asset_tag: asset.asset_tag,
        model: asset.model,
        event_type: latest.event_type,
        user_id: latest.user_id,
        timestamp: latest.timestamp,
      };
    })
    .filter((r): r is ActivityRow => r !== null);

  // ── Asset list data ───────────────────────────────────────────────────────

  const nonCleanItems = reconcile.items.filter((i) => i.category !== "clean");
  const discrepancyTags = nonCleanItems.map((i) => i.asset_tag);
  const discrepancyCategories: Record<string, ReconcileCategory> = {};
  nonCleanItems.forEach((i) => {
    discrepancyCategories[i.asset_tag] = i.category;
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/manager/reconcile" className="text-sm text-blue-700 hover:underline">
          Reconciliation →
        </Link>
      </div>

      {/* Attention Required — above the fold */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Attention required
        </h2>
        {attentionItems.length === 0 ? (
          <p className="text-sm text-gray-500 py-1">Nothing needs you right now.</p>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 divide-y divide-amber-100">
            {attentionItems.map((item) => (
              <Link
                key={`${item.kind}-${item.asset_tag}`}
                href={`/manager/assets/${item.asset_tag}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-100 transition-colors"
              >
                <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
                  {ATTENTION_LABELS[item.kind]}
                </span>
                <span className="font-mono text-xs text-gray-600 w-20 shrink-0">
                  {item.asset_tag}
                </span>
                <span className="text-sm text-gray-900 flex-1 truncate">{item.model}</span>
                <span className="text-xs text-gray-500 shrink-0">{item.context}</span>
                <span className="text-gray-400 shrink-0">→</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Activity since yesterday — above the fold */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Activity since yesterday
        </h2>
        {activityRows.length === 0 ? (
          <p className="text-sm text-gray-500 py-1">No activity in the past 24 hours.</p>
        ) : (
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Tag</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Event</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Model</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">User</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Time</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {activityRows.map((row) => (
                  <tr key={row.asset_tag} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/manager/assets/${row.asset_tag}`}
                        className="font-mono text-xs text-blue-700 hover:underline"
                      >
                        {row.asset_tag}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-900 font-medium">
                      {EVENT_LABELS[row.event_type] ?? row.event_type}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{row.model}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{row.user_id}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">
                      {formatActivityTime(row.timestamp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Asset list — below the fold */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          All assets
        </h2>
        <AssetListClient
          assets={assets}
          discrepancyTags={discrepancyTags}
          discrepancyCategories={discrepancyCategories}
        />
      </section>
    </div>
  );
}
