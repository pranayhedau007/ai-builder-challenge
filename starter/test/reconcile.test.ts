import { describe, expect, it } from "vitest";
import {
  categorizeAsset,
  reconcileAssets,
  buildOpsLocation,
  CATEGORY_RANK,
} from "@/lib/reconcile";
import type { Asset, FacilitiesRecord, FinanceRecord } from "@/lib/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date("2024-08-01T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Ops: site=Lab-A, room=Room-1, rack=R-01, ru=U10
// → buildOpsLocation → "Lab-A/Room-1/R-01/U10"
const OPS_RACK = "Lab-A/Room-1/R-01/U10";

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    asset_tag: "C0000001",
    serial: "SN-TEST-001",
    model: "Test Device",
    manufacturer: "TestCo",
    asset_class: "compute",
    state: "in_service",
    location: { site: "Lab-A", room: "Room-1", row: null, rack: "R-01", ru: "U10" },
    custodian: "tech-test",
    parent_asset_tag: null,
    procurement_note: null,
    created_at: daysAgo(30),
    updated_at: daysAgo(30),
    ...overrides,
  };
}

function noRackLocation() {
  return { site: "Lab-A", room: null, row: null, rack: null, ru: null } as const;
}

function makeFac(tag: string, rackLocation = OPS_RACK): FacilitiesRecord {
  return {
    space_id: "SPC-001",
    tagged_id: tag,
    rack_location: rackLocation,
    last_observed: daysAgo(1),
  };
}

function makeFin(tag: string, overrides: Partial<FinanceRecord> = {}): FinanceRecord {
  return {
    finance_id: "FIN-001",
    tag,
    site: "Lab-A",
    book_value_usd: 10000,
    status: "capitalized",
    capitalized_on: daysAgo(30),
    ...overrides,
  };
}

// ── buildOpsLocation ──────────────────────────────────────────────────────────

describe("buildOpsLocation", () => {
  it("returns null when rack is absent", () => {
    expect(buildOpsLocation(makeAsset({ location: noRackLocation() }))).toBeNull();
  });

  it("joins all non-null segments with /", () => {
    const asset = makeAsset({
      location: { site: "Lab-A", room: "Room-1", row: "Aisle-3", rack: "R-01", ru: "U10" },
    });
    expect(buildOpsLocation(asset)).toBe("Lab-A/Room-1/Aisle-3/R-01/U10");
  });

  it("skips null segments", () => {
    const asset = makeAsset({
      location: { site: "Lab-A", room: null, row: null, rack: "R-01", ru: "U10" },
    });
    expect(buildOpsLocation(asset)).toBe("Lab-A/R-01/U10");
  });
});

// ── categorizeAsset: clean ────────────────────────────────────────────────────

describe("categorizeAsset — clean", () => {
  it("returns clean when all three systems agree", () => {
    const result = categorizeAsset(makeAsset(), makeFac("C0000001"), makeFin("C0000001"), NOW);
    expect(result.category).toBe("clean");
    expect(result.secondaryFlags).toEqual([]);
  });

  it("returns clean for stored asset with no fac or fin records", () => {
    const asset = makeAsset({ state: "stored", location: noRackLocation() });
    const result = categorizeAsset(asset, undefined, undefined, NOW);
    expect(result.category).toBe("clean");
  });
});

// ── categorizeAsset: drift ────────────────────────────────────────────────────

