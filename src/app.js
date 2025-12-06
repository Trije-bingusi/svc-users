import express from "express";
import client from "prom-client";
import pinoHttp from "pino-http";
import YAML from "yamljs";
import { PrismaClient } from "@prisma/client";
import { apiReference } from "@scalar/express-api-reference";
import { requireAuth, getRealmRoles } from "./auth.js";

function env(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    if (fallback === undefined) throw new Error(`Missing env: ${name}`);
    return fallback;
  }
  return raw;
}

const PORT = Number(env("PORT", "3000"));
env("DATABASE_URL");

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(pinoHttp());

// ---- OpenAPI + docs ----
const openapi = YAML.load("./openapi.yaml");
app.get("/openapi.json", (_req, res) => res.json(openapi));
app.use(
  "/docs",
  apiReference({
    spec: { url: "/openapi.json" },
    theme: "default",
    darkMode: true
  })
);

// ---- Prometheus metrics ----
client.collectDefaultMetrics();

const profileCreatedCounter = new client.Counter({
  name: "svc_users_profile_created_total",
  help: "Total number of user profiles created"
});

const profileUpdatedCounter = new client.Counter({
  name: "svc_users_profile_updated_total",
  help: "Total number of user profile updates"
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// ---- Health ----
app.get("/healthz", (_req, res) => res.send("OK"));

app.get("/readyz", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.send("READY");
  } catch {
    res.status(500).send("NOT READY");
  }
});

// ---- Users domain ----

// GET/CREATE profile
app.get("/api/users/me", requireAuth(), async (req, res, next) => {
  try {
    const sub = req.user?.sub;
    if (!sub) return res.status(400).json({ error: "Token missing sub" });

    const email = req.user?.email ?? null;
    const displayFromToken =
      req.user?.preferred_username ?? req.user?.name ?? null;

    const roles = getRealmRoles(req.user);
    const role = roles.includes("professor")
      ? "professor"
      : roles.includes("student")
      ? "student"
      : null;

    let profile = await prisma.userProfile.findUnique({
      where: { oidc_sub: sub }
    });

    if (!profile) {
      profile = await prisma.userProfile.create({
        data: {
          oidc_sub: sub,
          email,
          display_name: displayFromToken,
          role
        }
      });
      profileCreatedCounter.inc();
    } else {
      const shouldUpdate =
        (email && email !== profile.email) ||
        (role && role !== profile.role);

      if (shouldUpdate) {
        profile = await prisma.userProfile.update({
          where: { oidc_sub: sub },
          data: {
            email: email ?? profile.email,
            role: role ?? profile.role
          }
        });
      }
    }

    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// Update
app.put("/api/users/me", requireAuth(), async (req, res, next) => {
  try {
    const sub = req.user?.sub;
    if (!sub) return res.status(400).json({ error: "Token missing sub" });

    const { display_name } = req.body || {};
    if (!display_name) {
      return res.status(400).json({ error: "display_name is required" });
    }

    const profile = await prisma.userProfile.update({
      where: { oidc_sub: sub },
      data: { display_name }
    });

    profileUpdatedCounter.inc();
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// ---- Error handling ----
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ---- Start + shutdown ----
const server = app.listen(PORT, () => {
  console.log("Users service listening on port", PORT);
});

function shutdown() {
  console.log("Shutting down server...");
  server.close(async () => {
    try {
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
