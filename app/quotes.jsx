'use client';
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Plus, Search, Trash2, Edit3, X, Package, Truck, Building2,
  Factory, DollarSign, Copy, ChevronDown, ChevronRight, ChevronLeft,
  Box, AlertCircle, Check, Lock, Clock, Download, LogOut, Layers, Users, Printer, Bell, CheckCircle2, Circle, ListChecks, Send, FolderOpen
} from "lucide-react";
import { SBQ } from "@/lib/supabaseQuotes";
import { SB } from "@/lib/supabase";
import { FilterSelect } from "@/app/components/FilterSelect";
import { SIZE_SCALES, sizesForScale } from "@/app/components/SizeGrid";
import { CodeModal } from "@/app/components/CodeModal";
import { matches, normalizeTerm } from "@/lib/textFilter";

// ============================================================
//  SUPABASE CONNECTION
//  Now using the vessl schema directly via the main SB client.
//  All quotes data has been migrated from public → vessl.
// ============================================================
const supabase = SB;

// team members for task assignment
const TEAM = [
  { name: "Kristy", email: "kristy@kinguniversal.com" },
  { name: "Loren", email: "loren@kinguniversal.com" },
  { name: "Riley", email: "riley@kinguniversal.com" },
  { name: "Steven", email: "steven@kinguniversal.com" },
  { name: "Carmela", email: "carmela@kinguniversal.com" },
];
function nameForEmail(email) {
  const t = TEAM.find((m) => m.email.toLowerCase() === (email || "").toLowerCase());
  return t ? t.name : (email || "").split("@")[0];
}

// detect narrow viewport (phones) for responsive layout
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth <= 720 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 720);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

// ---------- KUI margin logic ----------
function suggestedMarkup(landed) {
  const c = Number(landed) || 0;
  if (c < 5) return 60;
  if (c < 10) return 50;
  if (c < 20) return 40;
  if (c < 40) return 30;
  return 25;
}
function roundToPricePoint(value, on) {
  if (!on) return Math.round(value * 100) / 100;
  const dollars = Math.floor(value);
  if (value <= dollars + 0.99) return dollars + 0.99;
  return dollars + 1.99;
}
function fmt(n) {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function stamp() { return new Date().toISOString(); }
function fmtStamp(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return "—"; }
}

// EXW (raw) cost is stored in tier.landed; total cost = EXW + freight/duty
function activeFreight(t) {
  const ship = t.ship || "ocean";
  if (ship === "air") return Number(t.freightAir ?? t.freightDuty) || 0;
  return Number(t.freightOcean ?? t.freightDuty) || 0;
}
function moldPerUnit(moldFee, qty) {
  const f = Number(moldFee) || 0;
  const q = Number(qty) || 0;
  if (f <= 0 || q <= 0) return 0;
  return f / q;
}
// The quantity this tier is really for. A size mix takes over from the Quantity box
// the moment any size carries a number — the box stops being editable at that point —
// so anything per-unit has to divide by the mix, not by a qty nobody is maintaining.
// Unscoped by design: sizes outside the scale are already pruned on scale change and
// again on save, and the caller here has no scale to hand.
function effectiveQty(t) {
  const qty = t.sizeQty || {};
  const entered = Object.keys(qty).filter((s) => qty[s] !== "" && qty[s] != null);
  if (entered.length) return entered.reduce((a, s) => a + (Number(qty[s]) || 0), 0);
  return Number(t.qty) || 0;
}
function tierTotalCost(t, moldFee) {
  const exw = Number(t.landed) || 0;
  return exw + activeFreight(t) + moldPerUnit(moldFee, effectiveQty(t));
}
function suggestClientPriceForTier(t, moldFee) {
  const c = tierTotalCost(t, moldFee);
  if (!c) return "";
  const m = suggestedMarkup(c);
  return roundToPricePoint(c * (1 + m / 100), true);
}
function suggestClientPrice(landed) {
  const c = Number(landed) || 0;
  if (!c) return "";
  const m = suggestedMarkup(c);
  return roundToPricePoint(c * (1 + m / 100), true);
}
function tierMargin(t, client, moldFee) {
  const total = typeof t === "object" && t !== null ? tierTotalCost(t, moldFee) : (Number(t) || 0);
  const p = Number(client) || 0;
  if (p <= 0) return 0;
  return ((p - total) / p) * 100;
}
// Per-size deltas move the client price, so one tier can span a band of margins.
// An absent base counts as zero rather than as "no price": the deltas are then the
// prices outright, and typing a base later shifts the whole band up by it. Returns
// null whenever the tier should render exactly as it does without deltas: no size
// scale, or every size sitting at the base price (which covers a tier with no deltas
// at all, base or no base).
function marginRangeFor(t, moldFee, deltaMap, scaleKey) {
  const base = Number(t.client) || 0;
  const sizes = scaleKey ? sizesForScale(scaleKey) : [];
  if (!sizes.length) return null;
  const priced = sizes.map((s) => {
    const d = Number((deltaMap || {})[s]);
    return base + (isFinite(d) ? d : 0);
  });
  if (!priced.some((p) => p !== base)) return null;
  // A delta steep enough to drive the price to zero has no meaningful margin.
  const margins = priced.filter((p) => p > 0).map((p) => tierMargin(t, p, moldFee));
  if (!margins.length) return null;
  return { low: Math.min(...margins), high: Math.max(...margins) };
}
// One row per size in the scale, in scale order rather than object-key order. These
// rows are where per-size quantities are typed, so unlike marginRangeFor they cannot
// filter themselves away: a size with no upcharge is still orderable, and a tier
// whose client price is not settled yet still needs a quantity. A missing base is
// zero, so a +10 with no base is simply a price of 10; price is null only when the
// arithmetic lands at or below zero, and margin follows the price.
function sizeRowsFor(t, moldFee, deltaMap, scaleKey) {
  const base = Number(t.client) || 0;
  const sizes = scaleKey ? sizesForScale(scaleKey) : [];
  return sizes.map((s) => {
    const d = Number((deltaMap || {})[s]);
    const delta = isFinite(d) ? d : 0;
    const price = base + delta > 0 ? base + delta : null;
    return { size: s, delta, price, margin: price == null ? null : tierMargin(t, price, moldFee) };
  });
}
// What the size mix on a tier is actually worth: the amount it bills to, and the
// blended unit price behind it. Built from the sizes carrying both a quantity and a
// price above zero — with no base that means the deltas alone, the same reading
// sizeRowsFor takes, so this can never disagree with the rows printed beneath the
// tier. Null when no size qualifies.
function sizeMixFor(t, deltaMap, scaleKey) {
  const base = Number(t.client) || 0;
  const sizes = scaleKey ? sizesForScale(scaleKey) : [];
  let units = 0, total = 0;
  sizes.forEach((s) => {
    const q = Number((t.sizeQty || {})[s]) || 0;
    if (q <= 0) return;
    const d = Number((deltaMap || {})[s]);
    const price = base + (isFinite(d) ? d : 0);
    if (price <= 0) return;
    units += q;
    total += q * price;
  });
  if (units <= 0) return null;
  return { units, total, blended: total / units };
}
// Null when no size on this tier carries a quantity, which is what keeps the tier's
// own Quantity box an ordinary input. An entered 0 still counts as entered, so the
// box cannot flip back to an input halfway through someone clearing a size.
function sizeQtyTotal(t, scaleKey) {
  const sizes = scaleKey ? sizesForScale(scaleKey) : [];
  let any = false, total = 0;
  sizes.forEach((s) => {
    const v = (t.sizeQty || {})[s];
    if (v === "" || v == null) return;
    any = true;
    total += Number(v) || 0;
  });
  return any ? total : null;
}

const CLIENT_PALETTE = [
  { bg: "#ffffff", avatar: "#f87171", text: "#0b1120", accent: "#f87171" },
  { bg: "#ffffff", avatar: "#fb923c", text: "#0b1120", accent: "#fb923c" },
  { bg: "#ffffff", avatar: "#fbbf24", text: "#0b1120", accent: "#fbbf24" },
  { bg: "#ffffff", avatar: "#a3e635", text: "#0b1120", accent: "#a3e635" },
  { bg: "#ffffff", avatar: "#4ade80", text: "#0b1120", accent: "#4ade80" },
  { bg: "#ffffff", avatar: "#2dd4bf", text: "#0b1120", accent: "#2dd4bf" },
  { bg: "#ffffff", avatar: "#58a6ff", text: "#0b1120", accent: "#58a6ff" },
  { bg: "#ffffff", avatar: "#818cf8", text: "#0b1120", accent: "#818cf8" },
  { bg: "#ffffff", avatar: "#a78bfa", text: "#0b1120", accent: "#a78bfa" },
  { bg: "#ffffff", avatar: "#f472b6", text: "#0b1120", accent: "#f472b6" },
  { bg: "#ffffff", avatar: "#fb7185", text: "#0b1120", accent: "#fb7185" },
  { bg: "#ffffff", avatar: "#22d3ee", text: "#0b1120", accent: "#22d3ee" },
];
function clientColor(name) {
  const n = (name || "Unassigned").trim();
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
  return CLIENT_PALETTE[hash % CLIENT_PALETTE.length];
}

// ---------- KING UNIVERSAL logo ----------
const KU_LOGO_WHITE = "/logo.png";
const KU_LOGO_DARK = "/logo.png";
function KULogo({ height = 40, dark = false }) {
  return <img src={dark ? KU_LOGO_DARK : KU_LOGO_WHITE} alt="King Universal" style={{ height, width: "auto", display: "block" }} onError={(e)=>{e.target.style.display='none';}} />;
}
const KU_LOGO_PRINT = "/logo.png";

