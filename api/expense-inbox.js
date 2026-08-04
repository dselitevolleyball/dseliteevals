// Vercel serverless function: receipts in, draft expenses out.
//
// A Google Apps Script in Drew's Gmail forwards anything that looks like a
// receipt here (scripts/expense-appscript.gs). Everything lands as
// status='pending' and is excluded from the finance totals until approved —
// a parser that quietly mis-reads an amount is worse than one that asks.
//
//   POST /api/expense-inbox?token=<EXPENSE_INBOX_TOKEN>
//     { messageId, from, subject, text, date? }
//   GET  /api/expense-inbox?token=…&action=pending   → what's awaiting review
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXPENSE_INBOX_TOKEN.

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { parseReceiptEmail } from "./_lib/receipt-parse.js";
import { matchTournament, matchTournamentByTeams } from "./_lib/tournament-match.js";
import { seasonForExpense } from "./_lib/season.js";

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  if (!ba.length || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXPENSE_INBOX_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const SECRET = String(EXPENSE_INBOX_TOKEN || "").replace(/\s+/g, "");
  if (!SECRET) return res.status(500).json({ error: "EXPENSE_INBOX_TOKEN is not set in Vercel." });

  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const token = String(url?.searchParams.get("token") || "").replace(/\s+/g, "");
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").replace(/\s+/g, "");
  if (!safeEqual(token, SECRET) && !safeEqual(bearer, SECRET)) return res.status(403).json({ error: "Forbidden" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  if (req.method === "GET" && url?.searchParams.get("action") === "pending") {
    const { data, error } = await supabase.from("expenses")
      .select("id, vendor, item, amount, expense_date, category, allocation, email_subject, captured_at")
      .eq("status", "pending").order("captured_at", { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, pending: data || [] });
  }

  if (req.method !== "POST") { res.setHeader("Allow", ["POST", "GET"]); return res.status(405).json({ error: "Method not allowed" }); }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }

  const messageId = String(body?.messageId || "").trim() || null;
  if (!messageId) return res.status(400).json({ error: "messageId is required — it's what stops duplicates" });

  // Gmail redelivers and Apps Script runs overlap; seeing a message twice is
  // normal and must not double-book the spend.
  const { data: seen } = await supabase.from("expenses").select("id").eq("message_id", messageId).limit(1);
  if (seen && seen.length) return res.status(200).json({ ok: true, duplicate: true, messageId });

  const parsed = parseReceiptEmail({
    from: body?.from || "", subject: body?.subject || "",
    text: body?.text || "", messageId,
  });

  if (!parsed.rows.length) {
    return res.status(200).json({ ok: true, skipped: parsed.reason || "nothing to record", messageId, confidence: parsed.confidence });
  }

  // Resolve the allocation label to a real team, and the event name to a
  // tournament, so the row arrives usable instead of needing both filled in by
  // hand. A tournament is only linked on a confident match — a wrong one would
  // put the cost on the wrong event and flip the wrong teams to registered.
  const [{ data: teamRows }, { data: tnRows }, { data: asgRows }] = await Promise.all([
    supabase.from("teams").select("id"),
    supabase.from("tournaments").select("id, name, start_date").eq("cancelled", false),
    supabase.from("tournament_assignments").select("tournament_id, team_id"),
  ]);
  const known = new Map((teamRows || []).map(t => [String(t.id).toLowerCase(), t.id]));
  const ALIAS = { "11 rise": "11 Rise 1", "12-1 rise": "12 Rise 1", "12-2 rise": "12 Rise 2", "13 rise": "13 Rise 1" };
  const eventName = parsed.event || String(body?.subject || "").replace(/^Purchase with successful payment\s*/i, "").trim();
  // Name first. When the name is ambiguous — "Lone Star Regionals (12s-14s)"
  // never says which weekend — fall back to the roster: an email covering
  // exactly one tournament's assigned teams IS that tournament.
  const byTn = new Map();
  for (const a of (asgRows || [])) {
    if (!byTn.has(a.tournament_id)) byTn.set(a.tournament_id, new Set());
    byTn.get(a.tournament_id).add(a.team_id);
  }
  const emailTeams = parsed.rows
    .map(r => { const k = String(r.allocation || "").toLowerCase(); return known.get(k) || ALIAS[k] || null; })
    .filter(Boolean);
  const match = parsed.kind !== "registration" ? null
    : (matchTournament(eventName, tnRows || [])
       || matchTournamentByTeams(eventName, emailTeams, tnRows || [], byTn));

  const now = new Date().toISOString();
  const rows = parsed.rows.map(r => {
    const key = String(r.allocation || "").toLowerCase();
    return {
      ...r,
      team_name: known.get(key) || ALIAS[key] || null,
      tournament_id: match ? match.id : null,
      season: seasonForExpense({
        expenseDate: r.expense_date,
        tournamentStart: match ? (tnRows || []).find(t => t.id === match.id)?.start_date : null,
      }),
      captured_at: now,
      raw_email: String(body?.text || "").slice(0, 20000),
      notes: [r.notes, match ? null : (parsed.kind === "registration" ? "Tournament not matched automatically — pick it in review" : null)]
        .filter(Boolean).join(" · ") || null,
    };
  });
  const { error } = await supabase.from("expenses").insert(rows);
  if (error) {
    // The unique index is the backstop when two runs race on one message.
    if (/duplicate key/i.test(error.message)) return res.status(200).json({ ok: true, duplicate: true, messageId });
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    ok: true, messageId, confidence: parsed.confidence, kind: parsed.kind,
    rows: rows.length, total: parsed.total ?? null,
  });
}
