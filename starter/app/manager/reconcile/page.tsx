"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ReconcileReport, ReconcileCategory, ReconcileItem } from "@/lib/reconcile";
import { CATEGORY_RANK } from "@/lib/reconcile";

const CATEGORY_LABELS: Record<ReconcileCategory, string> = {
  drift: "Location conflicts",
  ghost_in_facilities: "Ghost in facilities",
  orphan_in_operations: "Missing rack records",
  finance_lag: "Finance lag",
  expected_gap: "Expected gap",
  clean: "Clean",
};

const CATEGORY_DESCRIPTIONS: Record<
  Exclude<ReconcileCategory, "clean">,
  { summary: string; action: string }
> = {
  drift: {
    summary:
      "Two or more systems disagree about this asset. Most commonly: operations and facilities show different rack locations.",
    action: "Walk the physical location and update whichever system is wrong.",
  },
  ghost_in_facilities: {
    summary:
      "Facilities shows this asset in a rack, but operations says it's in storage or receiving.",
    action:
      "Walk the physical location, then update whichever system has it wrong.",
  },
  orphan_in_operations: {
    summary:
      "Operations shows this asset deployed, but facilities has no rack record for it.",
    action:
      "Confirm where it's racked physically, then file the missing facilities entry.",
  },
  finance_lag: {
    summary:
      "This asset has been in service for over a week with no capitalization record in finance. Usually a timing issue, not a problem.",
    action:
      "Clears at billing close. If it's been more than one billing cycle, follow up with finance.",
  },
  expected_gap: {
    summary:
      "Operations shows this asset disposed or in RMA, but finance still carries a book value. This is normal — finance retires the record at the next billing close.",
    action: "No action — clears at next finance close.",
  },
};

const SECONDARY_LABELS: Partial<Record<ReconcileCategory, string>> = {
  ghost_in_facilities: "ghost in facilities",
  orphan_in_operations: "missing rack record",
  finance_lag: "finance lag",
  expected_gap: "expected gap",
  drift: "location conflict",
};

const NON_CLEAN_CATEGORIES = (
  Object.keys(CATEGORY_RANK) as ReconcileCategory[]
)
  .filter((c): c is Exclude<ReconcileCategory, "clean"> => c !== "clean")
  .sort((a, b) => CATEGORY_RANK[a] - CATEGORY_RANK[b]);

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function ItemRow({ item }: { item: ReconcileItem }) {
  return (
    <tr className="hover:bg-gray-50 border-b border-gray-100 last:border-0">
      <td className="px-4 py-3 font-mono text-xs">
        <Link
          href={`/manager/assets/${item.asset_tag}`}
          className="text-blue-700 hover:underline"
        >
          {item.asset_tag}
        </Link>
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">{item.model}</td>
      <td className="px-4 py-3 text-xs text-gray-500">{item.state}</td>
      <td className="px-4 py-3 text-xs">
        <div className="text-gray-600">{item.ops_location ?? "—"}</div>
        {item.facilities_location &&
          item.facilities_location !== item.ops_location && (
            <div className="text-amber-700 mt-0.5">
              fac: {item.facilities_location}
            </div>
          )}
      </td>
      <td className="px-4 py-3 text-xs text-gray-500">
        {item.finance_status ?? "—"}
        {item.book_value_usd != null && (
          <span className="ml-1 text-gray-400">
            ${item.book_value_usd.toLocaleString()}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {item.secondaryFlags.map((flag) => (
            <span
              key={flag}
              className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500"
            >
              also: {SECONDARY_LABELS[flag] ?? flag.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/manager/assets/${item.asset_tag}`}
          className="text-xs text-gray-400 hover:text-gray-700"
        >
          →
        </Link>
      </td>
    </tr>
  );
}

function CategorySection({
  category,
  items,
}: {
  category: Exclude<ReconcileCategory, "clean">;
  items: ReconcileItem[];
}) {
  const [expanded, setExpanded] = useState(true);
  const desc = CATEGORY_DESCRIPTIONS[category];

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-5 py-4 bg-white hover:bg-gray-50 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-900">
            {CATEGORY_LABELS[category]}
          </span>
          <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-100 text-amber-800">
            {items.length}
          </span>
        </div>
        <span className="text-gray-400 text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          <div className="px-5 py-3 bg-gray-50 text-sm text-gray-700 space-y-1">
            <p>{desc.summary}</p>
            <p className="text-gray-500">
              <span className="font-medium">What to do:</span> {desc.action}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-y border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">
                    Tag
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">
                    Model
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">
                    State
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">
                    Location
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">
                    Finance
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">
                    Also
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {items.map((item) => (
                  <ItemRow key={item.asset_tag} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ManagerReconcilePage() {
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/reconcile")
      .then((r) => r.json() as Promise<ReconcileReport>)
      .then(setReport)
      .catch(() =>
        setError(
          "Failed to load the reconciliation report. Check your connection and try again.",
        ),
      );
  }, []);

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Reconciliation report</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Reconciliation report</h1>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  const totalAssets = Object.values(report.counts).reduce((a, b) => a + b, 0);
  const cleanCount = report.counts.clean;
  const attentionCount = totalAssets - cleanCount;

  const itemsByCategory: Partial<Record<ReconcileCategory, ReconcileItem[]>> =
    {};
  for (const item of report.items) {
    if (!itemsByCategory[item.category]) itemsByCategory[item.category] = [];
    itemsByCategory[item.category]!.push(item);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reconciliation report</h1>
          <p className="text-xs text-gray-400 mt-1">
            Run as of {formatTime(report.generated_at)}
          </p>
        </div>
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">
          ← Dashboard
        </Link>
      </div>

      {/* Summary — clean as count, not section */}
      <div className="rounded-lg border bg-white px-5 py-4 space-y-3">
        <p className="text-sm text-gray-700">
          <span className="font-semibold text-green-700">
            {cleanCount} of {totalAssets}
          </span>{" "}
          assets are clean — all three systems agree.
          {attentionCount > 0 && (
            <span className="ml-2 font-semibold text-amber-800">
              {attentionCount} need attention.
            </span>
          )}
        </p>
        {attentionCount > 0 && (
          <div className="flex flex-wrap gap-2">
            {NON_CLEAN_CATEGORIES.map((cat) => {
              const count = report.counts[cat];
              if (!count) return null;
              return (
                <span
                  key={cat}
                  className="px-2.5 py-1 rounded-full text-xs bg-amber-50 border border-amber-200 text-amber-800"
                >
                  {count} · {CATEGORY_LABELS[cat]}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Category sections — non-clean only, expandable */}
      <div className="space-y-3">
        {NON_CLEAN_CATEGORIES.map((cat) => {
          const items = itemsByCategory[cat];
          if (!items || items.length === 0) return null;
          return (
            <CategorySection key={cat} category={cat} items={items} />
          );
        })}
      </div>

      {attentionCount === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">
          Nothing needs attention. Run again Monday to check for drift.
        </p>
      )}
    </div>
  );
}
