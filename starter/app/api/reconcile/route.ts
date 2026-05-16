import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/api-client";
import { reconcileAssets } from "@/lib/reconcile";

export async function GET(): Promise<NextResponse> {
  try {
    const api = createApiClient();
    const [assets, facilities, finance] = await Promise.all([
      api.assets.list(),
      api.mock.facilities(),
      api.mock.finance(),
    ]);
    const report = reconcileAssets(assets, facilities, finance);
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "reconcile_failed", message } },
      { status: 500 },
    );
  }
}
