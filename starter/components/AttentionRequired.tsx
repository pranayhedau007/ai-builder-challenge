"use client";

import { useState } from "react";
import Link from "next/link";

export type AttentionItem = {
  kind: "drift" | "stalled_received" | "orphan";
  asset_tag: string;
  model: string;
  context: string;
};

const ATTENTION_LABELS: Record<AttentionItem["kind"], string> = {
  drift: "Location conflict",
  stalled_received: "Stalled receiving",
  orphan: "Missing rack record",
};

// Show at most this many rows per category before collapsing the rest.
const CAP = 5;

export function AttentionRequired({ items }: { items: AttentionItem[] }) {
  const [expandedKinds, setExpandedKinds] = useState<Set<string>>(new Set());

  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-1">Nothing needs you right now.</p>
    );
  }

  // Group by kind while preserving insertion order (drift → stalled → orphan).
  const groupMap = new Map<AttentionItem["kind"], AttentionItem[]>();
  for (const item of items) {
    const bucket = groupMap.get(item.kind) ?? [];
    bucket.push(item);
    groupMap.set(item.kind, bucket);
  }

  function toggle(kind: string) {
    setExpandedKinds((prev) => {
      const next = new Set(prev);
      next.has(kind) ? next.delete(kind) : next.add(kind);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 divide-y divide-amber-100">
      {[...groupMap.entries()].map(([kind, kindItems]) => {
        const isExpanded = expandedKinds.has(kind);
        const visible = isExpanded ? kindItems : kindItems.slice(0, CAP);
        const overflow = kindItems.length - CAP;

        return (
          <div key={kind}>
            {visible.map((item) => (
              <Link
                key={item.asset_tag}
                href={`/manager/assets/${item.asset_tag}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-100 transition-colors border-b border-amber-100 last:border-0"
              >
                <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
                  {ATTENTION_LABELS[kind]}
                </span>
                <span className="font-mono text-xs text-gray-600 w-20 shrink-0">
                  {item.asset_tag}
                </span>
                <span className="text-sm text-gray-900 flex-1 truncate">
                  {item.model}
                </span>
                <span className="text-xs text-gray-500 shrink-0">
                  {item.context}
                </span>
                <span className="text-gray-400 shrink-0">→</span>
              </Link>
            ))}

            {overflow > 0 && !isExpanded && (
              <button
                type="button"
                onClick={() => toggle(kind)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-100 transition-colors text-left"
              >
                <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
                  {ATTENTION_LABELS[kind]}
                </span>
                <span className="text-sm text-amber-800">
                  + {overflow} more — click to expand
                </span>
              </button>
            )}

            {overflow > 0 && isExpanded && (
              <button
                type="button"
                onClick={() => toggle(kind)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-100 transition-colors text-left"
              >
                <span className="text-sm text-amber-700 px-4">Show fewer</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