// ---------- DB <-> form mapping ----------
// size_price_deltas rides on the quote, not the tier — one set applies across every
// tier. Stored as an array of records, non-zero entries only ([{size,delta}]); held
// in form state as a keyed map of STRINGS ({"2XL":"1.5"}) because coercing to Number
// on each keystroke makes "1.50" untypeable, the same reason SizeGrid holds strings.
function deltasToMap(v) {
  let arr = [];
  try { arr = Array.isArray(v) ? v : (v ? JSON.parse(v) : []); } catch { arr = []; }
  const map = {};
  (Array.isArray(arr) ? arr : []).forEach((d) => {
    if (!d || d.size == null) return;
    const n = Number(d.delta);
    if (!isFinite(n) || n === 0) return;
    map[String(d.size)] = String(n);
  });
  return map;
}
// Sizes outside the current scale are dropped here as well as on scale change, so a
// stale delta can never reach the column. No scale (a flat product) stores [].
function mapToDeltas(map, scaleKey) {
  if (!scaleKey) return [];
  return sizesForScale(scaleKey)
    .map((s) => ({ size: s, delta: Number((map || {})[s]) }))
    .filter((d) => isFinite(d.delta) && d.delta !== 0);
}
// Per-size quantities ride on the TIER, not the quote — 500 units split S/M/L is a
// different split at 5,000. Stored as an object keyed by size, held in form state as
// STRINGS for the same reason the deltas are. Absent on every tier written before
// this existed, which reads back as {}.
function qtyMapFrom(v) {
  let obj = v;
  try { if (typeof v === "string") obj = v ? JSON.parse(v) : {}; } catch { obj = {}; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const map = {};
  Object.keys(obj).forEach((s) => {
    const n = Number(obj[s]);
    if (!isFinite(n)) return;
    map[String(s)] = String(n);
  });
  return map;
}
// Returns null rather than {} when nothing is entered, so formToRow can leave the key
// off entirely and a tier nobody has touched keeps writing exactly the six keys it
// always has. Sizes outside the current scale are dropped here as well as on scale
// change, the same belt-and-braces mapToDeltas uses.
function qtyMapToRow(map, scaleKey) {
  if (!scaleKey) return null;
  const out = {};
  sizesForScale(scaleKey).forEach((s) => {
    const v = (map || {})[s];
    if (v === "" || v == null) return;
    const n = Number(v);
    if (isFinite(n)) out[s] = n;
  });
  return Object.keys(out).length ? out : null;
}
function rowToForm(r) {
  let tiers = [];
  try { tiers = Array.isArray(r.tiers) ? r.tiers : (r.tiers ? JSON.parse(r.tiers) : []); } catch { tiers = []; }
  if ((!tiers || tiers.length === 0) && (r.landed != null || r.qty != null)) {
    const landed = r.landed ?? "";
    if (landed !== "" || r.qty) {
      tiers = [{
        qty: r.qty ?? "",
        landed: landed,
        ship: "ocean",
        freightOcean: r.freight_duty ?? "",
        client: landed !== "" ? suggestClientPrice(landed) : "",
      }];
    }
  }
  tiers = (tiers || []).map((t) => {
    const ship = t.ship || "ocean";
    let air = t.freightAir ?? "";
    let ocean = t.freightOcean ?? "";
    if (t.freightDuty != null && t.freightDuty !== "" && air === "" && ocean === "") {
      if (ship === "air") air = t.freightDuty; else ocean = t.freightDuty;
    }
    return { qty: t.qty ?? "", landed: t.landed ?? "", ship, freightAir: air, freightOcean: ocean, client: t.client ?? "", fb: Array.isArray(t.fb) ? t.fb : null, duty_only: t.duty_only || false, sizeQty: qtyMapFrom(t.sizeQty) };
  });
  return {
    id: r.id,
    quoteDate: r.quote_date || "", product: r.product || "",
    sku: r.sku || "", sizeScale: r.size_scale || "", sizeDeltas: deltasToMap(r.size_price_deltas), notes: r.notes || "",
    client: r.client || "", clientContact: r.client_contact || "", clientEmail: r.client_email || "",
    clientPhone: r.client_phone || "", clientAddress: r.client_address || "",
    factory: r.factory || "", factoryContact: r.factory_contact || "", factoryEmail: r.factory_email || "",
    factoryPhone: r.factory_phone || "", country: r.country || "", leadTime: r.lead_time || "", hts: r.hts || "",
    unitsPerCarton: r.units_per_carton ?? "", cartonL: r.carton_l ?? "", cartonW: r.carton_w ?? "",
    cartonH: r.carton_h ?? "", cartonWeight: r.carton_weight ?? "",
    freightDutyUpdatedAt: r.freight_duty_updated_at || "", freightDutyUpdatedBy: r.freight_duty_updated_by || "",
    moldFee: r.mold_fee ?? "", sampleFee: r.sample_fee ?? "",
    tiers: tiers || [],
    updatedAt: r.updated_at || "", updatedBy: r.updated_by || "",
  };
}
function formToRow(f) {
  const num = (v) => (v === "" || v == null ? null : Number(v));
  // This whitelist is destructive: anything not named here is silently dropped on
  // every save. fb and duty_only came from upstream; sizeQty is appended only when a
  // tier actually carries size quantities, so an untouched tier writes the same keys
  // it always has.
  const tiers = (f.tiers || []).map((t) => {
    const out = {
      qty: t.qty === "" || t.qty == null ? null : Number(t.qty),
      landed: t.landed === "" || t.landed == null ? null : Number(t.landed),
      ship: t.ship || "ocean",
      freightAir: t.freightAir === "" || t.freightAir == null ? null : Number(t.freightAir),
      freightOcean: t.freightOcean === "" || t.freightOcean == null ? null : Number(t.freightOcean),
      client: t.client === "" || t.client == null ? null : Number(t.client),
      fb: Array.isArray(t.fb) && t.fb.length ? t.fb : null,
      duty_only: t.duty_only || false,
    };
    const sizeQty = qtyMapToRow(t.sizeQty, f.sizeScale);
    if (sizeQty) out.sizeQty = sizeQty;
    return out;
  });
  const first = f.tiers && f.tiers[0] ? f.tiers[0] : {};
  return {
    quote_date: f.quoteDate || null, product: f.product || null,
    sku: f.sku || null, size_scale: f.sizeScale || null, size_price_deltas: mapToDeltas(f.sizeDeltas, f.sizeScale), qty: num(first.qty), notes: f.notes || null,
    client: f.client || null, client_contact: f.clientContact || null, client_email: f.clientEmail || null,
    client_phone: f.clientPhone || null, client_address: f.clientAddress || null,
    factory: f.factory || null, factory_contact: f.factoryContact || null, factory_email: f.factoryEmail || null,
    factory_phone: f.factoryPhone || null, country: f.country || null, lead_time: f.leadTime || null, hts: f.hts || null,
    units_per_carton: num(f.unitsPerCarton), carton_l: num(f.cartonL), carton_w: num(f.cartonW),
    carton_h: num(f.cartonH), carton_weight: num(f.cartonWeight),
    landed: num(first.landed), freight_duty: num(first.ship === "air" ? first.freightAir : first.freightOcean),
    freight_duty_updated_at: f.freightDutyUpdatedAt || null, freight_duty_updated_by: f.freightDutyUpdatedBy || null,
    mold_fee: num(f.moldFee), sample_fee: num(f.sampleFee),
    tiers: tiers,
    updated_at: stamp(), updated_by: f.updatedBy || null,
  };
}

const PRESET_QTYS = [500, 1000, 2500, 5000];

// Sizes have historically been baked into the SKU string (LHS-170 - Large, BG-101-2XL).
// If one is still there, recording a scale as well would double it downstream.
const SKU_SIZE_SUFFIX = /[-_\/ ]\s*(?:[0-9]?X{0,3}(?:S|M|L|XS|SM|MED|LG|XL|XXL|SMALL|MEDIUM|LARGE|XLARGE|XXLARGE))\s*$/i;
const skuLooksSized = (sku) => SKU_SIZE_SUFFIX.test((sku || "").trim());

const BLANK = {
  id: null, quoteDate: "", product: "", sku: "", sizeScale: "", sizeDeltas: {}, notes: "",
  updatedAt: "", updatedBy: "",
  client: "", clientContact: "", clientEmail: "", clientPhone: "", clientAddress: "",
  factory: "", factoryContact: "", factoryEmail: "", factoryPhone: "", country: "", leadTime: "", hts: "",
  unitsPerCarton: "", cartonL: "", cartonW: "", cartonH: "", cartonWeight: "",
  freightDutyUpdatedAt: "", freightDutyUpdatedBy: "",
  moldFee: "", sampleFee: "",
  tiers: [{ qty: "", landed: "", ship: "ocean", freightAir: "", freightOcean: "", client: "" }],
};

// ============================================================
//  EXPORTED TAB COMPONENT
//  Login is handled by the ERP shell; we read the existing session
//  and render the Platform directly.
// ============================================================
export default function Quotes({ session: erpSession }) {
  const [session, setSession] = useState(erpSession || null);

  useEffect(() => {
    if (erpSession) { setSession(erpSession); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => { sub.subscription.unsubscribe(); };
  }, [erpSession]);

  if (!session) return <div style={S.shell}><style>{CSS}</style><div style={S.center}>Loading quotes…</div></div>;
  return <Platform session={session} />;
}

// ---------- tier calc helpers ----------
function quoteSummary(q) {
  const tiers = q.tiers || [];
  if (!tiers.length) return { count: 0, minClient: null, maxClient: null, avgMargin: 0, method: null };
  const prices = tiers.map((t) => Number(t.client) || 0).filter((p) => p > 0);
  const margins = tiers.map((t) => tierMargin(t, t.client, q.moldFee)).filter((m) => m !== 0);
  // ship lives on the tier, so a quote only has one method when every tier agrees.
  // A tier with no ship key counts as ocean -- the same default activeFreight uses,
  // so the column can never disagree with the freight the tier is actually costed on.
  const ships = new Set(tiers.map((t) => t.ship || "ocean"));
  return {
    count: tiers.length,
    minClient: prices.length ? Math.min(...prices) : null,
    maxClient: prices.length ? Math.max(...prices) : null,
    avgMargin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0,
    method: ships.size > 1 ? "Mixed" : (ships.has("air") ? "Air" : "Ocean"),
  };
}

// Dropdown-only sentinel for "show every client". activeClient itself stays null in that
// case — it is a view selector, and a string here would flip the router to "clientQuotes".
const ALL = "__all_clients__";

// ---------- main platform ----------
function Platform({ session }) {
  const userEmail = session?.user?.email || "unknown";
  const isMobile = useIsMobile();
  const lastSaveRef = useRef(0);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [activeClient, setActiveClient] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [toast, setToast] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [factories, setFactories] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [clientRecords, setClientRecords] = useState([]);
  const [showDirectory, setShowDirectory] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [showTasks, setShowTasks] = useState(false);
  const [showSend, setShowSend] = useState(false);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 1900); };

  const loadTasks = useCallback(async () => {
    const { data, error } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
    if (!error) setTasks(data || []);
  }, []);

  const addTask = async (task) => {
    const { error } = await supabase.from("tasks").insert(task);
    if (error) { flash("Couldn't add task: " + error.message); return false; }
    await loadTasks();
    flash("Task assigned to " + nameForEmail(task.assigned_to));
    notifyTaskAssigned(task); // best-effort email; never blocks task creation
    return true;
  };

  const notifyTaskAssigned = async (task) => {
    try {
      if (!task.assigned_to) return;
      const e = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
      const who  = nameForEmail(task.assigned_to);
      const from = nameForEmail(task.assigned_by);
      const label = task.quote_label
        ? `<p style="margin:0;color:#64748b;font-size:12.5px">Quote: <strong style="color:#0b1120">${e(task.quote_label)}</strong></p>` : "";
      const html = `
        <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px">
          <p style="font-size:15px;color:#0b1120;margin:0 0 4px">Hi ${e(who)},</p>
          <p style="font-size:15px;color:#0b1120;margin:0 0 16px"><strong>${e(from)}</strong> assigned you a task in Vessl:</p>
          <div style="background:#f6f8fb;border:1px solid #e6eaf0;border-radius:10px;padding:16px 18px;margin:0 0 18px">
            <p style="margin:0 0 8px;font-size:15px;color:#0b1120;line-height:1.5">${e(task.task)}</p>
            ${label}
          </div>
          <a href="https://orders.vessl.io" style="display:inline-block;background:#0b1530;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Open Vessl &rarr;</a>
          <p style="color:#94a3b8;font-size:11px;margin:22px 0 0">King Universal &middot; Vessl</p>
        </div>`;
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          to: task.assigned_to,
          replyTo: task.assigned_by || undefined,
          subject: `New task from ${from}`,
          html,
        },
      });
      if (error) {
        let why = error.message || "unknown error";
        try { const ctx = await error.context?.json?.(); if (ctx?.error) why = ctx.error; } catch {}
        flash("Email didn't send: " + why);
        return;
      }
      if (data && data.ok === false) { flash("Email didn't send: " + (data.error || "unknown")); return; }
      flash("Email sent to " + who);
    } catch (err) {
      flash("Email error: " + (err?.message || err));
    }
  };

  const toggleTask = async (t) => {
    const { error } = await supabase.from("tasks").update({ done: !t.done, done_at: !t.done ? stamp() : null }).eq("id", t.id);
    if (!error) loadTasks();
  };

  const deleteTask = async (id) => {
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (!error) loadTasks();
  };

  const loadFactories = useCallback(async () => {
    const { data, error } = await supabase.from("factory_presets").select("*").order("name", { ascending: true });
    if (!error) setFactories(data || []);
  }, []);

  const loadContacts = useCallback(async () => {
    const { data, error } = await supabase.from("client_contacts").select("*").order("client", { ascending: true });
    if (!error) setContacts(data || []);
  }, []);

  const loadClientRecords = useCallback(async () => {
    const { data, error } = await supabase.from("clients").select("*").order("name", { ascending: true });
    if (!error) setClientRecords(data || []);
  }, []);

  const saveContact = async (contact) => {
    const { error } = await supabase.from("client_contacts").upsert(contact).select();
    if (error && !/duplicate|unique/i.test(error.message)) { flash("Couldn't save contact: " + error.message); return false; }
    // Mirror into ERP company directory
    try {
      const { data: co } = await SB.from('companies').upsert({name:contact.client,type:'client',email:contact.email||null,phone:contact.phone||null},{onConflict:'name,type'}).select('id').single();
      if (co?.id && contact.contact) {
        const exists = await SB.from('contacts').select('id').eq('company_id',co.id).ilike('full_name',contact.contact).limit(1);
        if (!exists.data?.length) await SB.from('contacts').insert({company_id:co.id,full_name:contact.contact,email:contact.email||null,phone:contact.phone||null,is_primary:true}).select();
      }
    } catch(e) {}
    await loadContacts();
    flash("Contact saved to library");
    return true;
  };

  const saveFactoryPreset = async (preset) => {
    const { error } = await supabase.from("factory_presets").upsert(preset).select();
    if (error && !/duplicate|unique/i.test(error.message)) { flash("Couldn't save factory: " + error.message); return false; }
    // Mirror into ERP company directory
    try {
      const factName = (preset.factory || preset.name || '').trim();
      if (factName) await SB.from('companies').upsert({name:factName,type:'factory',email:preset.factory_email||null,phone:preset.factory_phone||null},{onConflict:'name,type'}).select();
    } catch(e) {}
    await loadFactories();
    flash("Factory saved to library");
    return true;
  };

  const updateContact = async (id, fields) => {
    const { error } = await supabase.from("client_contacts").update(fields).eq("id", id);
    if (error) { flash("Couldn't update: " + error.message); return false; }
    await loadContacts(); flash("Contact updated"); return true;
  };
  const deleteContact = async (id) => {
    const { error } = await supabase.from("client_contacts").delete().eq("id", id);
    if (error) { flash("Couldn't delete: " + error.message); return false; }
    await loadContacts(); flash("Contact deleted"); return true;
  };
  const addContactDirect = async (contact) => {
    const { error } = await supabase.from("client_contacts").insert({ ...contact, created_by: userEmail });
    if (error) { flash("Couldn't add: " + error.message); return false; }
    await loadContacts(); flash("Contact added"); return true;
  };

  const updateFactory = async (id, fields) => {
    const { error } = await supabase.from("factory_presets").update(fields).eq("id", id);
    if (error) { flash("Couldn't update: " + error.message); return false; }
    await loadFactories(); flash("Factory updated"); return true;
  };
  const deleteFactory = async (id) => {
    const { error } = await supabase.from("factory_presets").delete().eq("id", id);
    if (error) { flash("Couldn't delete: " + error.message); return false; }
    await loadFactories(); flash("Factory deleted"); return true;
  };
  const addFactoryDirect = async (preset) => {
    const { error } = await supabase.from("factory_presets").insert({ ...preset, created_by: userEmail });
    if (error) { flash("Couldn't add: " + error.message); return false; }
    await loadFactories(); flash("Factory added"); return true;
  };

  const upsertClientRecord = async (name, fields) => {
    const existing = clientRecords.find((c) => (c.name || "").toLowerCase() === name.toLowerCase());
    if (existing) {
      const { error } = await supabase.from("clients").update({ ...fields, updated_at: stamp(), updated_by: userEmail }).eq("id", existing.id);
      if (error) { flash("Couldn't update client: " + error.message); return false; }
    } else {
      const { error } = await supabase.from("clients").insert({ name, ...fields, created_by: userEmail, updated_at: stamp(), updated_by: userEmail });
      if (error) { flash("Couldn't save client: " + error.message); return false; }
    }
    await loadClientRecords(); flash("Client info saved"); return true;
  };

  const load = useCallback(async () => {
    setLoading(true); setLoadErr("");
    const { data, error } = await supabase.from("quotes").select("*").order("created_at", { ascending: false });
    if (error) setLoadErr(error.message);
    else setQuotes((data || []).map(rowToForm));
    setLoading(false);
  }, []);

  useEffect(() => { load(); loadFactories(); loadContacts(); loadClientRecords(); loadTasks(); }, [load, loadFactories, loadContacts, loadClientRecords, loadTasks]);

  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    if (loading || !quotes.length) return;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("quote");
    if (!targetId) { deepLinkHandledRef.current = true; return; }
    const q = quotes.find((x) => x.id === targetId);
    if (q) {
      setActiveClient((q.client || "Unassigned").trim() || "Unassigned");
      setExpanded(targetId);
      setTimeout(() => {
        const el = document.getElementById(`quote-row-${targetId}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    } else {
      flash("That quote couldn't be found — it may have been deleted.");
    }
    window.history.replaceState({}, "", window.location.pathname);
    deepLinkHandledRef.current = true;
  }, [quotes, loading]);

  useEffect(() => {
    const ch = supabase.channel("quotes-changes")
      .on("postgres_changes", { event: "*", schema: "vessl", table: "quotes" }, () => {
        if (Date.now() - lastSaveRef.current < 2500) return;
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const saveQuote = async (f) => {
    lastSaveRef.current = Date.now();
    const row = formToRow({ ...f, updatedBy: userEmail });
    let savedRow = null;
    if (f.id) {
      const { data, error } = await supabase.from("quotes").update(row).eq("id", f.id).select();
      if (error) return flash("Save failed: " + error.message);
      if (!data || data.length === 0) {
        return flash("Save matched 0 rows — id sent: " + String(f.id));
      }
      savedRow = data[0];
    } else {
      const { data, error } = await supabase.from("quotes").insert(row).select();
      if (error) return flash("Save failed: " + error.message);
      savedRow = data && data[0];
    }

    if (savedRow) {
      const confirmed = rowToForm(savedRow);
      setQuotes((prev) => {
        const exists = prev.some((q) => q.id === savedRow.id);
        return exists ? prev.map((q) => (q.id === savedRow.id ? confirmed : q)) : [confirmed, ...prev];
      });
    }

    setEditing(null);
    if (!savedRow) await load();
    else flash("Quote saved");
  };

  const removeQuote = async (id) => {
    const { error } = await supabase.from("quotes").delete().eq("id", id);
    if (error) return flash("Delete failed: " + error.message);
    await load();
    flash("Quote deleted");
  };

  const duplicateQuote = async (f) => {
    const row = formToRow({ ...f, updatedBy: userEmail });
    row.sku = f.sku ? f.sku + "-copy" : null;
    const { error } = await supabase.from("quotes").insert(row);
    if (error) return flash("Duplicate failed: " + error.message);
    await load();
    flash("Quote duplicated");
  };

  const clients = useMemo(() => {
    const map = new Map();
    quotes.forEach((q) => {
      const name = (q.client || "Unassigned").trim() || "Unassigned";
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(q);
    });
    return Array.from(map.entries())
      .map(([name, qs]) => ({ name, quotes: qs }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [quotes]);

  const clientOptions = [
    { value: ALL, label: "All Clients", count: quotes.length },
    ...clients.map((c) => ({
      value: c.name,
      label: c.name,
      color: clientColor(c.name).accent,
      count: c.quotes.length,
    })),
  ];

  const searching = search.trim() !== "";
  const searchResults = useMemo(() => {
    const s = search.toLowerCase();
    return quotes.filter((q) => {
      const hay = `${q.client} ${q.product} ${q.factory} ${q.sku} ${q.clientContact} ${q.factoryContact} ${q.country}`.toLowerCase();
      return hay.includes(s);
    });
  }, [quotes, search]);

  const clientQuotes = useMemo(() => {
    if (!activeClient) return [];
    return quotes.filter((q) => ((q.client || "Unassigned").trim() || "Unassigned") === activeClient);
  }, [quotes, activeClient]);

  const exportCSV = () => {
    const cols = ["SKU","Date","Product","Client","Client Contact","Factory","Country","HTS","Tier Qty","EXW Cost","Method","Freight+Duty","Total Cost","Client Price","Margin %","Updated","Updated By","Notes"];
    const lines = [cols.join(",")];
    quotes.forEach((q) => {
      const tiers = q.tiers && q.tiers.length ? q.tiers : [{}];
      tiers.forEach((t) => {
        const m = tierMargin(t, t.client, q.moldFee);
        lines.push([q.sku,q.quoteDate,q.product,q.client,q.clientContact,q.factory,q.country,q.hts,t.qty,t.landed,(t.ship||"ocean")==="air"?"Air":"Ocean",activeFreight(t)||"",tierTotalCost(t, q.moldFee)||"",t.client,m ? m.toFixed(1) : "",fmtStamp(q.updatedAt),q.updatedBy,(q.notes||"").replace(/\n/g," ")]
          .map((v) => `"${String(v ?? "").replace(/"/g,'""')}"`).join(","));
      });
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "kui-quotes.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  let view = "clients";
  if (searching) view = "search";
  else if (activeClient) view = "clientQuotes";
  const shownQuotes = view === "search" ? searchResults : view === "clientQuotes" ? clientQuotes : [];

  const myOpenTaskCount = tasks.filter((t) => !t.done && (t.assigned_to || "").toLowerCase() === userEmail.toLowerCase()).length;

  return (
    <div style={{ ...S.shell, ...(isMobile ? { padding: "16px 12px 60px" } : {}) }}>
      <style>{CSS}</style>

      <header style={{ ...S.header, ...(isMobile ? S.headerMobile : {}) }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: isMobile ? 22 : 27, fontWeight: 600, color: "#0f1729", letterSpacing: "-0.02em" }}>Quotes</span>
          <span style={{ fontSize: 12, color: "#6a7488" }}>Pricing &amp; quote management</span>
        </div>
        <div style={{ display: "flex", gap: isMobile ? 6 : 10, alignItems: "center", flexWrap: "wrap", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
          {!isMobile && <span style={S.userTag}>{userEmail}</span>}
          <button style={{ ...S.ghostBtn, position: "relative", ...(isMobile ? S.btnMobile : {}) }} onClick={() => setShowTasks(true)}>
            <Bell size={15} /> {isMobile ? "" : "Tasks"}
            {myOpenTaskCount > 0 && <span style={S.taskBadge}>{myOpenTaskCount}</span>}
          </button>
          <button style={{ ...S.ghostBtn, ...(isMobile ? S.btnMobile : {}) }} onClick={() => setShowSend(true)}><Send size={15} /> {isMobile ? "Send" : "Send to Client"}</button>
          <button style={{ ...S.ghostBtn, ...(isMobile ? S.btnMobile : {}) }} onClick={exportCSV}><Download size={15} /> {isMobile ? "" : "Export"}</button>
          <button style={{ ...S.primaryBtn, ...(isMobile ? S.btnMobile : {}) }} onClick={() => setEditing({ ...BLANK, quoteDate: new Date().toISOString().slice(0, 10), client: "", tiers: [{ qty: "", landed: "", ship: "ocean", freightAir: "", freightOcean: "", client: "" }] })}>
            <Plus size={16} /> {isMobile ? "New" : "New Quote"}
          </button>
        </div>
      </header>

      {showTasks && (
        <TasksPanel
          tasks={tasks} userEmail={userEmail}
          onToggle={toggleTask} onDelete={deleteTask}
          onClose={() => setShowTasks(false)}
          onJump={(qid) => { const qq = quotes.find((x) => x.id === qid); if (qq) { setActiveClient((qq.client || "Unassigned").trim() || "Unassigned"); setExpanded(qid); setShowTasks(false); } }}
        />
      )}

      {showSend && (
        <SendToClientModal clients={clients} onClose={() => setShowSend(false)} />
      )}

      <div style={S.controls}>
        <div style={S.searchWrap}>
          <Search size={16} color="#6a7488" />
          <input style={S.searchInput} placeholder="Search all quotes — client, product, factory, SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {searching && <button style={S.clearBtn} onClick={() => setSearch("")}><X size={14} /></button>}
        </div>
      </div>

      {!searching && (
        <div className="fs-row" style={{ maxWidth: 1280, margin: "0 auto 20px" }}>
          <FilterSelect
            label="All Clients"
            value={activeClient ?? ALL}
            onChange={(v) => { setActiveClient(v === ALL ? null : v); setExpanded(null); }}
            options={clientOptions}
          />
        </div>
      )}

      {loadErr && <div style={{ ...S.controls, color: "#a14a4a", fontSize: 13 }}>Couldn't load quotes: {loadErr}</div>}

      {view === "clientQuotes" && (
        <div style={S.breadcrumb}>
          <button style={S.crumbBtn} onClick={() => { setActiveClient(null); setExpanded(null); }}>
            <ChevronLeft size={15} /> All Clients
          </button>
          <span style={S.crumbSep}>/</span>
          <span style={S.crumbCurrent}>{activeClient}</span>
          <span style={S.crumbMeta}>{clientQuotes.length} {clientQuotes.length === 1 ? "quote" : "quotes"}</span>
        </div>
      )}

      {view === "clients" && (
        <div style={S.clientGrid}>
          {loading && <div style={S.empty}><div style={{ color: "#6a7488" }}>Loading…</div></div>}
          {!loading && clients.length === 0 && (
            <div style={S.empty}>
              <Box size={42} color="#e7eaf0" strokeWidth={1.2} />
              <div style={{ marginTop: 12, color: "#6a7488" }}>No quotes yet. Create your first one.</div>
            </div>
          )}
          {!loading && clients.map((c) => {
            const tierTotal = c.quotes.reduce((s, q) => s + (q.tiers ? q.tiers.length : 0), 0);
            const latest = c.quotes.reduce((a, q) => (!a || (q.updatedAt > a) ? q.updatedAt : a), "");
            const col = clientColor(c.name);
            return (
              <button key={c.name} style={{ ...S.clientCard, background: col.bg, borderColor: "#e7eaf0", borderTop: `2px solid ${col.accent}` }} onClick={() => setActiveClient(c.name)}>
                <div style={S.clientCardTop}>
                  <div style={{ ...S.clientAvatar, background: col.avatar, color: col.text }}>{c.name.slice(0, 2).toUpperCase()}</div>
                  <ChevronRight size={18} color="#3f4853" />
                </div>
                <div style={{ ...S.clientName, color: "#0f1729" }}>{c.name}</div>
                <div style={S.clientMeta}>
                  {c.quotes.length} {c.quotes.length === 1 ? "quote" : "quotes"} · {tierTotal} tiers
                </div>
                <div style={S.clientUpdated}>Updated {fmtStamp(latest)}</div>
              </button>
            );
          })}
        </div>
      )}

      {(view === "clientQuotes" || view === "search") && (
        <div style={S.tableWrap}>
          <div style={S.theadRow}>
            <div style={{ width: isMobile ? 20 : 26 }} />
            <div style={{ flex: isMobile ? 1.8 : 2.4 }}>Product{view === "search" ? " / Client" : ""}</div>
            {!isMobile && <div style={{ flex: 1.5 }}>Factory</div>}
            {!isMobile && <div style={{ flex: 0.8, textAlign: "center" }}>Tiers</div>}
            {!isMobile && <div style={{ flex: 0.8 }}>Method</div>}
            <div style={{ flex: isMobile ? 1.3 : 1.5, textAlign: "right", whiteSpace: "nowrap" }}>{isMobile ? "Price" : "Client Price Range"}</div>
            <div style={{ ...(isMobile ? { width: 52 } : { flex: 0.9 }), textAlign: "right", whiteSpace: "nowrap" }}>{isMobile ? "Marg" : "Avg Margin"}</div>
            {!isMobile && <div style={{ flex: 1.1 }}>Updated</div>}
            {!isMobile && <div style={{ width: 112 }} />}
          </div>

          {loading && <div style={S.empty}><div style={{ color: "#6a7488" }}>Loading…</div></div>}
          {!loading && shownQuotes.length === 0 && (
            <div style={S.empty}>
              <Box size={40} color="#e7eaf0" strokeWidth={1.2} />
              <div style={{ marginTop: 12, color: "#6a7488" }}>
                {view === "search" ? "No quotes match your search." : "No quotes for this client yet."}
              </div>
            </div>
          )}

          {!loading && shownQuotes.map((q) => {
            const sum = quoteSummary(q);
            const open = expanded === q.id;
            const priceRange = sum.minClient == null ? "—"
              : sum.minClient === sum.maxClient ? `$${fmt(sum.minClient)}`
              : `$${fmt(sum.maxClient)} – $${fmt(sum.minClient)}`;
            return (
              <div key={q.id} style={S.rowGroup}>
                <div id={`quote-row-${q.id}`} style={{ ...S.row, ...(open ? S.rowOpen : {}) }} onClick={() => setExpanded(open ? null : q.id)}>
                  <div style={{ width: isMobile ? 20 : 26, display: "flex", alignItems: "center" }}>
                    {open ? <ChevronDown size={16} color="#6a7488" /> : <ChevronRight size={16} color="#6a7488" />}
                  </div>
                  <div style={{ flex: isMobile ? 1.8 : 2.4, minWidth: 0 }}>
                    <div style={S.cellPrimary}>{q.sku || "No SKU"}</div>
                    <div style={S.cellSub}>{q.product || "Untitled product"}{view === "search" && q.client ? ` · ${q.client}` : ""}</div>
                  </div>
                  {!isMobile && (
                    <div style={{ flex: 1.5 }}>
                      <div style={S.cellPrimary}>{q.factory || "—"}</div>
                      <div style={S.cellSub}>{q.country || ""}</div>
                    </div>
                  )}
                  {!isMobile && (
                    <div style={{ flex: 0.8, textAlign: "center" }}>
                      <span style={S.tierBadge}><Layers size={11} /> {sum.count}</span>
                    </div>
                  )}
                  {/* Air and Ocean are not good and bad, so no colour coding —
                      plain muted text, same tone as the other secondary cells. */}
                  {!isMobile && <div style={{ flex: 0.8, fontSize: 13, color: "#6a7488" }}>{sum.method || "—"}</div>}
                  <div style={{ flex: isMobile ? 1.3 : 1.5, textAlign: "right", whiteSpace: "nowrap", ...S.num, fontWeight: 600, color: "#0f1729", fontSize: isMobile ? 13 : undefined }}>{priceRange}</div>
                  <div style={{ ...(isMobile ? { width: 52 } : { flex: 0.9 }), textAlign: "right", whiteSpace: "nowrap", ...S.num }}>
                    <span style={{ color: sum.avgMargin < 25 ? "#c2683a" : "#3f7d5a", fontWeight: 600 }}>
                      {sum.avgMargin ? sum.avgMargin.toFixed(0) + "%" : "—"}
                    </span>
                  </div>
                  {!isMobile && (
                    <div style={{ flex: 1.1 }}>
                      <div style={S.cellSub2}>{fmtStamp(q.updatedAt)}</div>
                      <div style={S.cellSub}>{q.updatedBy || ""}</div>
                    </div>
                  )}
                  {!isMobile && (
                    <div style={{ width: 112, display: "flex", gap: 4, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
                      <button style={S.iconBtn} title="Edit" onClick={() => setEditing(q)}><Edit3 size={15} /></button>
                      <button style={S.iconBtn} title="Duplicate" onClick={() => duplicateQuote(q)}><Copy size={15} /></button>
                      <button style={S.iconBtn} title="Delete" onClick={() => { if (confirm("Delete this quote?")) removeQuote(q.id); }}><Trash2 size={15} /></button>
                    </div>
                  )}
                </div>
                {open && <ExpandedDetail q={q} tasks={tasks.filter((t) => t.quote_id === q.id)} onAddTask={addTask} onToggleTask={toggleTask} onDeleteTask={deleteTask} userEmail={userEmail} isMobile={isMobile} onEdit={() => setEditing(q)} onDuplicate={() => duplicateQuote(q)} onDelete={() => { if (confirm("Delete this quote?")) removeQuote(q.id); }} />}
              </div>
            );
          })}
        </div>
      )}

      {editing && <QuoteForm initial={editing} onClose={() => setEditing(null)} onSave={saveQuote} factories={factories} clientNames={clients.map((c) => c.name).filter((n) => n !== "Unassigned")} contacts={contacts} onSaveFactory={saveFactoryPreset} onSaveContact={saveContact} userEmail={userEmail} />}
      {toast && <div style={S.toast}><Check size={15} /> {toast}</div>}
    </div>
  );
}

// ---------- expanded detail ----------
function MarkWonButton({ q }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState('idle'); // idle | done | exists

  const start = async () => {
    setBusy(true);
    try {
      // don't double-create: look for an existing program on this quote
      const { data: existing } = await SB.from('programs').select('id').eq('quote_id', q.id).limit(1);
      if (existing && existing.length) { setState('exists'); setBusy(false); setTimeout(()=>setState('idle'),4000); return; }

      const { data: prog, error } = await SB.from('programs').insert({
        quote_id: q.id, quote_sku: q.sku || null,
        product: q.product || null, sku: q.sku || null,
        client: q.client || null, factory: q.factory || null,
        client_email: q.clientEmail || null, client_contact: q.clientContact || null,
        factory_email: q.factoryEmail || null, factory_contact: q.factoryContact || null,
        stage: 'sampling',
        owner: 'emily@kinguniversal.com',
        master_sample_included: null, sample_round: 1,
      }).select('id').single();
      if (error) { alert('Could not start program: ' + error.message); setBusy(false); return; }

      // seed the Sampling stage checklist
      const SAMPLING = ['Request sample from factory','Sample received from factory','Sample sent to client','Client feedback received'];
      await SB.from('program_tasks').insert(SAMPLING.map((task,i)=>({
        program_id: prog.id, stage: 'sampling', task, owner: 'emily@kinguniversal.com', blocker: 'none', sort_order: i,
      })));
      setState('done'); setBusy(false); setTimeout(()=>setState('idle'),5000);
    } catch (e) {
      alert('Something went wrong: ' + (e && e.message ? e.message : e)); setBusy(false);
    }
  };

  const label = state==='done' ? 'Program started — see Programs tab'
    : state==='exists' ? 'Program already exists'
    : busy ? 'Starting…' : 'Mark won · start program';
  const bg = state==='done' ? '#e7f5ec' : state==='exists' ? '#fef3e2' : '#0f7d43';
  const col = state==='done' ? '#2f7d52' : state==='exists' ? '#b45309' : '#fff';

  return (
    <button
      style={{ display:'inline-flex', alignItems:'center', gap:7, background:bg, border:'1px solid '+(state==='idle'?'#0f7d43':'transparent'), color:col, borderRadius:10, padding:'9px 16px', fontSize:13.5, fontWeight:600, cursor:'pointer' }}
      onClick={start} disabled={busy}
      title="Mark this quote won and create its lifecycle program"
    >
      <CheckCircle2 size={15} /> {label}
    </button>
  );
}

function FreightQuoteButton({ q, cbmPerCarton }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const per = Number(cbmPerCarton) || 0;
  const upc = Number(q.unitsPerCarton) || 0;

  // largest tier quantity → the volume we'd likely ship
  const tiers = Array.isArray(q.tiers) ? q.tiers : [];
  const maxQty = tiers.reduce((a, t) => Math.max(a, Number(t.qty) || 0), 0);

  const generate = async () => {
    if (per <= 0 || upc <= 0) { alert("Add carton dimensions and units-per-carton to this quote first — the freight generator needs them to calculate CBM."); return; }
    setBusy(true);
    try {
      // match this quote's client (text name) to an ERP company
      let clientId = null;
      const nm = (q.client || "").trim();
      if (nm) {
        const { data: comps } = await SB.from("companies").select("id,name");
        const lower = nm.toLowerCase();
        const hit = (comps || []).find((c) => (c.name || "").trim().toLowerCase() === lower)
          || (comps || []).find((c) => { const n = (c.name || "").trim().toLowerCase(); return n && (n.includes(lower) || lower.includes(n)); });
        if (hit) clientId = hit.id;
      }
      const cartons = maxQty > 0 ? Math.ceil(maxQty / upc) : 0;
      const totalCbm = Number((cartons * per).toFixed(3));
      const CAP = 68; // 40'HQ default; adjustable in the ERP generator
      const containers = totalCbm > 0 ? Math.ceil(totalCbm / CAP) : 0;
      const util = containers > 0 ? (totalCbm / (containers * CAP)) * 100 : 0;
      const pieces = cartons * upc;

      const payload = {
        quote_number: "FQ-" + Date.now().toString(36).slice(-5).toUpperCase(),
        client_company_id: clientId,
        forwarder_company_id: null, po_id: null,
        origin: q.country || null, destination: null,
        incoterm: "FOB", ready_date: null,
        container_type: "40HQ", cbm_max: CAP,
        total_cartons: cartons, total_cbm: totalCbm,
        total_weight_kg: Number((cartons * (Number(q.cartonWeight) || 0)).toFixed(2)),
        containers_needed: containers, utilization_pct: Number(util.toFixed(1)),
        line_items: [{ desc: q.product || q.sku || "", upc: upc, cartons: cartons, pieces: pieces, cbm_per: per, cbm_total: totalCbm, weight: Number(q.cartonWeight) || 0 }],
        notes: "Generated from quote " + (q.sku || q.product || "") + (nm ? " for " + nm : ""),
        status: "draft",
      };
      const { error } = await SB.from("shipment_quotes").insert(payload);
      if (error) { alert("Could not create freight quote: " + error.message); setBusy(false); return; }
      setDone(true);
      setTimeout(() => setDone(false), 4000);
    } catch (e) {
      alert("Something went wrong: " + (e && e.message ? e.message : e));
    }
    setBusy(false);
  };

  return (
    <button
      style={{ ...S.printBtn, background: done ? "#e7f5ec" : S.printBtn.background, color: done ? "#2f7d52" : S.printBtn.color, borderColor: done ? "#b7e0c5" : (S.printBtn.borderColor || "#d9dee8") }}
      onClick={generate} disabled={busy}
      title="Create a draft freight quote in the Shipments tab, pre-filled from this quote"
    >
      <Truck size={15} /> {busy ? "Creating…" : done ? "Draft created — see Shipments ▸ Freight Quotes" : "Generate freight quote"}
    </button>
  );
}

// ── Freight & Duty Builder ────────────────────────────────────────────────────
// Build a tier's per-unit freight/duty from its real cost legs: containers in,
// warehousing, palletized outbound, trucking, duty. Replaces side spreadsheets.
const FB_BASES = [
  { key: "container", label: "per container", perLabel: "units / container" },
  { key: "shipment",  label: "per shipment",  perLabel: "units / shipment" },
  { key: "pallet",    label: "per pallet",    perLabel: "units / pallet" },
  { key: "unit",      label: "per unit",      perLabel: null },
  { key: "pct",       label: "% of EXW",      perLabel: "dutiable share %" },
  { key: "flat",      label: "flat total",    perLabel: null },
];
const FB_PRESETS = [
  { cat: "Ocean freight",     basis: "container" },
  { cat: "Drayage",           basis: "container" },
  { cat: "Warehouse handling",basis: "unit" },
  { cat: "Storage",           basis: "flat" },
  { cat: "Palletizing",       basis: "pallet" },
  { cat: "Outbound trucking", basis: "shipment" },
  { cat: "Parcel / small pkg",basis: "unit" },
  { cat: "Duty",              basis: "pct", amount: "27.4", per: "50" },
  { cat: "Other",             basis: "unit" },
];

function fbLegPerUnit(leg, exw, tierQty) {
  const amt = Number(leg.amount) || 0;
  const per = Number(leg.per) || 0;
  if (leg.basis === "unit") return amt;
  if (leg.basis === "pct") return exw * (amt / 100) * ((per > 0 ? per : 100) / 100);
  if (leg.basis === "flat") return tierQty > 0 ? amt / tierQty : 0;
  return per > 0 ? amt / per : 0; // container / shipment / pallet
}

function FreightBuilder({ tier, form, onClose, onApply }) {
  const exw = Number(tier.landed) || 0;
  const tierQty = Number(tier.qty) || 0;
  // units per 40'HQ from carton data, as a prefill hint
  const upc = Number(form.unitsPerCarton) || 0;
  const cbmCtn = (Number(form.cartonL) * Number(form.cartonW) * Number(form.cartonH)) / 1000000;
  const unitsPerHQ = (upc > 0 && isFinite(cbmCtn) && cbmCtn > 0) ? Math.floor(68 / cbmCtn) * upc : 0;

  const [legs, setLegs] = useState(() =>
    Array.isArray(tier.fb) && tier.fb.length
      ? tier.fb.map((l) => ({ ...l }))
      : [{ cat: "Ocean freight", desc: "", basis: "container", amount: "", per: unitsPerHQ > 0 ? String(unitsPerHQ) : "" }]
  );

  const setLeg = (i, k) => (e) => setLegs((p) => p.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)));
  const setLegBasis = (i) => (e) => {
    const basis = e.target.value;
    setLegs((p) => p.map((l, j) => {
      if (j !== i) return l;
      let per = l.per;
      if (basis === "container" && (!per || Number(per) <= 0) && unitsPerHQ > 0) per = String(unitsPerHQ);
      if (basis === "pct" && (!per || Number(per) <= 0)) per = "100";
      return { ...l, basis, per };
    }));
  };
  const addLeg = (preset) => setLegs((p) => [...p, {
    cat: preset ? preset.cat : "Other", desc: "",
    basis: preset ? preset.basis : "unit",
    amount: preset && preset.amount ? preset.amount : "",
    per: preset ? (preset.per ? preset.per : (preset.basis === "container" && unitsPerHQ > 0 ? String(unitsPerHQ) : "")) : "",
  }]);
  const rmLeg = (i) => setLegs((p) => p.filter((_, j) => j !== i));

  const total = legs.reduce((a, l) => a + fbLegPerUnit(l, exw, tierQty), 0);
  const cleanLegs = legs.filter((l) => (Number(l.amount) || 0) > 0).map((l) => ({
    cat: l.cat, desc: l.desc || "", basis: l.basis,
    amount: Number(l.amount) || 0, per: Number(l.per) || 0,
    perUnit: +fbLegPerUnit(l, exw, tierQty).toFixed(4),
  }));

  const cellIn = { width: "100%", border: "1px solid #e0e4ec", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, outline: "none", fontFamily: "inherit", boxSizing: "border-box", background: "#fff" };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(15,23,41,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "36px 14px", zIndex: 1300, overflowY: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 700, boxShadow: "0 16px 56px rgba(15,23,41,.25)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "20px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0f1729", letterSpacing: "-.01em" }}>Freight &amp; Duty build-up</div>
            <div style={{ fontSize: 12.5, color: "#6a7488", marginTop: 4, lineHeight: 1.5 }}>
              Tier {tierQty ? tierQty.toLocaleString() : "—"} units · EXW {exw ? `$${exw.toFixed(2)}` : "—"}{unitsPerHQ > 0 ? ` · ~${unitsPerHQ.toLocaleString()} units fit a 40'HQ (from carton data)` : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "#f2f4f8", border: "none", borderRadius: "50%", width: 28, height: 28, fontSize: 15, color: "#6a7488", cursor: "pointer", flexShrink: 0 }}>×</button>
        </div>

        {/* preset quick-adds */}
        <div style={{ padding: "14px 24px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FB_PRESETS.map((pr) => (
            <button key={pr.cat} type="button" onClick={() => addLeg(pr)} style={{ fontSize: 11.5, fontWeight: 600, border: "1px solid #e0e4ec", background: "#f7f8fb", color: "#3551c4", borderRadius: 20, padding: "5px 11px", cursor: "pointer" }}>+ {pr.cat}</button>
          ))}
        </div>

        {/* legs */}
        <div style={{ padding: "16px 24px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.9fr 0.9fr 0.8fr 26px", gap: 6, marginBottom: 6 }}>
            {["Cost leg", "Basis", "Amount $", "Divisor", "$ / unit", ""].map((h, i) => (
              <div key={i} style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#8a93a6", textAlign: i >= 2 && i < 5 ? "right" : "left" }}>{h}</div>
            ))}
          </div>
          {legs.map((l, i) => {
            const base = FB_BASES.find((b) => b.key === l.basis) || FB_BASES[0];
            const pu = fbLegPerUnit(l, exw, tierQty);
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.9fr 0.9fr 0.8fr 26px", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <input style={cellIn} value={l.cat} onChange={setLeg(i, "cat")} placeholder="Cost leg" />
                <select style={cellIn} value={l.basis} onChange={setLegBasis(i)}>
                  {FB_BASES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                </select>
                <input style={{ ...cellIn, textAlign: "right" }} type="number" value={l.amount} onChange={setLeg(i, "amount")} placeholder={l.basis === "pct" ? "%" : "$"} />
                {base.perLabel
                  ? <input style={{ ...cellIn, textAlign: "right" }} type="number" value={l.per} onChange={setLeg(i, "per")} placeholder={base.perLabel} title={base.perLabel} />
                  : <div style={{ fontSize: 11, color: "#aab2c0", textAlign: "right", paddingRight: 4 }}>{l.basis === "flat" ? `÷ ${tierQty ? tierQty.toLocaleString() : "qty"}` : "—"}</div>}
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0f1729", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pu > 0 ? `$${pu.toFixed(3)}` : "—"}</div>
                <button type="button" onClick={() => rmLeg(i)} style={{ background: "none", border: "none", color: "#c3c9d4", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            );
          })}
        </div>

        {/* total + apply */}
        <div style={{ margin: "16px 24px 0", background: "#f7f8fb", border: "1px solid #e6e9f0", borderRadius: 12, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "#8a93a6", marginBottom: 4 }}>Freight + duty per unit</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#0f1729", fontVariantNumeric: "tabular-nums", letterSpacing: "-.02em" }}>${total.toFixed(3)}</div>
          </div>
          <div style={{ fontSize: 11.5, color: "#6a7488", lineHeight: 1.5, maxWidth: 300 }}>
            {tierQty > 0 ? `≈ $${(total * tierQty).toLocaleString(undefined, { maximumFractionDigits: 0 })} total across ${tierQty.toLocaleString()} units. ` : ""}Applies to the ocean freight field and saves this breakdown on the tier.
          </div>
        </div>

        <div style={{ padding: "16px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} style={{ background: "#f2f4f8", border: "none", borderRadius: 10, padding: "9px 17px", fontSize: 13, fontWeight: 600, color: "#0f1729", cursor: "pointer" }}>Cancel</button>
          <button type="button" disabled={total <= 0} onClick={() => onApply(total, cleanLegs)} style={{ background: total > 0 ? "#2f6df6" : "#c3c9d4", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 700, color: "#fff", cursor: total > 0 ? "pointer" : "not-allowed" }}>Apply ${total.toFixed(3)} / unit</button>
        </div>
      </div>
    </div>
  );
}

function fbLegColor(cat, i) {
  const c = (cat || "").toLowerCase();
  if (c.includes("ocean") || c.includes("freight")) return "#2f6df6";
  if (c.includes("dray")) return "#0e9f8f";
  if (c.includes("warehouse") || c.includes("handling")) return "#8b5cf6";
  if (c.includes("storage")) return "#94a3b8";
  if (c.includes("pallet")) return "#f59e0b";
  if (c.includes("truck")) return "#d97706";
  if (c.includes("parcel")) return "#06b6d4";
  if (c.includes("duty") || c.includes("tariff")) return "#e11d48";
  const fallback = ["#2f6df6", "#0e9f8f", "#8b5cf6", "#f59e0b", "#e11d48", "#06b6d4", "#d97706", "#64748b"];
  return fallback[i % fallback.length];
}

function FreightBreakdownView({ tiers }) {
  const withFb = (tiers || []).filter((t) => Array.isArray(t.fb) && t.fb.length);
  if (!withFb.length) return null;
  const baseLabel = (b) => { const m = FB_BASES.find((x) => x.key === b); return m ? m.label : b; };
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ ...S.detailHead, marginBottom: 10 }}><Truck size={14} /> Where the Freight &amp; Duty Goes</div>
      <div style={{ display: "grid", gridTemplateColumns: withFb.length > 1 ? "repeat(auto-fit, minmax(300px, 1fr))" : "1fr", gap: 10 }}>
        {withFb.map((t, i) => {
          const total = t.fb.reduce((a, l) => a + (Number(l.perUnit) || 0), 0);
          const qty = Number(t.qty) || 0;
          return (
            <div key={i} style={{ background: "#fff", border: "1px solid #e0e4ec", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 3px rgba(15,23,41,.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f1729" }}>Tier {qty ? qty.toLocaleString() : "—"} units</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#0f1729", fontVariantNumeric: "tabular-nums", letterSpacing: "-.01em" }}>
                  ${total.toFixed(3)}<span style={{ fontSize: 11.5, fontWeight: 600, color: "#8a93a6" }}>/unit</span>
                  {qty > 0 && <span style={{ fontSize: 11.5, fontWeight: 600, color: "#8a93a6" }}>{" · ≈ $" + (total * qty).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " total"}</span>}
                </div>
              </div>
              {/* proportion bar */}
              <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", marginBottom: 12, background: "#eef1f6" }}>
                {t.fb.map((l, j) => {
                  const pu = Number(l.perUnit) || 0;
                  const pct = total > 0 ? (pu / total) * 100 : 0;
                  if (pct <= 0) return null;
                  return <div key={j} style={{ width: pct + "%", background: fbLegColor(l.cat, j) }} title={l.cat + " " + pct.toFixed(0) + "%"} />;
                })}
              </div>
              {/* legend rows */}
              {t.fb.map((l, j) => {
                const pu = Number(l.perUnit) || 0;
                const pct = total > 0 ? (pu / total) * 100 : 0;
                return (
                  <div key={j} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0", borderTop: j > 0 ? "1px solid #f0f2f7" : "none" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: fbLegColor(l.cat, j), flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#2a3348", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {l.cat}{l.desc ? " — " + l.desc : ""}
                      <span style={{ fontWeight: 500, color: "#9aa3b5", fontSize: 11 }}>
                        {" "}{l.basis === "pct" ? l.amount + "% on " + (l.per && l.per !== 100 ? l.per : 100) + "% of EXW" : baseLabel(l.basis)}
                      </span>
                    </span>
                    <span style={{ fontSize: 11, color: "#9aa3b5", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{pct.toFixed(0)}%</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0f1729", fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: 58, textAlign: "right" }}>${pu.toFixed(3)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const QUOTE_CONTAINERS = [
  { key: "20GP", label: "20' Standard", cbm: 32 },
  { key: "40GP", label: "40' Standard", cbm: 58 },
  { key: "40HQ", label: "40' High-Cube", cbm: 68 },
  { key: "45HQ", label: "45' High-Cube", cbm: 83 },
];

function ContainerPackout({ q, cbmPerCarton }) {
  const [sel, setSel] = useState("40HQ");
  const upc = Number(q.unitsPerCarton) || 0;
  const per = Number(cbmPerCarton) || 0;
  const container = QUOTE_CONTAINERS.find((c) => c.key === sel) || QUOTE_CONTAINERS[2];
  const ready = per > 0;
  const cartons = ready ? Math.floor(container.cbm / per) : 0;
  const units = cartons * upc;
  const usedCbm = cartons * per;
  const util = ready ? (usedCbm / container.cbm) * 100 : 0;

  return (
    <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
      <div style={S.detailHead}><Package size={14} /> Container Packout</div>
      {!ready ? (
        <div style={{ ...S.detailValue, color: "#6a7488", fontSize: 13 }}>
          Add carton dimensions and units-per-carton to calculate how many fit a container.
        </div>
      ) : (
        <div style={{ background: "#f7f8fb", border: "1px solid #e6e9f0", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {QUOTE_CONTAINERS.map((c) => {
              const on = sel === c.key;
              return (
                <button key={c.key} onClick={() => setSel(c.key)} style={{
                  flex: "1 1 130px", textAlign: "left", padding: "10px 13px", borderRadius: 10, cursor: "pointer",
                  border: `1.5px solid ${on ? "#2f6df6" : "#e0e4ec"}`, background: on ? "#eef4ff" : "#fff",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: on ? "#2f6df6" : "#0f1729" }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: "#6a7488", marginTop: 2 }}>{c.cbm} CBM usable</div>
                </button>
              );
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {[
              ["Cartons fit", cartons.toLocaleString()],
              ["Total units", units.toLocaleString()],
              ["Volume used", `${usedCbm.toFixed(1)} CBM`],
              ["Utilization", `${util.toFixed(0)}%`],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "#8a93a6", marginBottom: 5 }}>{k}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#0f1729", fontVariantNumeric: "tabular-nums" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "#6a7488", marginTop: 12, lineHeight: 1.5 }}>
            {upc > 0
              ? `A full ${container.label} holds about ${cartons.toLocaleString()} cartons (${units.toLocaleString()} units) at ${per.toFixed(4)} CBM/carton.`
              : `Enter units-per-carton to see the total unit count.`}
          </div>
        </div>
      )}
    </div>
  );
}

function ExpandedDetail({ q, tasks = [], onAddTask, onToggleTask, onDeleteTask, userEmail, isMobile = false, onEdit, onDuplicate, onDelete }) {
  const [taskText, setTaskText] = useState("");
  const [taskWho, setTaskWho] = useState(TEAM[0].email);
  const submitTask = () => {
    if (!taskText.trim()) return;
    onAddTask({
      quote_id: q.id,
      quote_label: `${q.product || "Quote"}${q.sku ? " · " + q.sku : ""}`,
      assigned_to: taskWho,
      assigned_by: userEmail,
      task: taskText.trim(),
      done: false,
    });
    setTaskText("");
  };
  const Section = ({ icon, title, children }) => (
    <div style={S.detailSection}><div style={S.detailHead}>{icon} {title}</div><div style={S.detailGrid}>{children}</div></div>
  );
  const F = ({ label, value, span }) => (
    <div style={span ? { gridColumn: "1 / -1" } : {}}>
      <div style={S.detailLabel}>{label}</div><div style={S.detailValue}>{value || "—"}</div>
    </div>
  );
  const cbm = (Number(q.cartonL) * Number(q.cartonW) * Number(q.cartonH)) / 1000000;
  return (
    <div style={S.detailPanel}>
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={S.detailHead}><Layers size={14} /> Tiered Pricing</div>
        <div style={S.tierTable}>
          <div style={S.tierHeadRow}>
            <div style={{ flex: 1 }}>Quantity</div>
            <div style={{ flex: 1, textAlign: "right" }}>EXW Cost</div>
            <div style={{ flex: 0.8, textAlign: "center" }}>Method</div>
            <div style={{ flex: 1, textAlign: "right" }}>Freight + Duty</div>
            <div style={{ flex: 1, textAlign: "right" }}>Total Cost</div>
            <div style={{ flex: 1, textAlign: "right" }}>Client Price</div>
            <div style={{ flex: 0.8, textAlign: "right" }}>Margin</div>
          </div>
          {(q.tiers || []).map((t, i) => {
            const m = tierMargin(t, t.client, q.moldFee);
            const total = tierTotalCost(t, q.moldFee);
            // Same divisor tierTotalCost just used, or this caption contradicts the
            // number it is captioning on any tier carrying a size mix.
            const mpu = moldPerUnit(q.moldFee, effectiveQty(t));
            return (
              <div key={i} style={S.tierBodyRow}>
                <div style={{ flex: 1, fontWeight: 600, color: "#0f1729" }}>{t.qty ? Number(t.qty).toLocaleString() : "—"}</div>
                <div style={{ flex: 1, textAlign: "right", ...S.num }}>{t.landed ? `$${fmt(t.landed)}` : "—"}</div>
                <div style={{ flex: 0.8, textAlign: "center", ...S.num }}>
                  <span style={S.methodTag}>{(t.ship || "ocean") === "air" ? "Air" : "Ocean"}</span>
                </div>
                <div style={{ flex: 1, textAlign: "right", ...S.num }}>{activeFreight(t) ? `$${fmt(activeFreight(t))}` : "—"}</div>
                <div style={{ flex: 1, textAlign: "right", ...S.num, fontWeight: 600, color: "#0f1729" }}>
                  {total ? `$${fmt(total)}` : "—"}
                  {mpu > 0 && <div style={{ fontSize: 10.5, color: "#6a7488", fontWeight: 500 }}>incl. ${fmt(mpu)} mold</div>}
                </div>
                <div style={{ flex: 1, textAlign: "right", ...S.num, fontWeight: 600, color: "#0f1729" }}>{t.client ? `$${fmt(t.client)}` : "—"}</div>
                <div style={{ flex: 0.8, textAlign: "right", ...S.num }}>
                  <span style={{ color: m && m < 25 ? "#c2683a" : "#3f7d5a", fontWeight: 600 }}>{m ? m.toFixed(0) + "%" : "—"}</span>
                </div>
              </div>
            );
          })}
          {(!q.tiers || q.tiers.length === 0) && <div style={{ ...S.tierBodyRow, color: "#6a7488", justifyContent: "center" }}>No tiers entered.</div>}
        </div>
        {(Number(q.moldFee) > 0 || Number(q.sampleFee) > 0) && (
          <div style={S.feeNote}>
            {Number(q.moldFee) > 0 && <span>Mold/tooling fee: <b>${fmt(q.moldFee)}</b> <span style={{ color: "#6a7488" }}>(amortized into total cost per unit)</span></span>}
            {Number(q.sampleFee) > 0 && <span>Sample fee: <b>${fmt(q.sampleFee)}</b> <span style={{ color: "#6a7488" }}>(not included in total cost)</span></span>}
          </div>
        )}
        {q.freightDutyUpdatedAt && (
          <div style={S.fdStamp}><Clock size={11} /> Freight + duty updated {fmtStamp(q.freightDutyUpdatedAt)}{q.freightDutyUpdatedBy ? ` · ${q.freightDutyUpdatedBy}` : ""}</div>
        )}
        <FreightBreakdownView tiers={q.tiers} />
      </div>

      <Section icon={<Building2 size={14} />} title="Client / Vendor Info">
        <F label="Client" value={q.client} /><F label="Contact" value={q.clientContact} />
        <F label="Email" value={q.clientEmail} /><F label="Phone" value={q.clientPhone} />
        <F label="Address" value={q.clientAddress} span />
      </Section>
      <Section icon={<Factory size={14} />} title="Factory / Facility Info">
        <F label="Factory" value={q.factory} /><F label="Contact" value={q.factoryContact} />
        <F label="Email" value={q.factoryEmail} /><F label="Phone" value={q.factoryPhone} />
        <F label="Country" value={q.country} /><F label="Lead Time" value={q.leadTime} />
      </Section>
      <Section icon={<Package size={14} />} title="Carton & Product">
        <F label="HTS Code" value={q.hts} />
        <F label="Units / Carton" value={q.unitsPerCarton} />
        <F label="Dims (L×W×H cm)" value={q.cartonL ? `${q.cartonL} × ${q.cartonW} × ${q.cartonH}` : ""} />
        <F label="Carton Wt (kg)" value={q.cartonWeight} />
        <F label="CBM / Carton" value={isFinite(cbm) && cbm > 0 ? cbm.toFixed(4) : ""} />
      </Section>
      <ContainerPackout q={q} cbmPerCarton={cbm} />
      {q.notes && (
        <div style={{ ...S.detailSection, gridColumn: "1 / -1" }}>
          <div style={S.detailHead}><AlertCircle size={14} /> Notes</div>
          <div style={{ ...S.detailValue, whiteSpace: "pre-wrap" }}>{q.notes}</div>
        </div>
      )}
      <div style={{ ...S.detailSection, gridColumn: "1 / -1" }}>
        <div style={S.detailHead}><ListChecks size={14} /> Tasks</div>
        {tasks.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {tasks.map((t) => (
              <div key={t.id} style={S.taskItem}>
                <button style={S.taskCheck} onClick={() => onToggleTask(t)}>
                  {t.done ? <CheckCircle2 size={17} color="#3f7d5a" /> : <Circle size={17} color="#bba" />}
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, color: t.done ? "#9aa3b5" : "#0f1729", textDecoration: t.done ? "line-through" : "none", fontWeight: 500 }}>{t.task}</div>
                  <div style={S.taskMeta}>For {nameForEmail(t.assigned_to)} · by {nameForEmail(t.assigned_by)} · {fmtStamp(t.created_at)}</div>
                </div>
                <button style={S.tierDel} onClick={() => onDeleteTask(t.id)}><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <div style={S.taskAddRow}>
          <select style={{ ...S.input, flex: "0 0 130px" }} value={taskWho} onChange={(e) => setTaskWho(e.target.value)}>
            {TEAM.map((m) => <option key={m.email} value={m.email}>{m.name}</option>)}
          </select>
          <input style={{ ...S.input, flex: 1 }} value={taskText} onChange={(e) => setTaskText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitTask()} placeholder="e.g. Get freight quotes" />
          <button style={S.primaryBtnSm} onClick={submitTask}>Assign</button>
        </div>
      </div>

      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: isMobile ? "space-between" : "flex-end", marginTop: 4, flexWrap: "wrap", gap: 8 }}>
        {isMobile && (
          <div style={{ display: "flex", gap: 6 }}>
            <button style={S.iconBtn} title="Edit" onClick={onEdit}><Edit3 size={16} /></button>
            <button style={S.iconBtn} title="Duplicate" onClick={onDuplicate}><Copy size={16} /></button>
            <button style={S.iconBtn} title="Delete" onClick={onDelete}><Trash2 size={16} /></button>
          </div>
        )}
        <MarkWonButton q={q} />
        <FreightQuoteButton q={q} cbmPerCarton={cbm} />
        <button style={S.printBtn} onClick={() => printQuote(q)}><Printer size={15} /> Print this quote</button>
      </div>
    </div>
  );
}

// ---------- tasks panel ----------
function TasksPanel({ tasks, userEmail, onToggle, onDelete, onClose, onJump }) {
  const [tab, setTab] = useState("mine");
  const mine = tasks.filter((t) => (t.assigned_to || "").toLowerCase() === userEmail.toLowerCase());
  const shown = (tab === "mine" ? mine : tasks);
  const open = shown.filter((t) => !t.done);
  const done = shown.filter((t) => t.done);
  const Row = ({ t }) => (
    <div style={S.taskItem}>
      <button style={S.taskCheck} onClick={() => onToggle(t)}>
        {t.done ? <CheckCircle2 size={18} color="#3f7d5a" /> : <Circle size={18} color="#bba" />}
      </button>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: t.done ? "#9aa3b5" : "#0f1729", textDecoration: t.done ? "line-through" : "none", fontWeight: 500 }}>{t.task}</div>
        <div style={S.taskMeta}>
          {t.quote_label ? <button style={S.taskJump} onClick={() => onJump(t.quote_id)}>{t.quote_label}</button> : null}
          {" · "}For {nameForEmail(t.assigned_to)} · by {nameForEmail(t.assigned_by)} · {fmtStamp(t.created_at)}
        </div>
      </div>
      <button style={S.tierDel} onClick={() => onDelete(t.id)}><X size={15} /></button>
    </div>
  );
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <h2 style={S.modalTitle}>Tasks</h2>
          <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: "0 26px", display: "flex", gap: 8, borderBottom: "1px solid #e7eaf0" }}>
          <button style={{ ...S.taskTab, ...(tab === "mine" ? S.taskTabOn : {}) }} onClick={() => setTab("mine")}>My Tasks ({mine.filter((t) => !t.done).length})</button>
          <button style={{ ...S.taskTab, ...(tab === "all" ? S.taskTabOn : {}) }} onClick={() => setTab("all")}>All Tasks ({tasks.filter((t) => !t.done).length})</button>
        </div>
        <div style={{ padding: "18px 26px 24px", maxHeight: "60vh", overflowY: "auto" }}>
          {open.length === 0 && done.length === 0 && <div style={{ color: "#6a7488", textAlign: "center", padding: "30px 0" }}>No tasks here.</div>}
          {open.map((t) => <Row key={t.id} t={t} />)}
          {done.length > 0 && <div style={{ ...S.detailHead, marginTop: 18 }}>Completed</div>}
          {done.map((t) => <Row key={t.id} t={t} />)}
        </div>
      </div>
    </div>
  );
}

// ---------- print a single quote ----------
function printQuote(q) {
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const cbm = (Number(q.cartonL) * Number(q.cartonW) * Number(q.cartonH)) / 1000000;
  const tierRows = (q.tiers || []).map((t, idx) => {
    const m = tierMargin(t, t.client, q.moldFee);
    const total = tierTotalCost(t, q.moldFee);
    const af = activeFreight(t);
    const mpu = moldPerUnit(q.moldFee, t.qty);
    return `<tr${idx % 2 ? ' class="alt"' : ''}>
      <td class="qty">${t.qty ? Number(t.qty).toLocaleString() : "—"}</td>
      <td class="r">${t.landed ? "$" + fmt(t.landed) : "—"}</td>
      <td class="c"><span class="method">${(t.ship || "ocean") === "air" ? "Air" : "Ocean"}</span></td>
      <td class="r">${af ? "$" + fmt(af) : "—"}</td>
      <td class="r">${total ? "$" + fmt(total) : "—"}${mpu > 0 ? `<div style="font-size:9px;color:#6a7488;font-weight:500">incl. $${fmt(mpu)} mold</div>` : ""}</td>
      <td class="r price">${t.client ? "$" + fmt(t.client) : "—"}</td>
      <td class="r">${m ? m.toFixed(0) + "%" : "—"}</td>
    </tr>`;
  }).join("");
  const row = (label, val) => val ? `<div class="kv"><span>${esc(label)}</span><b>${esc(val)}</b></div>` : "";
  const feeLine = (Number(q.moldFee) > 0 || Number(q.sampleFee) > 0)
    ? `<div class="fees">${Number(q.moldFee) > 0 ? `<div>Mold / tooling fee: <b>$${fmt(q.moldFee)}</b> <span>(amortized into total cost per unit)</span></div>` : ""}${Number(q.sampleFee) > 0 ? `<div>Sample fee: <b>$${fmt(q.sampleFee)}</b> <span>(not included in total cost)</span></div>` : ""}</div>`
    : "";
  const fdStamp = q.freightDutyUpdatedAt ? `<div class="stamp">Freight &amp; duty last updated ${esc(fmtStamp(q.freightDutyUpdatedAt))}${q.freightDutyUpdatedBy ? " by " + esc(q.freightDutyUpdatedBy) : ""}</div>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>KUI Quote — ${esc(q.sku || q.product || "")}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap');
    @page { margin: 0; size: letter; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Inter', Arial, sans-serif; color: #1f2937; margin: 0; background: #fff; }
    .sheet { padding: 46px 54px 40px; max-width: 850px; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f2937; padding-bottom: 20px; margin-bottom: 26px; }
    .mark { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .logoimg { height: 38px; width: auto; display: block; }
    .brandsub { font-size: 9.5px; letter-spacing: 2.5px; color: #6e7681; text-transform: uppercase; margin-top: 1px; }
    .docmeta { text-align: right; font-size: 11.5px; color: #8b949e; line-height: 1.7; }
    .docmeta b { color: #1f2937; }
    .title { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.015em; }
    .titlesub { font-size: 13px; color: #58a6ff; margin-bottom: 28px; font-weight: 500; }
    .cols { display: flex; gap: 44px; margin-bottom: 30px; }
    .col { flex: 1; }
    h2 { font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; color: #8a6f43; padding-bottom: 7px; margin: 0 0 10px; border-bottom: 1px solid #e7ddca; font-weight: 600; }
    .kv { display: flex; justify-content: space-between; font-size: 12.5px; padding: 4px 0; gap: 16px; }
    .kv span { color: #8b949e; white-space: nowrap; }
    .kv b { color: #1f2937; font-weight: 500; text-align: right; }
    .pricewrap { margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    thead th { text-align: right; background: #1a2238; color: #f4f7fb; font-size: 10px; text-transform: uppercase; letter-spacing: 0.7px; padding: 11px 12px; font-weight: 600; }
    thead th:first-child { text-align: left; border-radius: 6px 0 0 0; }
    thead th:last-child { border-radius: 0 6px 0 0; }
    tbody td { padding: 11px 12px; border-bottom: 1px solid #eee3d0; }
    tbody tr.alt { background: #f7f8fa; }
    td.qty { font-weight: 600; font-family: 'Fraunces', serif; font-size: 14px; }
    td.r { text-align: right; font-variant-numeric: tabular-nums; }
    td.c { text-align: center; }
    td.price { font-weight: 700; color: #1f2937; }
    .method { background: #eef2f8; color: #3d5680; border-radius: 11px; padding: 2px 9px; font-size: 10.5px; font-weight: 600; }
    .stamp { font-size: 10.5px; color: #6e7681; margin-top: 9px; font-style: italic; }
    .fees { margin-top: 12px; font-size: 12px; color: #1f2937; display: flex; flex-direction: column; gap: 4px; }
    .fees b { color: #1a2238; }
    .fees span { color: #8b949e; font-size: 11px; }
    .notes { font-size: 12.5px; color: #1c2230; line-height: 1.6; white-space: pre-wrap; }
    .foot { margin-top: 38px; padding-top: 12px; border-top: 1px solid #e7ddca; font-size: 9.5px; color: #b3a488; display: flex; justify-content: space-between; }
    @media print { .sheet { padding: 32px 40px; } }
  </style></head><body>
    <div class="sheet">
      <div class="head">
        <div class="mark">
          <img src="${KU_LOGO_PRINT}" alt="King Universal" class="logoimg" />
          <div class="brandsub">Product Development &amp; Sourcing</div>
        </div>
        <div class="docmeta">
          <div>Quote Sheet</div>
          ${q.sku ? `<div><b>SKU ${esc(q.sku)}</b></div>` : ""}
          ${q.quoteDate ? `<div>${esc(q.quoteDate)}</div>` : `<div>${esc(new Date().toLocaleDateString())}</div>`}
        </div>
      </div>
      <div class="title">${esc(q.product || "Product Quote")}</div>
      <div class="titlesub">${esc(q.client || "")}</div>
      <div class="cols">
        <div class="col"><h2>Client</h2>
          ${row("Company", q.client)}${row("Contact", q.clientContact)}${row("Email", q.clientEmail)}${row("Phone", q.clientPhone)}${row("Address", q.clientAddress)}
        </div>
        <div class="col"><h2>Manufacturing</h2>
          ${row("Factory", q.factory)}${row("Country", q.country)}${row("Lead Time", q.leadTime)}${row("HTS Code", q.hts)}
        </div>
      </div>
      <div class="pricewrap">
        <h2>Tiered Pricing</h2>
        <table>
          <thead><tr><th>Quantity</th><th>EXW Cost</th><th style="text-align:center">Method</th><th>Freight + Duty</th><th>Total Cost</th><th>Client Price</th><th>Margin</th></tr></thead>
          <tbody>${tierRows || '<tr><td colspan="7" style="text-align:center;color:#6e7681">No pricing tiers entered</td></tr>'}</tbody>
        </table>
        ${feeLine}
        ${fdStamp}
      </div>
      <div class="cols" style="margin-top:28px">
        <div class="col"><h2>Carton &amp; Product</h2>
          ${row("Units / Carton", q.unitsPerCarton)}${row("Carton Dims (cm)", q.cartonL ? `${q.cartonL} × ${q.cartonW} × ${q.cartonH}` : "")}${row("Carton Weight (kg)", q.cartonWeight)}${row("CBM / Carton", isFinite(cbm) && cbm > 0 ? cbm.toFixed(4) : "")}
        </div>
        <div class="col">${q.notes ? `<h2>Notes</h2><div class="notes">${esc(q.notes)}</div>` : "<h2>Notes</h2><div class='notes' style='color:#484f58'>—</div>"}</div>
      </div>
      <div class="foot">
        <span>King Universal Inc. · Confidential — internal quote sheet</span>
        <span>Generated ${esc(new Date().toLocaleDateString())}</span>
      </div>
    </div>
    <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); }</script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

// ---------- client-safe sheet ----------
function printClientSheet(clientName, quotesArr, settings, vendor) {
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const productBlocks = quotesArr.map((q) => {
    const rows = (q.tiers || [])
      .filter((t) => t.qty && t.client)
      .map((t) => `<tr>
        <td class="qty">${Number(t.qty).toLocaleString()}</td>
        <td class="r price">$${fmt(t.client)}</td>
      </tr>`).join("");
    if (!rows) return "";
    return `
      <div class="product">
        <div class="phead">
          <div class="pname">${esc(q.product || "Product")}</div>
          ${q.sku ? `<div class="psku">SKU ${esc(q.sku)}</div>` : ""}
        </div>
        <table>
          <thead><tr><th>Quantity</th><th class="r">Price / Unit</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).filter(Boolean).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Quote — ${esc(clientName)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap');
    @page { margin: 0; size: letter; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Inter', Arial, sans-serif; color: #1f2937; margin: 0; background: #fff; }
    .sheet { padding: 50px 56px 44px; max-width: 800px; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f2937; padding-bottom: 22px; margin-bottom: 30px; }
    .mark { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .logoimg { height: 42px; width: auto; display: block; }
    .brandsub { font-size: 9.5px; letter-spacing: 2.5px; color: #6e7681; text-transform: uppercase; margin-top: 2px; }
    .docmeta { text-align: right; font-size: 12px; color: #8b949e; line-height: 1.7; }
    .docmeta b { color: #1f2937; }
    .title { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 600; margin: 0 0 4px; }
    .titlesub { font-size: 13px; color: #58a6ff; margin-bottom: 34px; font-weight: 500; }
    .product { margin-bottom: 30px; page-break-inside: avoid; }
    .phead { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
    .pname { font-family: 'Fraunces', serif; font-size: 19px; font-weight: 600; }
    .psku { font-size: 12px; color: #6e7681; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    thead th { text-align: right; background: #1a2238; color: #f4f7fb; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.7px; padding: 11px 14px; font-weight: 600; }
    thead th:first-child { text-align: left; border-radius: 6px 0 0 0; }
    thead th:last-child { border-radius: 0 6px 0 0; }
    tbody td { padding: 11px 14px; border-bottom: 1px solid #eee3d0; }
    tbody tr:nth-child(even) { background: #f7f8fa; }
    td.qty { font-weight: 600; font-family: 'Fraunces', serif; font-size: 15px; }
    td.r { text-align: right; font-variant-numeric: tabular-nums; }
    td.price { font-weight: 700; font-size: 14px; color: #1f2937; }
    .foot { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e7ddca; font-size: 10px; color: #b3a488; }
    .terms { font-size: 11px; color: #8b949e; margin-top: 6px; line-height: 1.5; }
  </style></head><body>
    <div class="sheet">
      <div class="head">
        <div class="mark">
          <img src="${KU_LOGO_PRINT}" alt="King Universal" class="logoimg" />
          <div class="brandsub">Product Development &amp; Sourcing</div>
        </div>
        <div class="docmeta">
          <div>Pricing Quote</div>
          <div><b>${esc(new Date().toLocaleDateString())}</b></div>
        </div>
      </div>
      <div class="title">Pricing Quote</div>
      <div class="titlesub">Prepared for ${esc(clientName)}${vendor?` &middot; Vendor #${esc(vendor)}`:''}</div>
      ${productBlocks || '<div style="color:#6e7681">No priced quantities to show.</div>'}
      <div class="foot">
        ${settings?.company_name ? esc(settings.company_name) : 'King Universal Inc.'}
        ${(settings?.contact_name||settings?.email||settings?.phone||settings?.office_phone||settings?.address) ? `<div class="terms">${[settings.contact_name,settings.email,settings.phone,settings.office_phone].filter(Boolean).map(esc).join(' &middot; ')}${settings.address?'<br>'+esc(settings.address).replace(/\n/g,'<br>'):''}</div>` : ''}
        ${settings?.ach_info ? `<div style="margin-top:16px;padding:14px 16px;border:1px solid #e3e3dd;border-radius:8px;background:#faf9f5"><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8a8478;margin-bottom:6px">Payment / Wire Instructions</div><div style="font-size:12.5px;color:#3a3a36;line-height:1.6;white-space:pre-wrap">${esc(settings.ach_info)}</div></div>` : ''}
        <div class="terms">Pricing shown is per unit and quoted in USD. Quantities and pricing are estimates valid for 30 days and subject to final confirmation. Prepared by ${settings?.company_name?esc(settings.company_name):'King Universal Inc.'}.</div>
      </div>
    </div>
  </body></html>`;
  return html;
}

// ---------- Send to Client modal ----------
function SendToClientModal({ clients, onClose }) {
  const [step, setStep] = useState("client");
  const [chosenClient, setChosenClient] = useState(null);
  const [picked, setPicked] = useState({});

  const realClients = clients.filter((c) => c.name !== "Unassigned");
  const clientQuotes = chosenClient ? (clients.find((c) => c.name === chosenClient)?.quotes || []) : [];
  const pickedQuotes = clientQuotes.filter((q) => picked[q.id]);

  const toggle = (id) => setPicked((p) => ({ ...p, [id]: !p[id] }));
  const allOn = clientQuotes.length > 0 && clientQuotes.every((q) => picked[q.id]);
  const toggleAll = () => {
    if (allOn) setPicked({});
    else setPicked(Object.fromEntries(clientQuotes.map((q) => [q.id, true])));
  };

  const generate = async () => {
    const win = window.open("", "_blank");
    if (win) win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Preparing sheet…</body>');
    let settings = null;
    try { const { data } = await SB.from('kui_settings').select('*').eq('id',1).single(); settings = data; } catch(e){}
    let vendor = null;
    try { const { data } = await SB.from('companies').select('vendor_number').eq('type','client').ilike('name',chosenClient||'').limit(1); vendor = (data&&data[0])?data[0].vendor_number:null; } catch(e){}
    const html = printClientSheet(chosenClient, pickedQuotes, settings, vendor);
    if (win) {
      win.document.open(); win.document.write(html); win.document.close();
      setTimeout(()=>{ try{ win.focus(); win.print(); }catch(e){} }, 400);
    } else {
      const url = URL.createObjectURL(new Blob([html],{type:'text/html'}));
      const a = document.createElement('a'); a.href=url; a.download=`quote-${chosenClient||'client'}.html`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),4000);
    }
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <h2 style={S.modalTitle}>{step === "client" ? "Send Quote Sheet" : chosenClient}</h2>
          <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: "20px 26px 24px", maxHeight: "62vh", overflowY: "auto" }}>
          {step === "client" && (
            <>
              <p style={{ fontSize: 13.5, color: "#6a7488", marginTop: 0 }}>Pick a client, then choose which quotes to include. The sheet shows only product, SKU, quantity, and price — no cost or margin.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {realClients.length === 0 && <div style={{ color: "#6a7488" }}>No clients yet.</div>}
                {realClients.map((c) => {
                  const col = clientColor(c.name);
                  return (
                    <button key={c.name} style={S.sendClientRow} onClick={() => { setChosenClient(c.name); setStep("quotes"); }}>
                      <span style={{ ...S.clientAvatar, width: 34, height: 34, fontSize: 13, background: col.avatar, color: col.text }}>{c.name.slice(0, 2).toUpperCase()}</span>
                      <span style={{ flex: 1, fontWeight: 600, color: "#0f1729" }}>{c.name}</span>
                      <span style={{ fontSize: 12.5, color: "#6a7488" }}>{c.quotes.length} {c.quotes.length === 1 ? "quote" : "quotes"}</span>
                      <ChevronRight size={16} color="#9aa3b5" />
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {step === "quotes" && (
            <>
              <button style={{ ...S.crumbBtn, marginBottom: 12 }} onClick={() => { setStep("client"); setPicked({}); }}>
                <ChevronLeft size={15} /> Back to clients
              </button>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, color: "#6a7488" }}>Select quotes to include</span>
                <button style={S.taskJump} onClick={toggleAll}>{allOn ? "Clear all" : "Select all"}</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {clientQuotes.map((q) => {
                  const priced = (q.tiers || []).some((t) => t.qty && t.client);
                  return (
                    <button key={q.id} style={{ ...S.sendQuoteRow, opacity: priced ? 1 : 0.5 }} onClick={() => priced && toggle(q.id)} disabled={!priced}>
                      {picked[q.id] ? <CheckCircle2 size={18} color="#3f7d5a" /> : <Circle size={18} color="#bba" />}
                      <span style={{ flex: 1, textAlign: "left" }}>
                        <span style={{ fontWeight: 600, color: "#0f1729" }}>{q.sku || "No SKU"}</span>
                        {q.product ? <span style={{ color: "#6a7488", fontSize: 12.5 }}> · {q.product}</span> : null}
                        {!priced && <span style={{ color: "#c2683a", fontSize: 11.5, display: "block" }}>No priced tiers — can't include</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {step === "quotes" && (
          <div style={S.modalFoot}>
            <button style={S.ghostBtn} onClick={onClose}>Cancel</button>
            <button style={{ ...S.primaryBtn, opacity: pickedQuotes.length ? 1 : 0.5 }} disabled={!pickedQuotes.length} onClick={generate}>
              <Printer size={16} /> Generate Sheet ({pickedQuotes.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Directory ----------
function DirectoryPanel({ onClose, contacts, factories, clientRecords, quoteClients, onUpdateContact, onDeleteContact, onAddContact, onUpdateFactory, onDeleteFactory, onAddFactory, onSaveClientInfo }) {
  const [tab, setTab] = useState("clients");
  const [openClient, setOpenClient] = useState(null);

  const clientNames = Array.from(new Set([
    ...quoteClients,
    ...contacts.map((c) => c.client).filter(Boolean),
    ...clientRecords.map((c) => c.name).filter(Boolean),
  ])).sort((a, b) => a.localeCompare(b));

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <h2 style={S.modalTitle}>{openClient ? openClient : "Directory"}</h2>
          <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
        </div>
        {!openClient && (
          <div style={{ padding: "0 26px", display: "flex", gap: 8, borderBottom: "1px solid #e7eaf0" }}>
            <button style={{ ...S.taskTab, ...(tab === "clients" ? S.taskTabOn : {}) }} onClick={() => setTab("clients")}>Clients ({clientNames.length})</button>
            <button style={{ ...S.taskTab, ...(tab === "factories" ? S.taskTabOn : {}) }} onClick={() => setTab("factories")}>Factories ({factories.length})</button>
          </div>
        )}
        <div style={{ padding: "18px 26px 24px", maxHeight: "64vh", overflowY: "auto" }}>
          {!openClient && tab === "clients" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {clientNames.length === 0 && <div style={{ color: "#6a7488", textAlign: "center", padding: "26px 0" }}>No clients yet.</div>}
              {clientNames.map((name) => {
                const col = clientColor(name);
                const buyers = contacts.filter((c) => (c.client || "").toLowerCase() === name.toLowerCase());
                return (
                  <button key={name} style={S.sendClientRow} onClick={() => setOpenClient(name)}>
                    <span style={{ ...S.clientAvatar, width: 34, height: 34, fontSize: 13, background: col.avatar, color: col.text }}>{name.slice(0, 2).toUpperCase()}</span>
                    <span style={{ flex: 1, fontWeight: 600, color: "#0f1729", textAlign: "left" }}>{name}</span>
                    <span style={{ fontSize: 12.5, color: "#6a7488" }}>{buyers.length} {buyers.length === 1 ? "buyer" : "buyers"}</span>
                    <ChevronRight size={16} color="#9aa3b5" />
                  </button>
                );
              })}
            </div>
          )}
          {openClient && (
            <ClientDetail
              name={openClient}
              record={clientRecords.find((c) => (c.name || "").toLowerCase() === openClient.toLowerCase())}
              buyers={contacts.filter((c) => (c.client || "").toLowerCase() === openClient.toLowerCase())}
              onBack={() => setOpenClient(null)}
              onSaveClientInfo={onSaveClientInfo}
              onUpdateContact={onUpdateContact} onDeleteContact={onDeleteContact} onAddContact={onAddContact}
            />
          )}
          {!openClient && tab === "factories" && (
            <FactoryList factories={factories} onUpdate={onUpdateFactory} onDelete={onDeleteFactory} onAdd={onAddFactory} />
          )}
        </div>
      </div>
    </div>
  );
}

function ClientDetail({ name, record, buyers, onBack, onSaveClientInfo, onUpdateContact, onDeleteContact, onAddContact }) {
  const [address, setAddress] = useState(record?.address || "");
  const [notes, setNotes] = useState(record?.notes || "");
  const [editingBuyer, setEditingBuyer] = useState(null);
  const [draft, setDraft] = useState({});
  const [adding, setAdding] = useState(false);
  const [newBuyer, setNewBuyer] = useState({ contact: "", email: "", phone: "" });

  const startEdit = (b) => { setEditingBuyer(b.id); setDraft({ contact: b.contact || "", email: b.email || "", phone: b.phone || "" }); };
  const saveEdit = async (id) => { const ok = await onUpdateContact(id, draft); if (ok) setEditingBuyer(null); };
  const addBuyer = async () => {
    if (!newBuyer.contact && !newBuyer.email) return;
    const ok = await onAddContact({ client: name, ...newBuyer });
    if (ok) { setNewBuyer({ contact: "", email: "", phone: "" }); setAdding(false); }
  };

  return (
    <>
      <button style={{ ...S.crumbBtn, marginBottom: 14 }} onClick={onBack}><ChevronLeft size={15} /> All clients</button>
      <div style={S.dirSection}>
        <div style={S.detailHead}><Building2 size={14} /> Company Info</div>
        <label style={S.field}><span style={S.fieldLabel}>Address</span>
          <input style={S.input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Company address" />
        </label>
        <label style={{ ...S.field, marginTop: 8 }}><span style={S.fieldLabel}>Account Notes</span>
          <textarea style={{ ...S.input, minHeight: 60, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes about this client" />
        </label>
        <button style={{ ...S.primaryBtnSm, marginTop: 10 }} onClick={() => onSaveClientInfo(name, { address, notes })}>Save company info</button>
      </div>
      <div style={{ ...S.dirSection, marginTop: 16 }}>
        <div style={S.detailHead}><Users size={14} /> Buyers</div>
        {buyers.length === 0 && <div style={{ color: "#6a7488", fontSize: 13, padding: "6px 0 10px" }}>No saved buyers for this client yet.</div>}
        {buyers.map((b) => (
          <div key={b.id} style={S.dirBuyerRow}>
            {editingBuyer === b.id ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <input style={S.input} value={draft.contact} onChange={(e) => setDraft({ ...draft, contact: e.target.value })} placeholder="Contact name" />
                <input style={S.input} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="Email" />
                <input style={S.input} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="Phone" />
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={S.primaryBtnSm} onClick={() => saveEdit(b.id)}>Save</button>
                  <button style={S.ghostBtnSm} onClick={() => setEditingBuyer(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: "#0f1729", fontSize: 14 }}>{b.contact || "—"}</div>
                  <div style={{ fontSize: 12.5, color: "#6a7488" }}>{b.email || "no email"}{b.phone ? " · " + b.phone : ""}</div>
                </div>
                <button style={S.iconBtn} title="Edit" onClick={() => startEdit(b)}><Edit3 size={15} /></button>
                <button style={S.iconBtn} title="Delete" onClick={() => { if (confirm("Delete this buyer?")) onDeleteContact(b.id); }}><Trash2 size={15} /></button>
              </>
            )}
          </div>
        ))}
        {adding ? (
          <div style={{ ...S.dirBuyerRow, flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <input style={S.input} value={newBuyer.contact} onChange={(e) => setNewBuyer({ ...newBuyer, contact: e.target.value })} placeholder="Contact name" />
            <input style={S.input} value={newBuyer.email} onChange={(e) => setNewBuyer({ ...newBuyer, email: e.target.value })} placeholder="Email" />
            <input style={S.input} value={newBuyer.phone} onChange={(e) => setNewBuyer({ ...newBuyer, phone: e.target.value })} placeholder="Phone" />
            <div style={{ display: "flex", gap: 6 }}>
              <button style={S.primaryBtnSm} onClick={addBuyer}>Add buyer</button>
              <button style={S.ghostBtnSm} onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button style={{ ...S.ghostBtnSm, marginTop: 8 }} onClick={() => setAdding(true)}><Plus size={14} /> Add buyer</button>
        )}
      </div>
    </>
  );
}

function FactoryList({ factories, onUpdate, onDelete, onAdd }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ name: "", factory: "", factory_contact: "", factory_email: "", factory_phone: "", country: "", lead_time: "" });

  const startEdit = (f) => { setEditingId(f.id); setDraft({ name: f.name || "", factory: f.factory || "", factory_contact: f.factory_contact || "", factory_email: f.factory_email || "", factory_phone: f.factory_phone || "", country: f.country || "", lead_time: f.lead_time || "" }); };
  const saveEdit = async (id) => { const ok = await onUpdate(id, draft); if (ok) setEditingId(null); };
  const addF = async () => { if (!nf.factory && !nf.name) return; const ok = await onAdd(nf); if (ok) { setNf({ name: "", factory: "", factory_contact: "", factory_email: "", factory_phone: "", country: "", lead_time: "" }); setAdding(false); } };

  const fields = [["name", "Preset label"], ["factory", "Factory name"], ["factory_contact", "Contact"], ["factory_email", "Email"], ["factory_phone", "Phone"], ["country", "Country"], ["lead_time", "Lead time"]];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {factories.length === 0 && <div style={{ color: "#6a7488", textAlign: "center", padding: "26px 0" }}>No saved factories yet.</div>}
      {factories.map((f) => (
        <div key={f.id} style={S.dirBuyerRow}>
          {editingId === f.id ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              {fields.map(([k, label]) => (
                <input key={k} style={S.input} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} placeholder={label} />
              ))}
              <div style={{ display: "flex", gap: 6 }}>
                <button style={S.primaryBtnSm} onClick={() => saveEdit(f.id)}>Save</button>
                <button style={S.ghostBtnSm} onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: "#0f1729", fontSize: 14 }}>{f.factory || f.name || "—"}</div>
                <div style={{ fontSize: 12.5, color: "#6a7488" }}>{[f.factory_contact, f.country, f.lead_time].filter(Boolean).join(" · ") || "no details"}</div>
              </div>
              <button style={S.iconBtn} title="Edit" onClick={() => startEdit(f)}><Edit3 size={15} /></button>
              <button style={S.iconBtn} title="Delete" onClick={() => { if (confirm("Delete this factory?")) onDelete(f.id); }}><Trash2 size={15} /></button>
            </>
          )}
        </div>
      ))}
      {adding ? (
        <div style={{ ...S.dirBuyerRow, flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          {fields.map(([k, label]) => (
            <input key={k} style={S.input} value={nf[k]} onChange={(e) => setNf({ ...nf, [k]: e.target.value })} placeholder={label} />
          ))}
          <div style={{ display: "flex", gap: 6 }}>
            <button style={S.primaryBtnSm} onClick={addF}>Add factory</button>
            <button style={S.ghostBtnSm} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button style={{ ...S.ghostBtnSm, marginTop: 4 }} onClick={() => setAdding(true)}><Plus size={14} /> Add factory</button>
      )}
    </div>
  );
}

// The HTS field. A closed combobox over vessl.htscodes: typing filters, but only
// choosing a row commits, so a code that is not in the library cannot be entered
// by typing. "+ Add code" opens CodeModal inline and selects the result, so a
// missing code never sends anyone out of the quote form to add it.
//
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ STRUCTURAL RULE — do not break this.                                        │
// │                                                                             │
// │ The control renders f.hts DIRECTLY. Nothing derives its displayed value     │
// │ from `codes`.                                                               │
// │                                                                             │
// │ 20 of the 30 quotes carrying an HTS hold a code that is not in the library. │
// │ A <select value={f.hts}> with no matching <option> renders BLANK, and       │
// │ saving from there writes the blank over a real customs classification. So   │
// │ would codes.find(c => c.code === f.hts)?.code. Either reintroduces silent   │
// │ data loss on those 20 quotes. The list is for choosing, never for display.  │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Its own component rather than a change to Field, which fifteen other inputs
// share. Explicit commit rather than revert-on-blur: silently discarding what
// someone typed is its own surprise.
function HtsField({ f, codes, onPick, onAdd }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const q = normalizeTerm(typed);
  const hits = useMemo(
    () => (!q ? codes : codes.filter((c) => matches(q, c.code, c.description))).slice(0, 60),
    [codes, q]
  );
  // Display only. Never feeds the value -- see the rule above.
  const known = codes.find((c) => c.code === (f.hts || ""));
  const unlisted = !!f.hts && !known;
  const commit = (code) => { onPick(code); setTyped(""); setOpen(false); };

  return (
    <label style={{ ...S.field, position: "relative" }}>
      <span style={S.fieldLabel}>HTS Code</span>

      {/* The committed value, rendered straight from f.hts whether or not the
          library knows it. Clicking opens the picker; it never rewrites itself. */}
      <div onClick={() => setOpen((v) => !v)}
        style={{ ...S.input, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", minHeight: 40 }}>
        <span style={{ flex: 1, minWidth: 0, color: f.hts ? "#0f1729" : "#9aa3b5", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {f.hts ? f.hts : "Select a tariff code"}
          {known?.description && <span style={{ color: "#6a7488" }}> · {known.description}</span>}
        </span>
        {f.hts && <button type="button" title="Clear" onClick={(e) => { e.stopPropagation(); commit(""); }} style={S.clearBtn}><X size={13} /></button>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9aa3b5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="6 9 12 15 18 9" /></svg>
      </div>

      {/* Not an error: the code is real and stays exactly as stored. It is a
          prompt to add it to the library, which "+ Add code" does in place. */}
      {unlisted && <span style={{ fontSize: 11.5, color: "#c2683a", marginTop: 4 }}>Not in the code library — still saved as is.</span>}

      {open && (
        <div style={S.htsPanel}>
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setTyped(""); } if (e.key === "Enter") { e.preventDefault(); if (hits.length === 1) commit(hits[0].code); } }}
            placeholder="Filter by code or description…" style={{ ...S.input, marginBottom: 6 }} />
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {hits.length === 0 && <div style={{ padding: "10px 8px", fontSize: 13, color: "#6a7488" }}>No codes match “{typed.trim()}”.</div>}
            {hits.map((c) => (
              <button key={c.id || c.code} type="button" onClick={() => commit(c.code)} style={S.htsOption}>
                <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{c.code}</span>
                <span style={{ color: "#6a7488", marginLeft: 8 }}>{c.description}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setOpen(false); onAdd(typed.replace(/\D/g, "")); }} style={S.htsAddBtn}>
            <Plus size={13} /> Add code{q ? " “" + typed.trim() + "”" : ""}
          </button>
        </div>
      )}
    </label>
  );
}

function Field({ label, k, type = "text", placeholder = "", suffix, f, set }) {
  return (
    <label style={S.field}>
      <span style={S.fieldLabel}>{label}</span>
      <div style={{ position: "relative" }}>
        <input style={S.input} type={type} value={f[k] ?? ""} onChange={set(k)} placeholder={placeholder} />
        {suffix && <span style={S.inputSuffix}>{suffix}</span>}
      </div>
    </label>
  );
}

// Field renders an <input>; this is its <select> sibling, sharing the same label
// wrapper so the two sit together on a FormSection grid.
function SelectField({ label, k, placeholder, options, hint, f, set }) {
  return (
    <label style={S.field}>
      <span style={S.fieldLabel}>{label}</span>
      <select style={S.select} value={f[k] ?? ""} onChange={set(k)}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span style={S.fieldWarn}>{hint}</span>}
    </label>
  );
}

function QuoteForm({ initial, onClose, onSave, factories = [], clientNames = [], contacts = [], onSaveFactory, onSaveContact, userEmail }) {
  const [f, setF] = useState(() => ({ ...initial, tiers: (initial.tiers && initial.tiers.length ? initial.tiers.map((t) => ({ ...t })) : [{ qty: "", landed: "", ship: "ocean", freightAir: "", freightOcean: "", client: "" }]) }));
  const [fbTier, setFbTier] = useState(null); // index of tier whose freight builder is open
  const [showClientSug, setShowClientSug] = useState(false);
  const [savingFactory, setSavingFactory] = useState(false);
  const [factoryPresetName, setFactoryPresetName] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const set = (k) => (e) => {
    const v = e && e.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e;
    setF((p) => ({ ...p, [k]: v }));
  };
  // Warn only -- the user may be part-way through stripping the suffix off the SKU.
  const sizeClash = !!f.sizeScale && skuLooksSized(f.sku);

  // Deltas and per-tier quantities are both keyed by size, so a scale change must drop
  // any with no home in the new scale — the same rule SizeGrid.changeScale applies to
  // quantities. Clearing the scale clears them all. SelectField calls set(k) for its
  // onChange, so this is handed in as a set-shaped function for that one field.
  const setSizeScale = (e) => {
    const key = (e && e.target ? e.target.value : e) || "";
    setF((p) => {
      const nextSizes = key ? sizesForScale(key) : [];
      const keep = (m) => {
        const kept = {};
        Object.keys(m || {}).forEach((s) => { if (nextSizes.includes(s)) kept[s] = m[s]; });
        return kept;
      };
      return { ...p, sizeScale: key, sizeDeltas: keep(p.sizeDeltas), tiers: p.tiers.map((t) => ({ ...t, sizeQty: keep(t.sizeQty) })) };
    });
  };
  // Deltas can be negative, so SizeGrid's digit-only strip is wrong here. Keep one
  // leading '-' and one '.', reject everything else. Blank means zero.
  const setSizeDelta = (size, raw) => {
    let s = String(raw).replace(/[^0-9.-]/g, "");
    const neg = s.startsWith("-");
    s = s.replace(/-/g, "");
    const dot = s.indexOf(".");
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
    if (neg) s = "-" + s;
    setF((p) => ({ ...p, sizeDeltas: { ...(p.sizeDeltas || {}), [size]: s } }));
  };
  // Quantities are whole units, so here SizeGrid's digit-only strip is exactly right —
  // type="number" would still admit 'e' and '-'. Blank means none. Unlike the deltas,
  // which are one set per quote, these belong to a single tier.
  const setSizeQty = (i, size, raw) => {
    const digits = String(raw).replace(/[^0-9]/g, "");
    setF((p) => ({ ...p, tiers: p.tiers.map((t, idx) => idx === i ? { ...t, sizeQty: { ...(t.sizeQty || {}), [size]: digits } } : t) }));
  };

  const clientMatches = (() => {
    const typed = (f.client || "").trim().toLowerCase();
    if (!typed) return [];
    const fromContacts = contacts
      .filter((c) => (c.client || "").toLowerCase().includes(typed))
      .map((c) => ({ type: "contact", client: c.client, contact: c.contact || "", email: c.email || "", phone: c.phone || "" }));
    const contactClients = new Set(contacts.map((c) => (c.client || "").toLowerCase()));
    const fromNames = clientNames
      .filter((n) => n.toLowerCase().includes(typed) && !contactClients.has(n.toLowerCase()))
      .map((n) => ({ type: "name", client: n }));
    return [...fromContacts, ...fromNames].slice(0, 8);
  })();

  const pickClient = (match) => {
    setF((p) => {
      if (match.type === "contact") {
        return { ...p, client: match.client, clientContact: match.contact || p.clientContact, clientEmail: match.email || p.clientEmail, clientPhone: match.phone || p.clientPhone };
      }
      return { ...p, client: match.client };
    });
    setShowClientSug(false);
  };

  const doSaveContact = async () => {
    if (!f.client) return;
    const ok = await onSaveContact({
      client: f.client, contact: f.clientContact || null,
      email: f.clientEmail || null, phone: f.clientPhone || null,
      created_by: userEmail || null,
    });
    if (ok) setSavingContact(false);
  };

  const applyFactory = (preset) => {
    setF((p) => ({
      ...p,
      factory: preset.factory || "", factoryContact: preset.factory_contact || "",
      factoryEmail: preset.factory_email || "", factoryPhone: preset.factory_phone || "",
      country: preset.country || "", leadTime: preset.lead_time || "",
    }));
  };
  const doSaveFactory = async () => {
    const name = factoryPresetName.trim() || f.factory.trim();
    if (!name) return;
    const ok = await onSaveFactory({
      name,
      factory: f.factory || null, factory_contact: f.factoryContact || null,
      factory_email: f.factoryEmail || null, factory_phone: f.factoryPhone || null,
      country: f.country || null, lead_time: f.leadTime || null,
      created_by: userEmail || null,
    });
    if (ok) { setSavingFactory(false); setFactoryPresetName(""); }
  };

  const setTier = (i, key, val) => {
    setF((p) => {
      const tiers = p.tiers.map((t, idx) => idx === i ? { ...t, [key]: val } : t);
      return { ...p, tiers };
    });
  };
  // Read-only, and only the active codes: a retired one should not be offered for a
  // new quote, though a quote already carrying one still displays it, since the
  // datalist never constrains what the field holds.
  const [htsCodes, setHtsCodes] = useState([]);
  useEffect(() => {
    let alive = true;
    SBQ.from("htscodes").select("code,description").eq("active", true).order("code")
      .then(({ data, error }) => { if (alive && !error && data) setHtsCodes(data); });
    return () => { alive = false; };
  }, []);
  // The only writer of f.hts. Values arrive already normalised -- either from a
  // library row, or from CodeModal, which strips as you type. formToRow is
  // untouched and still writes hts: f.hts || null.
  const pickHts = (code) => setF((p) => ({ ...p, hts: code || "" }));
  // "+ Add code" from inside the picker. The seeded value is whatever was typed
  // into the filter, so a code someone was hunting for is pre-filled.
  const [addingCode, setAddingCode] = useState(null);
  const onCodeAdded = (row) => {
    setAddingCode(null);
    if (!row) return;
    setHtsCodes((prev) => [...prev, row].sort((a, b) => a.code.localeCompare(b.code)));
    pickHts(row.code);   // select it straight away -- never leaves the quote form
  };
  const autoFillClient = (i) => {
    setF((p) => {
      const tiers = p.tiers.map((t, idx) => {
        if (idx !== i) return t;
        return { ...t, client: suggestClientPriceForTier(t, p.moldFee) };
      });
      return { ...p, tiers };
    });
  };
  const addTier = (qty = "") => setF((p) => ({ ...p, tiers: [...p.tiers, { qty, landed: "", ship: "ocean", freightAir: "", freightOcean: "", client: "" }] }));
  const addPresets = () => setF((p) => {
    const have = new Set(p.tiers.map((t) => Number(t.qty)));
    const additions = PRESET_QTYS.filter((q) => !have.has(q)).map((q) => ({ qty: q, landed: "", ship: "ocean", freightAir: "", freightOcean: "", client: "" }));
    return { ...p, tiers: [...p.tiers, ...additions] };
  });
  const removeTier = (i) => setF((p) => ({ ...p, tiers: p.tiers.filter((_, idx) => idx !== i) }));

  const handleSave = () => {
    const out = { ...f };
    out.freightDutyUpdatedAt = stamp();
    onSave(out);
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      {/* Rendered inside the quote form, above it, and stopping its own clicks:
          adding a code must never unmount the draft underneath. */}
      {addingCode && (
        <div onClick={(e) => e.stopPropagation()}>
          <CodeModal data={addingCode} onClose={() => setAddingCode(null)} onSaved={onCodeAdded} />
        </div>
      )}
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <h2 style={S.modalTitle}>{initial.id ? "Edit Quote" : "New Quote"}</h2>
          <button style={S.iconBtn} onClick={onClose}><X size={18} /></button>
        </div>
        <div style={S.modalBody}>
          <FormSection icon={<Box size={15} />} title="Product">
            <Field label="SKU" k="sku" placeholder="Internal SKU" f={f} set={set} />
            <SelectField label="Size Scale" k="sizeScale" placeholder="— no sizes —"
              options={SIZE_SCALES.map((s) => ({ value: s.key, label: s.label }))}
              hint={sizeClash ? "SKU already ends in a size — with a scale set too, order lines would double it (…-Large-S)." : null}
              f={f} set={() => setSizeScale} />
            {/* Spans the whole form row: S.formGrid is auto-fit minmax(150px,1fr),
                which otherwise crushes six size inputs into one narrow column. */}
            {f.sizeScale && (
              <label style={{ ...S.field, gridColumn: "1 / -1" }}>
                <span style={S.fieldLabel}>Per-size price adjustment</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {sizesForScale(f.sizeScale).map((s) => (
                    // a div, not a label: the caption sits above its own input already
                    <div key={s} style={{ display: "flex", flexDirection: "column", gap: 3, width: 74 }}>
                      <span style={{ fontSize: 11, color: "#6a7488", fontWeight: 600, textAlign: "center" }}>{s}</span>
                      <input
                        style={{ ...S.tierInput, textAlign: "right" }}
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label={"Price adjustment for size " + s}
                        value={(f.sizeDeltas || {})[s] ?? ""}
                        onChange={(e) => setSizeDelta(s, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
                <span style={S.tierHint}>+/- on the client price, applied across every tier. Blank is no adjustment. Negative lowers the price for that size.</span>
              </label>
            )}
            <Field label="Product" k="product" placeholder="e.g. Needlepoint Belt" f={f} set={set} />
            <HtsField f={f} codes={htsCodes} onPick={pickHts} onAdd={(seed) => setAddingCode({ code: seed || "" })} />
            <Field label="Quote Date" k="quoteDate" type="date" f={f} set={set} />
          </FormSection>

          <FormSection icon={<Building2 size={15} />} title="Client / Vendor Info">
            <label style={{ ...S.field, position: "relative" }}>
              <span style={S.fieldLabel}>Client</span>
              <input
                style={S.input}
                value={f.client ?? ""}
                onChange={(e) => { set("client")(e); setShowClientSug(true); }}
                onFocus={() => setShowClientSug(true)}
                onBlur={() => setTimeout(() => setShowClientSug(false), 150)}
                placeholder="e.g. Stitch Golf"
                autoComplete="off"
              />
              {showClientSug && clientMatches.length > 0 && (
                <div style={S.sugBox}>
                  <div style={S.sugHint}>Pick a saved buyer (auto-fills contact) or existing client</div>
                  {clientMatches.map((mm, idx) => (
                    <button key={idx} type="button" style={S.sugItem} onMouseDown={(e) => { e.preventDefault(); pickClient(mm); }}>
                      <span style={{ ...S.sugDot, background: clientColor(mm.client).accent }} />
                      <span style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600 }}>{mm.client}</span>
                        {mm.type === "contact" && mm.contact ? <span style={S.sugBuyer}> — {mm.contact}{mm.email ? ` · ${mm.email}` : ""}</span> : null}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </label>
            <Field label="Contact" k="clientContact" placeholder="Buyer name" f={f} set={set} />
            <Field label="Email" k="clientEmail" placeholder="email@client.com" f={f} set={set} />
            <Field label="Phone" k="clientPhone" placeholder="Phone" f={f} set={set} />
            <Field label="Address" k="clientAddress" placeholder="Address" f={f} set={set} />
            <div style={{ gridColumn: "1 / -1" }}>
              <button type="button" style={S.saveFactoryBtn} disabled={!f.client || !f.clientContact} onClick={doSaveContact}>
                + Save this buyer contact to the team library
              </button>
            </div>
          </FormSection>

          <FormSection icon={<Factory size={15} />} title="Factory / Facility Info">
            <div style={{ gridColumn: "1 / -1" }}>
              {factories.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <div style={S.presetLabel}>Saved factories — tap to auto-fill</div>
                  <div style={S.presetPills}>
                    {factories.map((p) => (
                      <button key={p.id} type="button" style={S.factoryPill} onClick={() => applyFactory(p)}>
                        <Factory size={12} /> {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Field label="Factory" k="factory" placeholder="Factory / facility name" f={f} set={set} />
            <Field label="Contact" k="factoryContact" placeholder="Name" f={f} set={set} />
            <Field label="Email" k="factoryEmail" placeholder="email@factory.com" f={f} set={set} />
            <Field label="Phone" k="factoryPhone" placeholder="Phone" f={f} set={set} />
            <Field label="Country" k="country" placeholder="e.g. China" f={f} set={set} />
            <Field label="Lead Time" k="leadTime" placeholder="e.g. 45 days" f={f} set={set} />
            <div style={{ gridColumn: "1 / -1" }}>
              {!savingFactory ? (
                <button type="button" style={S.saveFactoryBtn} disabled={!f.factory} onClick={() => { setFactoryPresetName(f.factory || ""); setSavingFactory(true); }}>
                  + Save this factory to the team library
                </button>
              ) : (
                <div style={S.saveFactoryRow}>
                  <input style={{ ...S.input, flex: 1 }} value={factoryPresetName} onChange={(e) => setFactoryPresetName(e.target.value)} placeholder="Name this preset (e.g. Emily's Factory)" />
                  <button type="button" style={S.primaryBtnSm} onClick={doSaveFactory}>Save</button>
                  <button type="button" style={S.ghostBtnSm} onClick={() => setSavingFactory(false)}>Cancel</button>
                </div>
              )}
            </div>
          </FormSection>

          <FormSection icon={<Package size={15} />} title="Carton Info">
            <Field label="Units / Carton" k="unitsPerCarton" type="number" f={f} set={set} />
            <Field label="Carton L (cm)" k="cartonL" type="number" f={f} set={set} />
            <Field label="Carton W (cm)" k="cartonW" type="number" f={f} set={set} />
            <Field label="Carton H (cm)" k="cartonH" type="number" f={f} set={set} />
            <Field label="Carton Weight (kg)" k="cartonWeight" type="number" f={f} set={set} />
          </FormSection>

          <div style={S.formSection}>
            <div style={S.formSectionHead}><Layers size={15} /> Tiered Pricing — Cost & Client Quote</div>
            <label style={{ ...S.field, marginBottom: 12, maxWidth: 320 }}>
              <span style={S.fieldLabel}>Sample Fee <span style={{ color: "#6a7488", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(not included in total cost)</span></span>
              <div style={{ position: "relative" }}>
                <input style={S.input} type="number" value={f.sampleFee ?? ""} onChange={set("sampleFee")} placeholder="$ sample cost — tracked only" />
              </div>
            </label>
            <div style={S.tierScroll}>
            <div style={{ ...S.tierEditTable, minWidth: 860 }}>
              <div style={S.tierEditHead}>
                {/* One freight column for both methods — it cannot name a method,
                    because it sits above every tier and each tier has its own ship.
                    The freed width goes to the three cells that gained content:
                    Quantity, Client Price and Margin. Child rows mirror these. */}
                <div style={{ flex: 1.0 }}>Quantity</div>
                <div style={{ flex: 1.0 }}>EXW Cost</div>
                <div style={{ flex: 1.0 }}>Method</div>
                <div style={{ flex: 1.5 }}>Frt+Duty</div>
                <div style={{ flex: 1.1, textAlign: "right" }}>Total Cost</div>
                <div style={{ flex: 1.3 }}>Client Price</div>
                <div style={{ flex: 0.8, textAlign: "right" }}>Margin</div>
                <div style={{ width: 30 }} />
              </div>
              {f.tiers.map((t, i) => {
                const m = tierMargin(t, t.client, f.moldFee);
                // null unless per-size deltas actually widen this tier, in which case
                // the cell falls through to exactly the single value it shows today.
                const mr = marginRangeFor(t, f.moldFee, f.sizeDeltas, f.sizeScale);
                // One row per size. Price and margin are display only — deltas are
                // stored once per quote and apply to every tier, so editing one here
                // would silently move the others; that stays in the Product section.
                // The quantity box is the exception: it belongs to this tier alone.
                const sizeRows = sizeRowsFor(t, f.moldFee, f.sizeDeltas, f.sizeScale);
                const sizeTotal = sizeQtyTotal(t, f.sizeScale);
                // With a mix entered the tier has one real margin rather than a band,
                // so the blended price supersedes the delta range in the Margin cell.
                const mix = sizeMixFor(t, f.sizeDeltas, f.sizeScale);
                const mixMargin = mix ? tierMargin(t, mix.blended, f.moldFee) : null;
                // Decides only whether a size row shows what it was adjusted BY, not
                // whether it has a price — with no base the delta is the price itself.
                const hasBase = Number(t.client) > 0;
                const ship = t.ship || "ocean";
                const total = tierTotalCost(t, f.moldFee);
                // One input, two homes. Switching Method swaps which key it reads and
                // writes; the other mode's figure is left in place, so flipping Air to
                // Ocean hides the air number rather than destroying it, and flipping
                // back brings it straight into view again.
                const freightKey = ship === "air" ? "freightAir" : "freightOcean";
                return (
                  <React.Fragment key={i}>
                  <div style={S.tierEditRow}>
                    <div style={{ flex: 1.0 }}>{sizeTotal == null
                      ? <input style={S.tierInput} type="number" value={t.qty ?? ""} onChange={(e) => setTier(i, "qty", e.target.value)} placeholder="Qty" />
                      : <div style={S.qtyFromSizes} title="Quantity comes from the size rows below"><span style={S.qfsV}>{sizeTotal.toLocaleString()}</span><span style={S.qfsK}>from sizes</span></div>}</div>
                    <div style={{ flex: 1.0 }}><input style={S.tierInput} type="number" value={t.landed ?? ""} onChange={(e) => setTier(i, "landed", e.target.value)} placeholder="$ EXW" /></div>
                    <div style={{ flex: 1.0, display: "flex", gap: 3, alignItems: "center" }}>
                      <button type="button" style={{ ...S.shipToggle, ...(ship === "air" ? S.shipOn : {}) }} onClick={() => setTier(i, "ship", "air")}>Air</button>
                      <button type="button" style={{ ...S.shipToggle, ...(ship === "ocean" ? S.shipOn : {}) }} onClick={() => setTier(i, "ship", "ocean")}>Ocean</button>
                    </div>
                    <div style={{ flex: 1.5, display: "flex", gap: 3 }}>
                      <input style={S.tierInput} type="number" value={t[freightKey] ?? ""} onChange={(e) => setTier(i, freightKey, e.target.value)} placeholder={ship === "air" ? "$ air" : "$ ocean"} />
                      <button type="button" onClick={() => setFbTier(i)} title="Build the freight & duty number from its cost legs — containers, warehousing, trucking, duty" style={{ flexShrink: 0, padding: "0 8px", borderRadius: 6, border: "none", fontSize: 10, fontWeight: 700, letterSpacing: ".02em", cursor: "pointer", background: (t.fb && t.fb.length) ? "#2f6df6" : "#e7edfd", color: (t.fb && t.fb.length) ? "#fff" : "#3551c4", whiteSpace: "nowrap" }}>build</button>
                    </div>
                    <div style={{ flex: 1.1, textAlign: "right", alignSelf: "center", ...S.num, fontWeight: 600, color: "#0f1729" }}>{total ? `$${fmt(total)}` : "—"}</div>
                    {/* Column, not a row: the mix line sits under both the input and the
                        auto button. The base price stays typed — the per-size prices are
                        derived from it, so deriving it back would be circular. */}
                    <div style={{ flex: 1.3, display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <input style={S.tierInput} type="number" value={t.client ?? ""} onChange={(e) => setTier(i, "client", e.target.value)} placeholder="$" />
                        <button style={S.autoBtn} title="Suggest from margin logic" onClick={() => autoFillClient(i)}>auto</button>
                      </div>
                      {mix && <span style={S.tierMixLine}>${fmt(mix.blended)} avg · ${fmt(mix.total)} total</span>}
                    </div>
                    <div style={{ flex: 0.8, textAlign: "right", ...S.num, alignSelf: "center" }}>
                      {mixMargin != null
                        ? <span style={{ color: mixMargin && mixMargin < 25 ? "#c2683a" : "#3f7d5a", fontWeight: 600 }}>{mixMargin.toFixed(0)}%</span>
                        : <span style={{ color: (mr ? mr.low : m) && (mr ? mr.low : m) < 25 ? "#c2683a" : "#3f7d5a", fontWeight: 600 }}>{mr ? (mr.low.toFixed(0) === mr.high.toFixed(0) ? mr.low.toFixed(0) + "%" : mr.low.toFixed(0) + "-" + mr.high.toFixed(0) + "%") : (m ? m.toFixed(0) + "%" : "—")}</span>}
                    </div>
                    <div style={{ width: 30, alignSelf: "center", textAlign: "center" }}>
                      {f.tiers.length > 1 && <button style={S.tierDel} onClick={() => removeTier(i)}><X size={14} /></button>}
                    </div>
                  </div>
                  {/* Cost columns are identical to the parent, so they stay empty rather
                      than repeating themselves. Flex widths mirror the row above. */}
                  {sizeRows.map((r) => (
                    <div key={r.size} style={S.tierSizeRow}>
                      <div style={{ flex: 1.0, display: "flex", alignItems: "center", gap: 6, paddingLeft: 12 }}>
                        <span style={{ ...S.tierSizeCell, color: "#8a93a5", fontWeight: 600, minWidth: 24 }}>{r.size}</span>
                        <input
                          style={{ ...S.tierInput, padding: "5px 7px", fontSize: 12.5, textAlign: "right" }}
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          aria-label={"Quantity for size " + r.size}
                          value={(t.sizeQty || {})[r.size] ?? ""}
                          onChange={(e) => setSizeQty(i, r.size, e.target.value)}
                        />
                      </div>
                      <div style={{ flex: 1.0 }} />
                      <div style={{ flex: 1.0 }} />
                      <div style={{ flex: 1.5 }} />
                      <div style={{ flex: 1.1, textAlign: "right", ...S.tierSizeCell }}>{total ? `$${fmt(total)}` : "—"}</div>
                      {/* The parenthetical is what the base was moved BY, so it only makes
                          sense next to a base. With none the delta is the whole price and
                          printing it twice would read as an error. */}
                      <div style={{ flex: 1.3, ...S.tierSizeCell }}>
                        {r.price == null ? "—" : (
                          <>
                            {`$${fmt(r.price)}`}
                            {hasBase && r.delta !== 0 && <span style={{ color: "#9aa3b5", marginLeft: 5 }}>({r.delta > 0 ? "+" : "−"}{fmt(Math.abs(r.delta))})</span>}
                          </>
                        )}
                      </div>
                      <div style={{ flex: 0.8, textAlign: "right", ...S.tierSizeCell }}>
                        {r.margin == null ? "—" : <span style={{ color: r.margin < 25 ? "#c2683a" : "#3f7d5a", fontWeight: 600 }}>{r.margin.toFixed(0)}%</span>}
                      </div>
                      <div style={{ width: 30 }} />
                    </div>
                  ))}
                  </React.Fragment>
                );
              })}
            </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button style={S.addTierBtn} onClick={() => addTier()}><Plus size={14} /> Add tier</button>
              <button style={S.presetBtn} onClick={addPresets}>+ Preset qtys (500 / 1k / 2.5k / 5k)</button>
            </div>
            <div style={S.tierHint}>Total Cost = EXW + Freight/Duty (auto). Client price auto-suggests from KUI margin logic off total cost — tap "auto," then adjust. Margin turns amber below 25%. Tap Σ to build the freight number from its real cost legs. Swipe sideways to see all columns.</div>
            {fbTier != null && f.tiers[fbTier] && (
              <FreightBuilder
                tier={f.tiers[fbTier]}
                form={f}
                onClose={() => setFbTier(null)}
                onApply={(totalPerUnit, legs) => {
                  setF((p) => ({ ...p, tiers: p.tiers.map((x, idx) => idx === fbTier ? { ...x, ship: "ocean", freightAir: "", freightOcean: totalPerUnit.toFixed(3), fb: legs, duty_only: false } : x) }));
                  setFbTier(null);
                }}
              />
            )}
            <label style={{ ...S.field, marginTop: 14, maxWidth: 320 }}>
              <span style={S.fieldLabel}>Mold / Tooling Fee <span style={{ color: "#6a7488", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(amortized per unit into total cost)</span></span>
              <div style={{ position: "relative" }}>
                <input style={S.input} type="number" value={f.moldFee ?? ""} onChange={set("moldFee")} placeholder="$ one-time mold cost" />
              </div>
            </label>
            {Number(f.moldFee) > 0 && (
              <div style={{ fontSize: 12, color: "#6a7488", marginTop: 6 }}>Divided across each tier's quantity and added to that tier's total cost (e.g. ${fmt(f.moldFee)} ÷ 1,000 units = ${fmt(moldPerUnit(f.moldFee, 1000))}/unit).</div>
            )}
          </div>

          <label style={{ ...S.field, marginTop: 4 }}>
            <span style={S.fieldLabel}>Notes</span>
            <textarea style={{ ...S.input, minHeight: 64, resize: "vertical" }} value={f.notes} onChange={set("notes")} placeholder="MOQ notes, tooling, pricing assumptions, etc." />
          </label>
        </div>
        <div style={S.modalFoot}>
          <button style={S.ghostBtn} onClick={onClose}>Cancel</button>
          <button style={S.primaryBtn} onClick={handleSave}><Check size={16} /> Save Quote</button>
        </div>
      </div>
    </div>
  );
}

function FormSection({ icon, title, children }) {
  return (
    <div style={S.formSection}>
      <div style={S.formSectionHead}>{icon} {title}</div>
      <div style={S.formGrid}>{children}</div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Spline+Sans:wght@400;500;600&display=swap');
input::placeholder, textarea::placeholder { color: #cdd5e2; }
.quotes-root input, .quotes-root select, .quotes-root textarea, .quotes-root button { font-family: 'Spline Sans', system-ui, sans-serif; }
.quotes-root input:focus, .quotes-root select:focus, .quotes-root textarea:focus { outline: none; border-color: #3461e0 !important; box-shadow: 0 0 0 3px rgba(61,86,128,0.14); }
`;

const S = {
  shell: { minHeight: "100%", background: "#ffffff", padding: "30px 26px 70px", fontFamily: "'Spline Sans', system-ui, sans-serif", color: "#0f1729" },
  center: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", fontSize: 16, color: "#6a7488" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 1280, margin: "0 auto 22px", flexWrap: "wrap", gap: 16, background: "#ffffff", padding: "16px 24px", borderRadius: 14, border: "1px solid #e7eaf0", boxShadow: "0 1px 3px rgba(15,23,41,0.05)" },
  headerMobile: { flexDirection: "column", alignItems: "stretch", gap: 12, padding: "14px 16px", borderRadius: 14, margin: "0 0 16px" },
  btnMobile: { padding: "9px 12px", fontSize: 13 },
  logoLockup: { display: "flex", alignItems: "center", gap: 14 },
  title: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 30, fontWeight: 600, margin: "2px 0 0", color: "#0f1729", letterSpacing: "-0.01em" },
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 8, background: "linear-gradient(145deg,#16264e,#0b1530)", color: "#ffffff", border: "none", padding: "11px 18px", borderRadius: 11, fontSize: 14, fontWeight: 600, boxShadow: "0 3px 12px rgba(11,21,48,0.18)" },
  ghostBtn: { display: "inline-flex", alignItems: "center", gap: 7, background: "#ffffff", color: "#6a7488", border: "1px solid #e7eaf0", padding: "10px 15px", borderRadius: 11, fontSize: 14, fontWeight: 600 },
  userTag: { fontSize: 12, color: "#9aa3b5", fontWeight: 500 },
  controls: { display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 1280, margin: "0 auto 14px", gap: 16, flexWrap: "wrap" },
  searchWrap: { display: "flex", alignItems: "center", gap: 9, background: "#ffffff", border: "1px solid #e7eaf0", borderRadius: 12, padding: "11px 15px", flex: "1 1 100%", boxShadow: "0 1px 3px rgba(26,34,56,0.05)" },
  searchInput: { border: "none", background: "transparent", fontSize: 14.5, width: "100%", color: "#0f1729" },
  clearBtn: { background: "transparent", border: "none", color: "#6a7488", display: "inline-flex", padding: 2 },
  // The picker panel. Absolute rather than portalled: it sits inside S.modalBody,
  // which scrolls, so the panel should scroll with its field.
  htsPanel: { position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30, marginTop: 4, background: "#ffffff", border: "1px solid #e7eaf0", borderRadius: 12, boxShadow: "0 10px 30px rgba(15,23,41,0.16)", padding: 8 },
  htsOption: { display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "8px 9px", borderRadius: 8, fontSize: 13.5, color: "#0f1729", cursor: "pointer" },
  htsAddBtn: { display: "inline-flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "center", marginTop: 6, background: "#eef1f6", color: "#3461e0", border: "none", borderRadius: 9, padding: "9px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  chipRow: { display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 1280, margin: "0 auto 20px", alignItems: "center" },
  chip: { display: "inline-flex", alignItems: "center", gap: 6, background: "#ffffff", border: "1px solid #e7eaf0", color: "#6a7488", padding: "7px 13px", borderRadius: 20, fontSize: 13, fontWeight: 500 },
  chipActive: { background: "#101d3d", color: "#ffffff", borderColor: "#101d3d" },
  chipCount: { fontSize: 11, opacity: 0.7, fontWeight: 600 },
  breadcrumb: { display: "flex", alignItems: "center", gap: 10, maxWidth: 1280, margin: "0 auto 14px" },
  crumbBtn: { display: "inline-flex", alignItems: "center", gap: 3, background: "transparent", border: "none", color: "#3461e0", fontSize: 14, fontWeight: 600, padding: 0 },
  crumbSep: { color: "#9aa3b5" },
  crumbCurrent: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 600, color: "#0f1729" },
  crumbMeta: { fontSize: 12.5, color: "#6a7488", marginLeft: 4 },
  clientGrid: { maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 },
  clientCard: { background: "#ffffff", border: "1px solid #e7eaf0", borderRadius: 16, padding: "20px 20px 18px", textAlign: "left", display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 2px 8px rgba(26,34,56,0.05)" },
  clientCardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  clientAvatar: { width: 42, height: 42, borderRadius: 11, background: "linear-gradient(135deg,#eef1f6,#e7eaf0)", color: "#3461e0", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600, fontSize: 16 },
  clientName: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 19, fontWeight: 600, color: "#0f1729" },
  clientMeta: { fontSize: 13, color: "#6a7488", fontWeight: 500 },
  clientUpdated: { fontSize: 11.5, color: "#6a7488", marginTop: 2 },
  tableWrap: { maxWidth: 1280, margin: "0 auto", background: "#ffffff", border: "1px solid #e7eaf0", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 10px rgba(26,34,56,0.05)" },
  theadRow: { display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid #e7eaf0", fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase", color: "#9aa3b5", fontWeight: 600, background: "#ffffff" },
  rowGroup: { borderBottom: "1px solid #eef1f6" },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "15px 18px" },
  rowOpen: { background: "#f6f8fb" },
  cellPrimary: { fontSize: 14.5, fontWeight: 600, color: "#0f1729" },
  cellSub: { fontSize: 12, color: "#6a7488", marginTop: 2 },
  cellSub2: { fontSize: 13, color: "#36405a", fontWeight: 500 },
  num: { fontSize: 14, fontVariantNumeric: "tabular-nums", color: "#0f1729" },
  tierBadge: { display: "inline-flex", alignItems: "center", gap: 4, background: "#eef1f6", color: "#3461e0", fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 14 },
  fdStamp: { fontSize: 11, color: "#9aa3b5", marginTop: 8, display: "flex", alignItems: "center", gap: 4 },
  feeNote: { fontSize: 12.5, color: "#0f1729", marginTop: 10, display: "flex", flexDirection: "column", gap: 4, background: "#ffffff", border: "1px solid #e7eaf0", borderRadius: 8, padding: "10px 12px" },
  iconBtn: { background: "transparent", border: "none", color: "#6a7488", padding: 6, borderRadius: 8, display: "inline-flex" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center", gridColumn: "1 / -1" },
  detailPanel: { background: "#f6f8fb", padding: "20px 22px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 20, borderTop: "1px dashed #e7eaf0" },
  detailSection: {},
  detailHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#3461e0", marginBottom: 11 },
  detailGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" },
  detailLabel: { fontSize: 11, color: "#9aa3b5" },
  detailValue: { fontSize: 13.5, color: "#0f1729", fontWeight: 500, marginTop: 1 },
  tierTable: { border: "1px solid #e7eaf0", borderRadius: 12, overflow: "hidden", background: "#ffffff" },
  tierHeadRow: { display: "flex", gap: 8, padding: "10px 14px", background: "#eef1f6", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9aa3b5", fontWeight: 600 },
  tierBodyRow: { display: "flex", gap: 8, padding: "11px 14px", borderTop: "1px solid #eef1f6", fontSize: 13.5 },
  overlay: { position: "fixed", inset: 0, background: "rgba(26,34,56,0.46)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "36px 16px", zIndex: 50, overflowY: "auto" },
  modal: { background: "#ffffff", borderRadius: 20, width: "100%", maxWidth: 860, boxShadow: "0 24px 60px rgba(11,21,48,0.22)", border: "1px solid #e7eaf0" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 26px", borderBottom: "1px solid #e7eaf0" },
  modalTitle: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 25, fontWeight: 600, margin: 0, color: "#0f1729" },
  modalBody: { padding: "22px 26px", maxHeight: "66vh", overflowY: "auto" },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 26px", borderTop: "1px solid #e7eaf0" },
  formSection: { marginBottom: 20 },
  formSectionHead: { display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#3461e0", marginBottom: 11 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  fieldLabel: { fontSize: 12, color: "#6a7488", fontWeight: 500 },
  input: { border: "1px solid #e7eaf0", background: "#ffffff", borderRadius: 10, padding: "10px 12px", fontSize: 14, color: "#0f1729", width: "100%" },
  inputSuffix: { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#9aa3b5", fontSize: 13, pointerEvents: "none" },
  select: { border: "1px solid #e7eaf0", background: "#ffffff", borderRadius: 10, padding: "10px 12px", fontSize: 14, color: "#0f1729", width: "100%" },
  fieldWarn: { fontSize: 11.5, color: "#c2683a", lineHeight: 1.45 },
  tierEditTable: { border: "1px solid #e7eaf0", borderRadius: 12, overflow: "hidden" },
  tierEditHead: { display: "flex", gap: 8, padding: "9px 12px", background: "#eef1f6", fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", color: "#9aa3b5", fontWeight: 600 },
  tierEditRow: { display: "flex", gap: 8, padding: "8px 12px", borderTop: "1px solid #eef1f6", background: "#ffffff" },
  // Derived display beneath a tier, not an input row — tinted, tighter, dashed rule.
  tierSizeRow: { display: "flex", gap: 8, padding: "5px 12px", borderTop: "1px dashed #eef1f6", background: "#fafbfd" },
  tierSizeCell: { fontSize: 12, fontVariantNumeric: "tabular-nums", color: "#6a7488", alignSelf: "center" },
  tierInput: { border: "1px solid #e7eaf0", background: "#ffffff", borderRadius: 8, padding: "8px 9px", fontSize: 13.5, color: "#0f1729", width: "100%" },
  // Stands in for the tier's Qty input once the size rows own the number. Dashed and
  // tinted so it reads as derived rather than as a dead input — the same treatment
  // .qty-from-sizes gives the sized line items on the order side.
  qtyFromSizes: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1, padding: "6px 9px", background: "#fafbfd", border: "1px dashed #e7eaf0", borderRadius: 8 },
  qfsV: { fontSize: 13, fontWeight: 600, color: "#0f1729", lineHeight: 1.2, fontVariantNumeric: "tabular-nums" },
  qfsK: { fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "#9aa3b5", fontWeight: 600 },
  tierMixLine: { fontSize: 11, color: "#9aa3b5", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  autoBtn: { background: "#eef1f6", border: "1px solid #e7eaf0", color: "#3461e0", borderRadius: 8, padding: "0 9px", fontSize: 11, fontWeight: 600 },
  tierDel: { background: "transparent", border: "none", color: "#bba", padding: 2, display: "inline-flex" },
  addTierBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "#eef1f6", color: "#0f1729", border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600 },
  presetBtn: { background: "#ffffff", border: "1px solid #e7eaf0", color: "#6a7488", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 500 },
  tierHint: { fontSize: 11.5, color: "#9aa3b5", marginTop: 9, lineHeight: 1.5 },
  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#3f7d5a", color: "#fff", padding: "11px 20px", borderRadius: 11, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 6px 22px rgba(0,0,0,0.2)", zIndex: 100 },
  sugBox: { position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "#ffffff", border: "1px solid #e7eaf0", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,41,0.14)", zIndex: 20, overflow: "hidden", padding: "4px" },
  sugHint: { fontSize: 10.5, color: "#9aa3b5", padding: "6px 8px 4px", letterSpacing: "0.03em" },
  sugItem: { display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "9px 8px", fontSize: 13.5, color: "#0f1729", borderRadius: 7, fontWeight: 500 },
  sugDot: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0 },
  sugBuyer: { color: "#6a7488", fontWeight: 500, fontSize: 12.5 },
  tierScroll: { overflowX: "auto", WebkitOverflowScrolling: "touch", borderRadius: 12 },
  tierInputOff: { background: "#f6f8fb", color: "#9aa3b5", opacity: 0.6 },
  taskBadge: { position: "absolute", top: -6, right: -6, background: "#c2683a", color: "#fff", fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" },
  taskItem: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid #eef1f6" },
  taskCheck: { background: "transparent", border: "none", padding: 0, display: "inline-flex", marginTop: 1 },
  taskMeta: { fontSize: 11.5, color: "#6a7488", marginTop: 3 },
  taskJump: { background: "transparent", border: "none", color: "#3461e0", fontWeight: 600, padding: 0, fontSize: 11.5, textDecoration: "underline" },
  taskAddRow: { display: "flex", gap: 8, alignItems: "center" },
  taskTab: { background: "transparent", border: "none", borderBottom: "2px solid transparent", color: "#6a7488", fontSize: 13.5, fontWeight: 600, padding: "12px 4px", marginBottom: -1 },
  taskTabOn: { color: "#0f1729", borderBottom: "2px solid #3461e0" },
  sendClientRow: { display: "flex", alignItems: "center", gap: 12, background: "#ffffff", border: "1px solid #e7eaf0", borderRadius: 12, padding: "12px 14px", textAlign: "left", width: "100%" },
  sendQuoteRow: { display: "flex", alignItems: "center", gap: 11, background: "#ffffff", border: "1px solid #e7eaf0", borderRadius: 10, padding: "11px 13px", width: "100%" },
  dirSection: { background: "#ffffff", border: "1px solid #e7eaf0", borderRadius: 12, padding: "14px 16px" },
  dirBuyerRow: { display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: "1px solid #e7eaf0" },
  presetLabel: { fontSize: 11, color: "#9aa3b5", marginBottom: 6, letterSpacing: "0.03em" },
  presetPills: { display: "flex", flexWrap: "wrap", gap: 6 },
  factoryPill: { display: "inline-flex", alignItems: "center", gap: 5, background: "#eef1f6", border: "1px solid #e7eaf0", color: "#3461e0", borderRadius: 18, padding: "6px 12px", fontSize: 12.5, fontWeight: 600 },
  saveFactoryBtn: { background: "#ffffff", border: "1px dashed #cdd5e2", color: "#3461e0", borderRadius: 9, padding: "9px 14px", fontSize: 12.5, fontWeight: 600, width: "100%" },
  saveFactoryRow: { display: "flex", gap: 8, alignItems: "center" },
  primaryBtnSm: { background: "#101d3d", color: "#ffffff", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600 },
  ghostBtnSm: { background: "transparent", color: "#6a7488", border: "1px solid #e7eaf0", borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 600 },
  shipToggle: { flex: 1, background: "#ffffff", border: "1px solid #e7eaf0", color: "#6a7488", borderRadius: 7, padding: "7px 0", fontSize: 11.5, fontWeight: 600 },
  shipOn: { background: "#eef1f6", color: "#0f1729", borderColor: "#eef1f6" },
  methodTag: { fontSize: 11, fontWeight: 600, color: "#3461e0", background: "#eef1f6", borderRadius: 12, padding: "2px 9px" },
  printBtn: { display: "inline-flex", alignItems: "center", gap: 7, background: "#ffffff", border: "1px solid #cdd5e2", color: "#3461e0", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600 },
};
