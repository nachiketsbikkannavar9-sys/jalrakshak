import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma.js";
import { signToken, toAuthUser, verifyToken, type AuthorizedUser } from "../services/auth.js";

export const router = Router();

export type AuthedRequest = Request & { user?: AuthorizedUser };

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  const user = token ? verifyToken(token) : null;
  if (!user) {
    res.status(401).json({ error: "authorization required" });
    return;
  }
  req.user = user;
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "admin role required" });
    return;
  }
  next();
}

/** Attach req.user when a valid bearer token is present, but never reject. */
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  const user = token ? verifyToken(token) : null;
  if (user) req.user = user;
  next();
}

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "email and password required" });
    return;
  }
  const user = await prisma.authorityUser.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  const u = toAuthUser(user);
  res.json({ token: signToken(u), user: u });
});

router.post("/register", async (req: Request, res: Response) => {
  const { email, password, displayName, jurisdictionRegions } = req.body ?? {};
  if (!email || !password || String(password).length < 8) {
    res.status(400).json({ error: "email + password (min 8 chars) required" });
    return;
  }
  const existing = await prisma.authorityUser.findUnique({ where: { email: String(email).toLowerCase() } });
  if (existing) {
    res.status(409).json({ error: "user already exists" });
    return;
  }
  const hash = await bcrypt.hash(String(password), 10);
  const regions = Array.isArray(jurisdictionRegions)
    ? jurisdictionRegions.map(String).filter(Boolean)
    : [];
  const user = await prisma.authorityUser.create({
    data: {
      email: String(email).toLowerCase(),
      passwordHash: hash,
      displayName: displayName ?? "District Officer",
      role: "district_officer",
      jurisdictionRegions: regions,
    },
  });
  const u = toAuthUser(user);
  res.status(201).json({ token: signToken(u), user: u });
});

router.get("/me", requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user });
});