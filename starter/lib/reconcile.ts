import type { Asset, FacilitiesRecord, FinanceRecord } from "./types";

export type ReconcileCategory =
  | "drift"
  | "ghost_in_facilities"
  | "orphan_in_operations"
  | "finance_lag"
  | "expected_gap"
  | "clean";

export type ReconcileItem = {
  asset_tag: string;
  model: string;
  manufacturer: string;
  state: string;
  category: ReconcileCategory;
  ops_location: string | null;
  facilities_location: string | null;
  finance_status: string | null;
  book_value_usd: number | null;
  explanation: string;
  action: string;
};

export type ReconcileReport = {
  generated_at: string;
  counts: Record<ReconcileCategory, number>;
  items: ReconcileItem[];
};

// Flag finance lag after this many days deployed without capitalization
const FINANCE_LAG_THRESHOLD_DAYS = 7;

export function buildOpsLocation(asset: Asset): string | null {
  const { site, room, row, rack, ru } = asset.location;
  if (!rack) return null;
  return [site, room, row, rack, ru].filter(Boolean).join("/");
}

export function categorizeAsset(
  asset: Asset,
  facRecord: FacilitiesRecord | undefined,
  finRecord: FinanceRecord | undefined,
  now: Date = new Date(),
): ReconcileItem {
  const opsLoc = buildOpsLocation(asset);
  const facLoc = facRecord?.rack_location ?? null;
  const finStatus = finRecord?.status ?? null;
  const bookValue = finRecord?.book_value_usd ?? null;

  const base = {
    asset_tag: asset.asset_tag,
    model: asset.model,
    manufacturer: asset.manufacturer,
    state: asset.state,
    ops_location: opsLoc,
    facilities_location: facLoc,
    finance_status: finStatus,
    book_value_usd: bookValue,
  };

  // Drift: both systems have a location entry, but they disagree on where it is
  if (asset.state === "in_service" && opsLoc && facLoc && opsLoc !== facLoc) {
    return {
      ...base,
      category: "drift",
      explanation: `Operations shows this at ${opsLoc}, but facilities shows ${facLoc}. The asset was likely moved without updating one of the systems.`,
      action:
        "Walk the rack and confirm the physical location. Update whichever system is wrong.",
    };
  }

  // Ghost in facilities: facilities has a rack entry but ops says it is in storage or receiving
  if (
    (asset.state === "stored" || asset.state === "received") &&
    facLoc !== null
  ) {
    return {
      ...base,
      category: "ghost_in_facilities",
      explanation: `Facilities shows this at ${facLoc}, but operations says it is ${asset.state === "stored" ? "in storage" : "in receiving"}. Someone likely moved it out of the rack without scanning.`,
      action:
        "Confirm the asset is not racked. If correct, clear the facilities entry.",
    };
  }

  // Orphan in operations: ops says deployed, facilities has no rack record
  if (asset.state === "in_service" && facLoc === null) {
    return {
      ...base,
      category: "orphan_in_operations",
      explanation: `Operations shows this deployed${opsLoc ? ` at ${opsLoc}` : ""}, but facilities has no rack record. A write-back may have failed when it was deployed.`,
      action:
        "Verify the asset is physically at the rack. If yes, add the facilities entry.",
    };
  }

  // Finance lag: in_service but finance has not capitalized it yet, and it has been long enough
  if (asset.state === "in_service" && finRecord && finStatus !== "capitalized") {
    const deployedAt = new Date(asset.updated_at);
    const ageDays =
      (now.getTime() - deployedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > FINANCE_LAG_THRESHOLD_DAYS) {
      return {
        ...base,
        category: "finance_lag",
        explanation: `This asset has been in service for ${Math.floor(ageDays)} days, but finance still shows "${finStatus}" instead of capitalized. Usually resolves at billing close.`,
        action:
          "If it has been longer than one billing cycle, ask finance to confirm capitalization.",
      };
    }
  }

  // Expected gap: ops shows disposed or rma_pending, finance still carries book value
  if (
    (asset.state === "disposed" || asset.state === "rma_pending") &&
    finRecord &&
    (finStatus === "capitalized" || finStatus === "impaired")
  ) {
    return {
      ...base,
      category: "expected_gap",
      explanation: `This asset is ${asset.state === "disposed" ? "disposed" : "pending RMA"} in operations, but finance still carries it${bookValue != null ? ` at $${bookValue.toLocaleString()}` : ""} as "${finStatus}". Finance retires it at the next close.`,
      action:
        "No action needed now. Finance will update this at the next billing close.",
    };
  }

  return {
    ...base,
    category: "clean",
    explanation: "All systems agree.",
    action: "",
  };
}

const CATEGORY_RANK: Record<ReconcileCategory, number> = {
  drift: 0,
  ghost_in_facilities: 1,
  orphan_in_operations: 2,
  finance_lag: 3,
  expected_gap: 4,
  clean: 5,
};

export function reconcileAssets(
  assets: Asset[],
  facilities: FacilitiesRecord[],
  finance: FinanceRecord[],
  now: Date = new Date(),
): ReconcileReport {
  const facByTag: Record<string, FacilitiesRecord> = {};
  facilities.forEach((f) => {
    facByTag[f.tagged_id] = f;
  });

  const finByTag: Record<string, FinanceRecord> = {};
  finance.forEach((f) => {
    finByTag[f.tag] = f;
  });

  const items = assets.map((asset) =>
    categorizeAsset(
      asset,
      facByTag[asset.asset_tag],
      finByTag[asset.asset_tag],
      now,
    ),
  );

  const counts: Record<ReconcileCategory, number> = {
    drift: 0,
    ghost_in_facilities: 0,
    orphan_in_operations: 0,
    finance_lag: 0,
    expected_gap: 0,
    clean: 0,
  };
  items.forEach((item) => {
    counts[item.category]++;
  });

  items.sort((a, b) => {
    const rankDiff = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
    return rankDiff !== 0 ? rankDiff : a.asset_tag.localeCompare(b.asset_tag);
  });

  return {
    generated_at: now.toISOString(),
    counts,
    items,
  };
}