describe("categorizeAsset — drift", () => {
  it("detects location mismatch between ops and facilities", () => {
    const fac = makeFac("C0000001", "Lab-A/Room-1/R-02/U10"); // different rack
    const result = categorizeAsset(makeAsset(), fac, makeFin("C0000001"), NOW);
    expect(result.category).toBe("drift");
    expect(result.ops_location).toBe(OPS_RACK);
    expect(result.facilities_location).toBe("Lab-A/Room-1/R-02/U10");
  });

  it("is not drift when locations match exactly", () => {
    const fac = makeFac("C0000001", OPS_RACK); // same as ops
    const result = categorizeAsset(makeAsset(), fac, makeFin("C0000001"), NOW);
    expect(result.category).toBe("clean");
  });

  it("is not drift when ops has no rack (can't compare)", () => {
    const asset = makeAsset({ state: "in_service", location: noRackLocation() });
    const fac = makeFac("C0000001", "Lab-A/R-01/U10");
    // No ops rack → opsLoc is null → drift condition not met → falls through to orphan
    const result = categorizeAsset(asset, fac, undefined, NOW);
    expect(result.category).not.toBe("drift");
  });
});

// ── categorizeAsset: ghost in facilities ──────────────────────────────────────

describe("categorizeAsset — ghost in facilities", () => {
  it("detects ghost when asset is stored but fac has a rack entry", () => {
    const asset = makeAsset({ state: "stored", location: noRackLocation() });
    const result = categorizeAsset(asset, makeFac("C0000001"), undefined, NOW);
    expect(result.category).toBe("ghost_in_facilities");
    expect(result.secondaryFlags).toEqual([]);
  });

  it("detects ghost when asset is received but fac has a rack entry", () => {
    const asset = makeAsset({ state: "received", location: noRackLocation() });
    const result = categorizeAsset(asset, makeFac("C0000001"), undefined, NOW);
    expect(result.category).toBe("ghost_in_facilities");
  });

  it("detects ghost when there is no ops record at all (C0000199-style)", () => {
    const fac = makeFac("C0000199", "Lab-A/R-99/U01");
    const result = categorizeAsset(null, fac, undefined, NOW);
    expect(result.category).toBe("ghost_in_facilities");
    expect(result.asset_tag).toBe("C0000199");
    expect(result.state).toBe("unreceived");
    expect(result.ops_location).toBeNull();
    expect(result.facilities_location).toBe("Lab-A/R-99/U01");
  });
});

// ── categorizeAsset: orphan in operations ─────────────────────────────────────

describe("categorizeAsset — orphan in operations", () => {
  it("detects orphan when asset is in_service with no fac record", () => {
    const result = categorizeAsset(makeAsset(), undefined, makeFin("C0000001"), NOW);
    expect(result.category).toBe("orphan_in_operations");
  });

  it("detects orphan when there is no ops record and only a finance record (C0000113-style)", () => {
    const result = categorizeAsset(null, undefined, makeFin("C0000113"), NOW);
    expect(result.category).toBe("orphan_in_operations");
    expect(result.asset_tag).toBe("C0000113");
    expect(result.state).toBe("unreceived");
    expect(result.facilities_location).toBeNull();
  });
});

// ── categorizeAsset: finance lag ─────────────────────────────────────────────

describe("categorizeAsset — finance lag", () => {
  const inServiceWithMatchingFac = (updatedAt: string) => {
    const asset = makeAsset({ state: "in_service", updated_at: updatedAt });
    const fac = makeFac("C0000001", OPS_RACK); // fac matches ops — no drift
    const fin = makeFin("C0000001", { status: "pending_receipt" });
    return categorizeAsset(asset, fac, fin, NOW);
  };

  it("flags finance lag when in_service > 7 days without capitalization", () => {
    const result = inServiceWithMatchingFac(daysAgo(8));
    expect(result.category).toBe("finance_lag");
  });

  it("does not flag finance lag when under the 7-day threshold", () => {
    const result = inServiceWithMatchingFac(daysAgo(6));
    expect(result.category).not.toBe("finance_lag");
  });

  it("does not flag finance lag when finance status is already capitalized", () => {
    const asset = makeAsset({ state: "in_service", updated_at: daysAgo(8) });
    const fac = makeFac("C0000001", OPS_RACK);
    const fin = makeFin("C0000001", { status: "capitalized" });
    const result = categorizeAsset(asset, fac, fin, NOW);
    expect(result.category).toBe("clean");
  });
});

