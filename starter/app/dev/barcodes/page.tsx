import { api } from "@/lib/api-client";
import { reconcileAssets, buildOpsLocation } from "@/lib/reconcile";
import { BarcodeCanvas } from "@/components/BarcodeCanvas";
import type { Asset } from "@/lib/types";

// Static location codes that cover interesting rack positions for testing
const INTERESTING_LOCATIONS = [
  {
    code: "Lab-Building-A/Bay-12/Aisle-3/B-04/P-02",
    note: "Building A, Bay-12 rack B-04 position P-02",
  },
  {
    code: "Lab-Building-A/Telecom-1/Aisle-1/T-01/U40",
    note: "Building A, telecom rack T-01 unit U40",
  },
  {
    code: "Lab-Building-B/Computing-1/Aisle-1/C-12/U18",
    note: "Building B, compute rack C-12 (drifted asset ops location)",
  },
  {
    code: "Lab-Building-B/Computing-1/Aisle-1/C-12/U16",
    note: "Building B, compute rack C-12 (drifted asset facilities location)",
  },
  {
    code: "Lab-Building-A/Storage-1/Aisle-1/S-01/null",
    note: "Building A, storage (no RU — for store scans)",
  },
];

const USER_BADGES = [
  { id: "tech-jane", note: "Technician — default logged-in user" },
  { id: "tech-mike", note: "Technician — transfer target" },
  { id: "manager-paul", note: "Manager" },
  { id: "tech-sarah", note: "Technician — additional transfer target" },
];

function pickInteresting(
  assets: Asset[],
  driftedTags: Set<string>,
  orphanTags: Set<string>,
  ghostTags: Set<string>,
  expectedGapTags: Set<string>,
): { asset: Asset; note: string }[] {
  const picked: { asset: Asset; note: string }[] = [];
  const used = new Set<string>();

  function pick(asset: Asset, note: string) {
    if (!used.has(asset.asset_tag)) {
      used.add(asset.asset_tag);
      picked.push({ asset, note });
    }
  }

  // Drifted first — the most interesting reconcile case
  for (const a of assets) {
    if (driftedTags.has(a.asset_tag))
      pick(a, "Drifted: ops and facilities disagree on rack location");
  }

  // Orphan (ops says deployed, facilities has no record)
  let orphanCount = 0;
  for (const a of assets) {
    if (orphanTags.has(a.asset_tag) && orphanCount < 2) {
      pick(a, "Orphan: ops shows deployed, facilities has no rack entry");
      orphanCount++;
    }
  }

  // Ghost (facilities has entry but ops says stored/received)
  let ghostCount = 0;
  for (const a of assets) {
    if (ghostTags.has(a.asset_tag) && ghostCount < 2) {
      pick(a, "Ghost: facilities shows racked, ops says in storage");
      ghostCount++;
    }
  }

  // Expected gap (disposed in ops, still on books in finance)
  for (const a of assets) {
    if (expectedGapTags.has(a.asset_tag)) {
      pick(a, "Expected gap: disposed in ops, finance still carries book value");
    }
  }

  // Disposed (no finance record)
  let disposedCount = 0;
  for (const a of assets) {
    if (a.state === "disposed" && !used.has(a.asset_tag) && disposedCount < 1) {
      pick(a, "Disposed — any scan should be rejected");
      disposedCount++;
    }
  }

  // RMA pending
  let rmaCount = 0;
  for (const a of assets) {
    if (a.state === "rma_pending" && rmaCount < 1) {
      pick(a, "RMA pending — limited scan operations allowed");
      rmaCount++;
    }
  }

  // Received
  let receivedCount = 0;
  for (const a of assets) {
    if (a.state === "received" && !used.has(a.asset_tag) && receivedCount < 2) {
      pick(a, "Received — can be stored or deployed");
      receivedCount++;
    }
  }

  // Stored
  let storedCount = 0;
  for (const a of assets) {
    if (a.state === "stored" && !used.has(a.asset_tag) && storedCount < 2) {
      pick(a, "Stored — can be deployed");
      storedCount++;
    }
  }

  // In-service (clean)
  let inServiceCount = 0;
  for (const a of assets) {
    if (
      a.state === "in_service" &&
      !used.has(a.asset_tag) &&
      inServiceCount < 2
    ) {
      pick(a, "In service — can be stored (triggers facilities write-back)");
      inServiceCount++;
    }
  }

  return picked;
}

export default async function BarcodesPage() {
  const [assets, facilities, finance] = await Promise.all([
    api.assets.list(),
    api.mock.facilities(),
    api.mock.finance(),
  ]);

  const report = reconcileAssets(assets, facilities, finance);

  const driftedTags = new Set(
    report.items
      .filter((i) => i.category === "drift")
      .map((i) => i.asset_tag),
  );
  const orphanTags = new Set(
    report.items
      .filter((i) => i.category === "orphan_in_operations")
      .map((i) => i.asset_tag),
  );
  const ghostTags = new Set(
    report.items
      .filter((i) => i.category === "ghost_in_facilities")
      .map((i) => i.asset_tag),
  );
  const expectedGapTags = new Set(
    report.items
      .filter((i) => i.category === "expected_gap")
      .map((i) => i.asset_tag),
  );

  const interesting = pickInteresting(
    assets,
    driftedTags,
    orphanTags,
    ghostTags,
    expectedGapTags,
  );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Barcode sheet — dev only</h1>
        <p className="text-sm text-gray-500 mt-1">
          Print this page or scan directly from the screen to test scan
          workflows. Assets are chosen to cover all interesting states and
          reconciliation categories.
        </p>
        <p className="text-xs text-amber-600 mt-1 font-medium">
          Not linked from any production surface. Use{" "}
          <code>/v1/reset</code> before recording your Loom.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Asset tags ({interesting.length})
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {interesting.map(({ asset, note }) => (
            <BarcodeCanvas
              key={asset.asset_tag}
              text={asset.asset_tag}
              label={`${asset.asset_tag} · ${asset.state}`}
              note={`${asset.model} — ${note}`}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Location codes ({INTERESTING_LOCATIONS.length})
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Scan into the location field on store/deploy screens.
          Format: Site/Room/Row/Rack/RU
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {INTERESTING_LOCATIONS.map((loc) => (
            <BarcodeCanvas
              key={loc.code}
              text={loc.code}
              label={loc.code}
              note={loc.note}
              scale={1}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          User badges ({USER_BADGES.length})
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Scan into the &quot;receiving party&quot; field on the transfer screen.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {USER_BADGES.map((u) => (
            <BarcodeCanvas
              key={u.id}
              text={u.id}
              label={u.id}
              note={u.note}
            />
          ))}
        </div>
      </section>

      <section className="bg-gray-50 border rounded-lg p-4 text-sm text-gray-700">
        <h2 className="font-semibold mb-2">Reconcile summary</h2>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {Object.entries(report.counts).map(([cat, count]) => (
            <div key={cat} className="flex gap-2">
              <dt className="text-gray-500 capitalize">
                {cat.replace(/_/g, " ")}:
              </dt>
              <dd className="font-mono font-medium">{count}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
