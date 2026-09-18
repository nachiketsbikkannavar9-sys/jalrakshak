import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import type { AuthUser } from "../../../shared/src/index.js";

export interface AuthorizedUser {
  id: string;
  email: string;
  role: string;
  displayName: string;
  jurisdictionRegions: string[];
  jurisdictionStationIds: string[];
}

export function signToken(user: AuthorizedUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
      jurisdictionRegions: user.jurisdictionRegions,
      jurisdictionStationIds: user.jurisdictionStationIds,
    },
    config.jwtSecret,
    { expiresIn: `${config.jwtTtlHours}h` }
  );
}

export function verifyToken(token: string): AuthorizedUser | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as Record<string, unknown>;
    return {
      id: String(decoded.id ?? ""),
      email: String(decoded.email ?? ""),
      role: String(decoded.role ?? "district_officer"),
      displayName: String(decoded.displayName ?? "Authority User"),
      jurisdictionRegions: Array.isArray(decoded.jurisdictionRegions)
        ? (decoded.jurisdictionRegions as string[])
        : [],
      jurisdictionStationIds: Array.isArray(decoded.jurisdictionStationIds)
        ? (decoded.jurisdictionStationIds as string[])
        : [],
    };
  } catch {
    return null;
  }
}

export function toAuthUser(u: {
  id: string;
  email: string;
  role: string;
  displayName: string;
  jurisdictionRegions?: string[];
  jurisdictionStationIds?: string[];
}): AuthUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    displayName: u.displayName,
    jurisdictionRegions: u.jurisdictionRegions ?? [],
    jurisdictionStationIds: u.jurisdictionStationIds ?? [],
  };
}

/** Seed the demo authority accounts: one national admin + two region-scoped SDMAs. */
export async function seedAuthority(): Promise<void> {
  const accounts = [
    {
      email: config.authorityEmail,
      password: config.authorityPassword,
      role: config.authorityRole,
      displayName: config.authorityName,
      regions: [] as string[],
      stationIds: [] as string[],
    },
    {
      email: "assam-sdma@demo.local",
      password: "DemoPass123!",
      role: "district_officer",
      displayName: "Assam SDMA (Demo)",
      regions: ["Assam"],
      stationIds: [] as string[],
    },
    {
      email: "bihar-sdma@demo.local",
      password: "DemoPass123!",
      role: "district_officer",
      displayName: "Bihar SDMA (Demo)",
      regions: ["Bihar"],
      stationIds: [] as string[],
    },
  ];

  for (const a of accounts) {
    const hash = await bcrypt.hash(a.password, 10);
    await prisma.authorityUser.upsert({
      where: { email: a.email },
      create: {
        email: a.email,
        passwordHash: hash,
        role: a.role,
        displayName: a.displayName,
        jurisdictionRegions: a.regions,
        jurisdictionStationIds: a.stationIds,
      },
      update: {
        role: a.role,
        displayName: a.displayName,
        jurisdictionRegions: a.regions,
        jurisdictionStationIds: a.stationIds,
      },
    });
    console.log(
      `[auth] seeded authority ${a.email} (${a.role}) · jurisdiction: ${
        a.regions.length ? a.regions.join(", ") : "national"
      }`
    );
  }
}