// ── categorizeAsset: expected gap ────────────────────────────────────────────

describe("categorizeAsset — expected gap", () => {
  it("flags expected gap for disposed asset with capitalized finance", () => {
    const asset = makeAsset({ state: "disposed", location: noRackLocation() });
    const fin = makeFin("C0000001", { status: "capitalized" });
    const result = categorizeAsset(asset, undefined, fin, NOW);
    expect(result.category).toBe("expected_gap");
    expect(result.secondaryFlags).toEqual([]);
  });

  it("flags expected gap for rma_pending asset with capitalized finance", () => {
    const asset = makeAsset({ state: "rma_pending", location: noRackLocation() });
    const fin = makeFin("C0000001", { status: "capitalized" });
    const result = categorizeAsset(asset, undefined, fin, NOW);
    expect(result.category).toBe("expected_gap");
  });

  it("flags expected gap for rma_pending with impaired finance", () => {
    const asset = makeAsset({ state: "rma_pending", location: noRackLocation() });
    const fin = makeFin("C0000001", { status: "impaired" });
    const result = categorizeAsset(asset, undefined, fin, NOW);
    expect(result.category).toBe("expected_gap");
  });
});

// ── categorizeAsset: primary + secondary flags ────────────────────────────────

describe("categorizeAsset — primary + secondary flags", () => {
  it("expected_gap primary, ghost_in_facilities secondary — disposed with stale fac entry", () => {
    // Mirrors C0000108/C0000109: disposed but facilities never cleared the rack entry
    const asset = makeAsset({ state: "disposed", location: noRackLocation() });
    const fac = makeFac("C0000001", "Lab-A/PALLET-9");
    const fin = makeFin("C0000001", { status: "capitalized" });
    const result = categorizeAsset(asset, fac, fin, NOW);
    expect(result.category).toBe("expected_gap");
    expect(result.secondaryFlags).toContain("ghost_in_facilities");
    expect(result.secondaryFlags).toHaveLength(1);
  });

  it("expected_gap primary, ghost_in_facilities secondary — rma_pending with stale fac entry", () => {
    const asset = makeAsset({ state: "rma_pending", location: noRackLocation() });
    const fac = makeFac("C0000001", "Lab-A/R-01/U10");
    const fin = makeFin("C0000001", { status: "capitalized" });
    const result = categorizeAsset(asset, fac, fin, NOW);
    expect(result.category).toBe("expected_gap");
    expect(result.secondaryFlags).toContain("ghost_in_facilities");
  });

  it("ghost_in_facilities has no secondary flags for stored state (not an expected_gap case)", () => {
    const asset = makeAsset({ state: "stored", location: noRackLocation() });
    const result = categorizeAsset(asset, makeFac("C0000001"), undefined, NOW);
    expect(result.category).toBe("ghost_in_facilities");
    expect(result.secondaryFlags).toEqual([]);
  });

  it("drift has no secondary flags", () => {
    const fac = makeFac("C0000001", "Lab-A/DIFFERENT/R-99/U01");
    const result = categorizeAsset(makeAsset(), fac, makeFin("C0000001"), NOW);
    expect(result.category).toBe("drift");
    expect(result.secondaryFlags).toEqual([]);
  });
});

// ── reconcileAssets ───────────────────────────────────────────────────────────

