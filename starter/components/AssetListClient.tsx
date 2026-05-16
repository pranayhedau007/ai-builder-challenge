"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { Asset, AssetState } from "@/lib/types";
import type { ReconcileCategory } from "@/lib/reconcile";

const PAGE_SIZE = 50;

const STATE_LABELS: Record<AssetState, string> = {
  unreceived: "Unreceived",
  received: "Received",
  stored: "Stored",
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

const DISCREPANCY_LABELS: Partial<Record<ReconcileCategory, string>> = {
  drift: "Location conflict",
  ghost_in_facilities: "Ghost in facilities",
  orphan_in_operations: "Missing rack record",
  finance_lag: "Finance lag",
  expected_gap: "Expected gap",
};

interface Props {
  assets: Asset[];
  discrepancyTags: string[];
  discrepancyCategories: Record<string, ReconcileCategory>;
}

export function AssetListClient({ assets, discrepancyTags, discrepancyCategories }: Props) {
  const [filterState, setFilterState] = useState("");
  const [filterSite, setFilterSite] = useState("");
  const [filterCustodian, setFilterCustodian] = useState("");
  const [filterDiscrepancy, setFilterDiscrepancy] = useState(false);
  const [page, setPage] = useState(1);

  const discrepancySet = useMemo(() => new Set(discrepancyTags), [discrepancyTags]);

  const sites = useMemo(
    () => [...new Set(assets.map((a) => a.location.site))].sort(),
    [assets],
  );

  const custodians = useMemo(
    () => [...new Set(assets.map((a) => a.custodian))].sort(),
    [assets],
  );

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (filterState && a.state !== filterState) return false;
      if (filterSite && a.location.site !== filterSite) return false;
      if (filterCustodian && a.custodian !== filterCustodian) return false;
      if (filterDiscrepancy && !discrepancySet.has(a.asset_tag)) return false;
      return true;
    });
  }, [assets, filterState, filterSite, filterCustodian, filterDiscrepancy, discrepancySet]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function resetPage() {
    setPage(1);
  }

  const startRow = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const endRow = Math.min(safePage * PAGE_SIZE, filtered.length);

  return (
    <div className="space-y-4">
      {/* Filter bar — exactly four filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={filterState}
          onChange={(e) => { setFilterState(e.target.value); resetPage(); }}
          className="px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white"
        >
          <option value="">All states</option>
          {(Object.keys(STATE_LABELS) as AssetState[]).map((s) => (
            <option key={s} value={s}>{STATE_LABELS[s]}</option>
          ))}
        </select>

        <select
          value={filterSite}
          onChange={(e) => { setFilterSite(e.target.value); resetPage(); }}
          className="px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white"
        >
          <option value="">All locations</option>
          {sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={filterCustodian}
          onChange={(e) => { setFilterCustodian(e.target.value); resetPage(); }}
          className="px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white"
        >
          <option value="">All custodians</option>
          {custodians.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filterDiscrepancy}
            onChange={(e) => { setFilterDiscrepancy(e.target.checked); resetPage(); }}
            className="w-4 h-4 rounded"
          />
          <span className="font-medium text-amber-800">Has discrepancy</span>
        </label>
      </div>

      {/* Table */}
      {pageItems.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">
          No assets match the current filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 text-xs">Tag</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 text-xs">Model</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 text-xs">State</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 text-xs">Custodian</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 text-xs">Location</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {pageItems.map((a) => {
                const discrepancy = discrepancyCategories[a.asset_tag];
                const locStr = a.location.rack
                  ? [a.location.site, a.location.rack].filter(Boolean).join(" / ")
                  : a.location.site;
                return (
                  <tr key={a.asset_tag} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/manager/assets/${a.asset_tag}`}
                        className="font-mono text-xs text-blue-700 hover:underline"
                      >
                        {a.asset_tag}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-900">{a.model}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATE_COLORS[a.state]}`}>
                        {STATE_LABELS[a.state]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{a.custodian}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{locStr}</td>
                    <td className="px-4 py-3 text-right">
                      {discrepancy && (
                        <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800 font-medium">
                          {DISCREPANCY_LABELS[discrepancy] ?? discrepancy}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>
          {filtered.length === 0
            ? "No results"
            : `Showing ${startRow}–${endRow} of ${filtered.length}`}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm disabled:opacity-40 hover:bg-gray-50 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span>Page {safePage} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm disabled:opacity-40 hover:bg-gray-50 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
