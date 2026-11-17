import type { NextRequest } from "next/server";
import { store } from "@/lib/market/store";
import { ensureWorkerStarted } from "@/lib/worker";

export const dynamic = "force-dynamic";

/** MOMENTUM MASTER API: ranking | index?symbol= | workspace?symbol= */
export async function GET(req: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  ensureWorkerStarted();
  const { resource } = await params;
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  switch (resource) {
    case "ranking":
      return Response.json(store.momentumRankingPayload());
    case "index":
      return Response.json(symbol ? store.momentumIndexPayload(symbol) : { available: false, reason: "symbol required", code: "BAD_REQUEST" });
    case "workspace":
      return Response.json(symbol ? await store.momentumWorkspacePayload(symbol) : { available: false, reason: "symbol required", code: "BAD_REQUEST" });
    default:
      return Response.json({ available: false, reason: `unknown resource ${resource}`, code: "UNKNOWN" }, { status: 404 });
  }
}