describe("reconcileAssets", () => {
  it("counts each asset in its primary category only — ghost secondary is not counted", () => {
    // rma_pending + stale fac entry: expected_gap primary, ghost secondary
    const asset = makeAsset({ state: "rma_pending", location: noRackLocation() });
    const report = reconcileAssets(
      [asset],
      [makeFac("C0000001", "Lab-A/R-01/U10")],
      [makeFin("C0000001", { status: "capitalized" })],
      NOW,
    );
    expect(report.counts.expected_gap).toBe(1);
    expect(report.counts.ghost_in_facilities).toBe(0);
  });

  it("surfaces fac-only records via ID union (ghost with no ops record)", () => {
    const report = reconcileAssets([], [makeFac("C9999001", "Lab-A/R-99/U01")], [], NOW);
    const item = report.items.find((i) => i.asset_tag === "C9999001");
    expect(item).toBeDefined();
    expect(item!.category).toBe("ghost_in_facilities");
    expect(report.counts.ghost_in_facilities).toBe(1);
  });

  it("surfaces fin-only records via ID union (orphan with no ops record)", () => {
    const report = reconcileAssets([], [], [makeFin("C9999002")], NOW);
    const item = report.items.find((i) => i.asset_tag === "C9999002");
    expect(item).toBeDefined();
    expect(item!.category).toBe("orphan_in_operations");
    expect(report.counts.orphan_in_operations).toBe(1);
  });

  it("items are sorted drift before clean (CATEGORY_RANK order)", () => {
    const cleanAsset = makeAsset({ asset_tag: "C0000001" });
    const cleanFac = makeFac("C0000001", OPS_RACK);
    const driftAsset = makeAsset({ asset_tag: "C0000002" });
    const driftFac = makeFac("C0000002", "Lab-A/DIFFERENT/R-99/U01");
    const report = reconcileAssets(
      [cleanAsset, driftAsset],
      [cleanFac, driftFac],
      [makeFin("C0000001"), makeFin("C0000002")],
      NOW,
    );
    const categories = report.items.map((i) => i.category);
    expect(categories.indexOf("drift")).toBeLessThan(categories.indexOf("clean"));
  });

  it("within the same category, items are sorted by asset_tag", () => {
    const a = makeAsset({ asset_tag: "C0000020", state: "stored", location: noRackLocation() });
    const b = makeAsset({ asset_tag: "C0000010", state: "stored", location: noRackLocation() });
    const report = reconcileAssets([a, b], [], [], NOW);
    const tags = report.items.map((i) => i.asset_tag);
    expect(tags.indexOf("C0000010")).toBeLessThan(tags.indexOf("C0000020"));
  });

  it("produces counts for all six categories", () => {
    const report = reconcileAssets([], [], [], NOW);
    expect(Object.keys(report.counts)).toEqual(
      expect.arrayContaining([
        "drift",
        "ghost_in_facilities",
        "orphan_in_operations",
        "finance_lag",
        "expected_gap",
        "clean",
      ]),
    );
  });

  it("generated_at is an ISO 8601 string matching the passed now", () => {
    const report = reconcileAssets([], [], [], NOW);
    expect(report.generated_at).toBe(NOW.toISOString());
  });

  it("generates correct counts across three different categories", () => {
    const orphan = makeAsset({ asset_tag: "C0000010", state: "in_service" }); // no fac → orphan
    const stored = makeAsset({ asset_tag: "C0000011", state: "stored", location: noRackLocation() }); // no fac → clean
    const drift = makeAsset({ asset_tag: "C0000012", state: "in_service" }); // fac disagrees → drift
    const report = reconcileAssets(
      [orphan, stored, drift],
      [makeFac("C0000012", "Lab-A/WRONG/R-00/U00")],
      [],
      NOW,
    );
    expect(report.counts.orphan_in_operations).toBe(1);
    expect(report.counts.drift).toBe(1);
    expect(report.counts.clean).toBe(1);
    expect(report.counts.ghost_in_facilities).toBe(0);
  });
});

// ── CATEGORY_RANK ─────────────────────────────────────────────────────────────

describe("CATEGORY_RANK", () => {
  it("drift ranks before clean", () => {
    expect(CATEGORY_RANK.drift).toBeLessThan(CATEGORY_RANK.clean);
  });

  it("all six categories have a rank", () => {
    const categories = [
      "drift",
      "ghost_in_facilities",
      "orphan_in_operations",
      "finance_lag",
      "expected_gap",
      "clean",
    ] as const;
    for (const cat of categories) {
      expect(typeof CATEGORY_RANK[cat]).toBe("number");
    }
  });
});
