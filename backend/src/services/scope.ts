import type { Prisma } from "@prisma/client";
import { isNationalScope, stationInScope, type ScopeUser } from "../../../shared/src/index.js";

/**
 * Prisma `Station` filter that limits a query to an authority account's
 * jurisdiction. Returns `undefined` for national scope (no filtering).
 */
export function stationScopeWhere(u: ScopeUser | null | undefined): Prisma.StationWhereInput | undefined {
  if (isNationalScope(u)) return undefined;
  const regions = u?.jurisdictionRegions ?? [];
  const ids = u?.jurisdictionStationIds ?? [];
  if (!regions.length && !ids.length) return { id: "__no_scope__" };
  const or: Prisma.StationWhereInput[] = [];
  if (regions.length) or.push({ region: { in: regions } });
  if (ids.length) or.push({ id: { in: ids } });
  return { OR: or };
}

/** True when the account may view/action the given station. */
export function canAction(
  u: ScopeUser | null | undefined,
  station: { id: string; region?: string | null }
): boolean {
  return stationInScope(u, station);
}
