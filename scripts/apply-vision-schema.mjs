#!/usr/bin/env node
/**
 * Apply vision tag-library schema to Supabase Postgres.
 *
 * Requires a Personal Access Token (sbp_…), NOT sb_secret_ / service_role:
 *   export SUPABASE_ACCESS_TOKEN=sbp_…
 *   node scripts/apply-vision-schema.mjs
 *
 * Or a direct DB URL:
 *   export SUPABASE_DB_URL='postgresql://postgres.xxx:PASSWORD@aws-0-….pooler.supabase.com:6543/postgres'
 *   node scripts/apply-vision-schema.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REF = process.env.SUPABASE_PROJECT_ID || "nmdlasnxevejggwmnjwm";
const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(
  __dirname,
  "..",
  "apps/web/src/tagLibrarySchema.sql",
);
const sql = readFileSync(sqlPath, "utf8");

async function viaManagementApi(token) {
  if (!token.startsWith("sbp_")) {
    throw new Error(
      `SUPABASE_ACCESS_TOKEN must be a Personal Access Token (sbp_…), got prefix "${token.slice(0, 8)}…"`,
    );
  }
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${text.slice(0, 400)}`);
  }
  console.log("[apply-vision-schema] applied via Management API");
  return text;
}

async function viaDbUrl(url) {
  const { default: pg } = await import("pg").catch(() => ({ default: null }));
  if (!pg) {
    throw new Error("Install pg to use SUPABASE_DB_URL: npm i pg");
  }
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log("[apply-vision-schema] applied via SUPABASE_DB_URL");
  } finally {
    await client.end();
  }
}

async function verifyWithServiceRole() {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_API_KEY ||
    "";
  if (!key) {
    console.log("[apply-vision-schema] skip verify (no service role key in env)");
    return;
  }
  const res = await fetch(
    `https://${REF}.supabase.co/rest/v1/vision_tag_sets?select=id&limit=1`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    },
  );
  const body = await res.text();
  if (res.ok) {
    console.log("[apply-vision-schema] verify OK — vision_tag_sets reachable");
  } else {
    console.warn("[apply-vision-schema] verify failed:", res.status, body.slice(0, 200));
  }
}

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const dbUrl = process.env.SUPABASE_DB_URL || "";

try {
  if (dbUrl) {
    await viaDbUrl(dbUrl);
  } else if (token) {
    await viaManagementApi(token);
  } else {
    console.error(
      "Set SUPABASE_ACCESS_TOKEN=sbp_… (Dashboard → Account → Access Tokens)\n" +
        "or SUPABASE_DB_URL=postgresql://postgres.<ref>:<db-password>@…pooler.supabase.com:6543/postgres",
    );
    process.exit(1);
  }
  await verifyWithServiceRole();
} catch (err) {
  console.error("[apply-vision-schema]", err.message || err);
  process.exit(1);
}
