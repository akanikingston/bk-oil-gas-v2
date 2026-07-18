import React, { useState, useEffect } from "react";
import {
  Flame, LayoutDashboard, FileBarChart2, Clock, MoreHorizontal, Bell, ChevronLeft,
  Wallet, Receipt, PackageMinus, Fuel, Lock, LogOut, Download, ChevronDown, ChevronUp,
  Users, Truck, Settings as SettingsIcon, ShieldAlert, AlertTriangle, CheckCircle2,
  DollarSign, TrendingUp, Archive, UserCog, Plus, Printer, FileSpreadsheet,
} from "lucide-react";
import { supabase } from "./supabaseClient.js";

/* ---------------------------------------------------------------------- */
/* Design tokens (from provided mockup)                                    */
/* ---------------------------------------------------------------------- */

const C = {
  primary: "#2563EB", primaryDark: "#1D4ED8", primarySoft: "#EFF4FF",
  success: "#16A34A", successSoft: "#EAF7ED",
  alert: "#DC2626", alertSoft: "#FDECEC",
  warn: "#D97706", warnSoft: "#FEF3E0",
  text: "#1F2937", sub: "#6B7280", faint: "#9CA3AF",
  border: "#E5E7EB", bg: "#FFFFFF", bgAlt: "#F3F4F6",
};
const RADIUS = 16;
const SHADOW = "0 2px 10px rgba(17,24,39,0.06)";
const FONT = "'Inter', -apple-system, sans-serif";

/* ---------------------------------------------------------------------- */
/* Storage — backed by Supabase, so all roles/devices share the same data */
/* Requires the `erp_store` table + env vars described in README.md.      */
/* ---------------------------------------------------------------------- */
const storage = {
  async get(key) {
    const { data, error } = await supabase.from("erp_store").select("value").eq("id", key).maybeSingle();
    if (error || !data) throw new Error("not found");
    return { key, value: data.value };
  },
  async set(key, value) {
    const { error } = await supabase.from("erp_store").upsert({ id: key, value, updated_at: new Date().toISOString() });
    if (error) { console.error("Supabase save error:", error.message); return null; }
    return { key, value };
  },
};

const STORAGE_KEY = "erp-data";
const ROLES = ["Cashier", "Manager", "Owner"];

const DEFAULT_DATA = {
  settings: { businessName: "BK Oil & Gas", defaultPricePerKg: 1250 },
  suppliers: [{ id: "s1", name: "NNPC", phone: "", note: "" }],
  customers: [],
  tanks: [],
  activityLog: [],
};

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
function currency(n) { const v = Number(n) || 0; return "₦" + v.toLocaleString("en-NG", { maximumFractionDigits: 0 }); }
function kgFmt(n) { const v = Number(n) || 0; return v.toLocaleString("en-NG", { maximumFractionDigits: 1 }) + " kg"; }
function sum(arr, fn) { return arr.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0); }
function downloadCSV(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------- */
/* Tank accounting engine                                                  */
/* ---------------------------------------------------------------------- */

function tankMetrics(tank) {
  const totalPurchasedKg = sum(tank.purchases, (p) => p.qtyKg);
  const totalCost = sum(tank.purchases, (p) => p.amount);
  const totalKgSold = sum(tank.dailySales, (d) => (d.p1c - d.p1o) + (d.p2c - d.p2o));
  const totalInternalUsageKg = sum(tank.internalUsage, (u) => u.kg);
  const paidKg = totalKgSold - totalInternalUsageKg;

  let totalSalesAmount = 0, totalRealized = 0;
  const dailyRows = tank.dailySales.map((d) => {
    const kgSoldDay = (d.p1c - d.p1o) + (d.p2c - d.p2o);
    const internalDay = sum(tank.internalUsage.filter((u) => u.date === d.date), (u) => u.kg);
    const paidKgDay = kgSoldDay - internalDay;
    const salesAmountDay = paidKgDay * d.price;
    const realizedDay = d.cash + d.pos;
    totalSalesAmount += salesAmountDay;
    totalRealized += realizedDay;
    return { ...d, kgSoldDay, internalDay, paidKgDay, salesAmountDay, realizedDay, shortOverDay: realizedDay - salesAmountDay };
  });

  const totalExpenses = sum(tank.expenses, (e) => e.amount);
  const shortOver = totalRealized - totalSalesAmount;
  const remainingStock = totalPurchasedKg - totalKgSold;
  const grossProfit = totalSalesAmount - totalCost;
  const netProfit = grossProfit - totalExpenses;

  return { totalPurchasedKg, totalCost, totalKgSold, totalInternalUsageKg, paidKg, totalSalesAmount, totalRealized, totalExpenses, shortOver, remainingStock, grossProfit, netProfit, dailyRows };
}

// Fixed kg-band thresholds per audit legend: Normal 0-5kg, Review 5.1-20kg, High >20kg
function classifyVariance(variance) {
  const abs = Math.abs(variance);
  if (abs <= 5) return "Normal";
  if (abs <= 20) return "Review Required";
  return "High Variance - Investigate";
}
function varianceTone(type) {
  if (type === "Normal") return "success";
  if (type === "Review Required") return "warn";
  return "alert";
}

/* ---------------------------------------------------------------------- */
/* UI primitives                                                           */
/* ---------------------------------------------------------------------- */

function toneColors(tone) {
  const map = {
    primary: { fg: C.primary, bg: C.primarySoft },
    success: { fg: C.success, bg: C.successSoft },
    warn: { fg: C.warn, bg: C.warnSoft },
    alert: { fg: C.alert, bg: C.alertSoft },
    neutral: { fg: C.sub, bg: C.bgAlt },
  };
  return map[tone] || map.neutral;
}

function Card({ children, style }) {
  return <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: RADIUS, padding: 12, boxShadow: SHADOW, ...style }}>{children}</div>;
}
function Field({ label, children }) {
  return <div style={{ marginBottom: 12 }}><div style={{ fontSize: 12, color: C.sub, marginBottom: 5, fontWeight: 500 }}>{label}</div>{children}</div>;
}
function Input(props) {
  return <input {...props} style={{ width: "100%", background: C.bgAlt, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", color: C.text, fontSize: 14, fontFamily: FONT, outline: "none", ...(props.style || {}) }} />;
}
function Select({ children, ...props }) {
  return <select {...props} style={{ width: "100%", background: C.bgAlt, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", color: C.text, fontSize: 14, outline: "none", fontFamily: FONT }}>{children}</select>;
}
function Button({ children, variant = "primary", full, ...props }) {
  const styles = {
    primary: { background: C.primary, color: "#fff" },
    success: { background: C.success, color: "#fff" },
    alert: { background: C.alert, color: "#fff" },
    outline: { background: "#fff", color: C.text, border: `1px solid ${C.border}` },
    ghost: { background: "transparent", color: C.primary, border: "none" },
  };
  return (
    <button {...props} style={{
      ...styles[variant], border: styles[variant].border || "none", padding: "12px 18px", borderRadius: 12,
      fontSize: 14, fontWeight: 600, cursor: "pointer", width: full ? "100%" : undefined,
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
      opacity: props.disabled ? 0.5 : 1, fontFamily: FONT, ...(props.style || {}),
    }}>{children}</button>
  );
}
function Badge({ children, tone = "neutral" }) {
  const t = toneColors(tone);
  return <span style={{ background: t.bg, color: t.fg, padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{children}</span>;
}
function StatTile({ label, value, tone = "neutral", icon: Icon }) {
  const t = toneColors(tone);
  return (
    <Card style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>{label}</span>
        {Icon && <Icon size={14} color={t.fg} />}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: t.fg === C.sub ? C.text : t.fg }}>{value}</div>
    </Card>
  );
}
function CircularGauge({ percent, size = 70 }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped / 100);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={C.border} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={C.success} strokeWidth={stroke} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: C.text }}>
        {Math.round(clamped)}%
      </div>
    </div>
  );
}
function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", background: C.bgAlt, borderRadius: 12, padding: 4, gap: 4, marginBottom: 14 }}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          flex: 1, padding: "9px 6px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: FONT,
          background: value === o.value ? "#fff" : "transparent", color: value === o.value ? C.primary : C.sub,
          boxShadow: value === o.value ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
        }}>{o.label}</button>
      ))}
    </div>
  );
}
function ListTable({ columns, rows, empty }) {
  if (!rows.length) return <div style={{ color: C.faint, fontSize: 13, padding: "20px 0", textAlign: "center" }}>{empty || "No records yet."}</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead><tr>{columns.map((c) => <th key={c.key} style={{ textAlign: "left", padding: "6px 8px", color: C.faint, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `1px solid ${C.border}` }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              {columns.map((c) => <td key={c.key} style={{ padding: "7px 8px", color: C.text }}>{c.render ? c.render(row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Phone chrome */
function StatusBar() {
  return (
    <div style={{ height: 44, display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 22px 6px", fontSize: 13, fontWeight: 600, color: C.text }}>
      <span>9:41</span>
      <span style={{ fontSize: 11, color: C.sub }}>●●●● 5G 🔋</span>
    </div>
  );
}
function TopBar({ title, onBack, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 32 }}>
        {onBack && <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: C.text }}><ChevronLeft size={20} /></button>}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{title}</div>
      <div style={{ minWidth: 32, display: "flex", justifyContent: "flex-end" }}>{right}</div>
    </div>
  );
}
function BottomNav({ items, active, onChange }) {
  return (
    <div style={{ display: "flex", borderTop: `1px solid ${C.border}`, background: "#fff", padding: "8px 4px 10px" }}>
      {items.map((it) => {
        const Icon = it.icon;
        const isActive = active === it.key;
        return (
          <button key={it.key} onClick={() => onChange(it.key)} style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            background: "none", border: "none", cursor: "pointer", color: isActive ? C.primary : C.faint,
          }}>
            <Icon size={19} strokeWidth={isActive ? 2.4 : 2} />
            <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Login                                                                   */
/* ---------------------------------------------------------------------- */

function LoginScreen({ onAuthed }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setError("Account created — check your email to confirm, then sign in. (If you disabled email confirmation in Supabase, try signing in now instead.)");
          setBusy(false);
          return;
        }
        // New accounts always start as Cashier — an Owner upgrades roles afterward
        // from Manage Users. This prevents anyone from granting themselves Owner access.
        const { error: profileError } = await supabase.from("profiles").upsert({ id: data.user.id, name: name.trim(), role: "Cashier" });
        if (profileError) throw profileError;
        onAuthed({ id: data.user.id, name: name.trim(), role: "Cashier", email: email.trim() });
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) throw signInError;
        const { data: profile, error: profileError } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
        if (profileError) throw profileError;
        if (!profile) {
          setError("No profile found for this account. Try signing up instead, or ask an Owner to check your account.");
          setBusy(false);
          return;
        }
        onAuthed({ id: data.user.id, name: profile.name, role: profile.role, email: email.trim() });
      }
    } catch (e) {
      setError(e.message || "Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "40px 24px", background: "#fff" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginBottom: 20 }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, background: C.primarySoft, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
          <Flame size={32} color={C.primary} strokeWidth={2} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>BK OIL &amp; GAS</div>
        <div style={{ fontSize: 12, color: C.sub }}>ERP SYSTEM</div>
      </div>

      <Segmented
        options={[{ label: "Sign In", value: "signin" }, { label: "Create Account", value: "signup" }]}
        value={mode} onChange={(m) => { setMode(m); setError(""); }}
      />

      {mode === "signup" && (
        <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chidinma" /></Field>
      )}
      <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
      <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></Field>
      {mode === "signup" && (
        <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 12, lineHeight: 1.5 }}>
          New accounts start as <b>Cashier</b>. An Owner can upgrade your role afterward from Manage Users.
        </div>
      )}

      {error && (
        <div style={{ background: C.alertSoft, color: C.alert, borderRadius: 10, padding: "8px 12px", fontSize: 12, marginBottom: 12 }}>{error}</div>
      )}

      <Button
        full
        disabled={busy || !email.trim() || !password || (mode === "signup" && !name.trim())}
        onClick={submit}
        style={{ marginTop: 4 }}
      >
        {busy ? "Please wait..." : mode === "signup" ? "Create Account" : "Sign In"}
      </Button>

      <div style={{ fontSize: 11, color: C.faint, marginTop: 16, lineHeight: 1.6, textAlign: "center" }}>
        Real accounts now — your password is checked by Supabase, and your role is saved permanently to your account.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Cashier Dashboard                                                        */
/* ---------------------------------------------------------------------- */

function QuickAction({ icon: Icon, label, tone = "primary", onClick }) {
  const t = toneColors(tone);
  return (
    <button onClick={onClick} style={{ background: t.bg, border: "none", borderRadius: 14, padding: "16px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer" }}>
      <Icon size={18} color={t.fg} />
      <span style={{ fontSize: 11.5, fontWeight: 600, color: C.text }}>{label}</span>
    </button>
  );
}

function CashierDashboard({ data, session, goto }) {
  const activeTank = data.tanks.find((t) => t.status === "ACTIVE");
  const m = activeTank ? tankMetrics(activeTank) : null;
  const todaySales = m ? sum(m.dailyRows.filter((r) => r.date === todayStr()), (r) => r.salesAmountDay) : 0;
  const todayKg = activeTank ? sum(activeTank.dailySales.filter((d) => d.date === todayStr()), (d) => (d.p1c - d.p1o) + (d.p2c - d.p2o)) : 0;
  const todayCash = activeTank ? sum(activeTank.dailySales.filter((d) => d.date === todayStr()), (d) => d.cash) : 0;
  const todayPos = activeTank ? sum(activeTank.dailySales.filter((d) => d.date === todayStr()), (d) => d.pos) : 0;
  const remainingPct = m && m.totalPurchasedKg ? (m.remainingStock / m.totalPurchasedKg) * 100 : 0;

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Hello, Cashier</div>
          <div style={{ fontSize: 12, color: C.sub }}>{fmtDate(todayStr())}</div>
        </div>
        <Bell size={19} color={C.text} />
      </div>

      {!activeTank && (
        <Card style={{ marginBottom: 14, background: C.primarySoft, border: "none" }}>
          <div style={{ fontSize: 13, color: C.text, marginBottom: 10 }}>No active tank. Record a purchase to start one.</div>
          <Button onClick={() => goto("purchase")}><Plus size={15} /> Record LPG Purchase</Button>
        </Card>
      )}

      {activeTank && (
        <div style={{ background: C.success, borderRadius: RADIUS, padding: 16, marginBottom: 14, boxShadow: SHADOW }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 12 }}>Today's Sales</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.85)" }}>KG Sold</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{kgFmt(todayKg)}</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.85)" }}>Cash</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{currency(todayCash)}</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.85)" }}>POS</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{currency(todayPos)}</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.85)" }}>Revenue</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{currency(todaySales)}</div>
            </div>
          </div>
        </div>
      )}

      {activeTank && (
        <Card style={{ marginBottom: 14 }} onClick={() => goto("activeTank")}>
          <div style={{ fontSize: 11, color: C.sub, fontWeight: 600, marginBottom: 6 }}>ACTIVE TANK</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{activeTank.tankNo}</div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{kgFmt(m.remainingStock)} Remaining</div>
            </div>
            <CircularGauge percent={remainingPct} />
          </div>
          <div style={{ fontSize: 11.5, color: C.primary, marginTop: 10, textAlign: "center" }}>View full Active Tank →</div>
        </Card>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Quick Actions</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <QuickAction icon={Fuel} label="Daily Sales" tone="success" onClick={() => goto("dailySales")} />
        <QuickAction icon={FileBarChart2} label="View Sales" tone="primary" onClick={() => goto("activeTank")} />
      </div>

      {activeTank && (
        <Button variant="alert" full onClick={() => goto("endTank")}><Lock size={15} /> End Tank</Button>
      )}
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13 }}>
      <span style={{ color: C.sub }}>{label}</span>
      <span style={{ color: C.text, fontWeight: strong ? 700 : 500 }}>{value}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Manager Dashboard                                                        */
/* ---------------------------------------------------------------------- */

function ManagerDashboard({ data, session, goto }) {
  const closedFlagged = data.tanks.filter((t) => t.closure && t.closure.varianceType !== "Normal");
  const pendingExpenses = data.tanks.flatMap((t) => t.expenses).length;
  const activeTank = data.tanks.find((t) => t.status === "ACTIVE");
  const m = activeTank ? tankMetrics(activeTank) : null;
  const todaySales = m ? sum(m.dailyRows.filter((r) => r.date === todayStr()), (r) => r.salesAmountDay) : 0;
  const todayKg = activeTank ? sum(activeTank.dailySales.filter((d) => d.date === todayStr()), (d) => (d.p1c - d.p1o) + (d.p2c - d.p2o)) : 0;
  const todayCash = activeTank ? sum(activeTank.dailySales.filter((d) => d.date === todayStr()), (d) => d.cash) : 0;
  const todayPos = activeTank ? sum(activeTank.dailySales.filter((d) => d.date === todayStr()), (d) => d.pos) : 0;
  const todayExpenses = activeTank ? sum(activeTank.expenses.filter((e) => e.date === todayStr()), (e) => e.amount) : 0;
  const todayProfit = todaySales - todayExpenses;
  const remainingPct = m && m.totalPurchasedKg ? (m.remainingStock / m.totalPurchasedKg) * 100 : 0;

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Hello, Manager</div>
          <div style={{ fontSize: 12, color: C.sub }}>{fmtDate(todayStr())}</div>
        </div>
        <Bell size={19} color={C.text} />
      </div>

      {activeTank && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <StatTile label="Today's KG Sold" value={kgFmt(todayKg)} tone="primary" icon={Fuel} />
            <StatTile label="Today's Revenue" value={currency(todaySales)} tone="success" icon={TrendingUp} />
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <StatTile label="Cash" value={currency(todayCash)} tone="success" icon={Wallet} />
            <StatTile label="POS" value={currency(todayPos)} tone="primary" icon={Wallet} />
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <StatTile label="Expenses" value={currency(todayExpenses)} tone="warn" icon={Receipt} />
            <StatTile label="Profit" value={currency(todayProfit)} tone="success" icon={DollarSign} />
          </div>

          <Card style={{ marginBottom: 14 }} onClick={() => goto("activeTank")}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 11, color: C.sub, fontWeight: 600 }}>ACTIVE TANK</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{activeTank.tankNo}</div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.success }}>{Math.round(remainingPct)}%</div>
            </div>
            <div style={{ background: C.bgAlt, borderRadius: 999, height: 8, overflow: "hidden", marginBottom: 6 }}>
              <div style={{ width: `${Math.max(0, Math.min(100, remainingPct))}%`, background: C.success, height: "100%" }} />
            </div>
            <div style={{ fontSize: 12, color: C.sub }}>{kgFmt(m.remainingStock)} Remaining</div>
          </Card>
        </>
      )}

      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Alerts</div>
        {closedFlagged.length === 0 && <div style={{ fontSize: 12, color: C.faint }}>No active alerts.</div>}
        {closedFlagged.map((t) => (
          <div key={t.id} onClick={() => goto("history")} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}>
            <AlertTriangle size={15} color={varianceTone(t.closure.varianceType) === "alert" ? C.alert : C.warn} />
            <div style={{ fontSize: 12.5, color: C.text, flex: 1 }}>{t.closure.varianceType} — Tank {t.tankNo}, {Math.abs(t.closure.variance).toFixed(0)}kg</div>
            <Badge tone="alert">New</Badge>
          </div>
        ))}
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Pending Approvals</div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5 }}>
          <span style={{ color: C.sub }}>Expenses</span><Badge>{pendingExpenses}</Badge>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5 }}>
          <span style={{ color: C.sub }}>Usage Records</span><Badge>{sum(data.tanks, t => t.internalUsage.length)}</Badge>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5 }}>
          <span style={{ color: C.sub }}>Free Issues</span><Badge>{sum(data.tanks, t => t.internalUsage.filter(u => u.type === "Free Issue").length)}</Badge>
        </div>
      </Card>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Quick Actions</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <QuickAction icon={Wallet} label="Daily Sales" tone="success" onClick={() => goto("dailySales")} />
        <QuickAction icon={Fuel} label="Active Tank" tone="primary" onClick={() => goto("activeTank")} />
        <QuickAction icon={FileBarChart2} label="Reports" tone="warn" onClick={() => goto("reports")} />
        <QuickAction icon={ShieldAlert} label="Audit" tone="alert" onClick={() => goto("audit")} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Owner Dashboard                                                          */
/* ---------------------------------------------------------------------- */

function MiniLineChart({ points, color = C.success, height = 140 }) {
  if (!points.length) return <div style={{ color: C.faint, fontSize: 12, textAlign: "center", padding: "30px 0" }}>Not enough data yet.</div>;
  const width = 320;
  const max = Math.max(...points.map((p) => p.value), 1);
  const min = Math.min(...points.map((p) => p.value), 0);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({ x: i * stepX, y: height - ((p.value - min) / range) * (height - 20) - 10 }));
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${height} L 0 ${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <path d={areaPath} fill={color} opacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} />
      {coords.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={3} fill={color} />)}
    </svg>
  );
}

function OwnerDashboard({ data, session, goto }) {
  const closed = data.tanks.filter((t) => t.status === "CLOSED");
  const active = data.tanks.filter((t) => t.status === "ACTIVE");
  const totalRevenue = sum(closed, (t) => tankMetrics(t).totalSalesAmount) + sum(active, (t) => tankMetrics(t).totalSalesAmount);
  const netProfit = sum(closed, (t) => tankMetrics(t).netProfit);
  const totalKgSold = sum(data.tanks, (t) => tankMetrics(t).totalKgSold);

  // Revenue trend across all tanks, grouped by date
  const revenueByDate = {};
  data.tanks.forEach((t) => {
    tankMetrics(t).dailyRows.forEach((r) => {
      revenueByDate[r.date] = (revenueByDate[r.date] || 0) + r.salesAmountDay;
    });
  });
  const trendPoints = Object.keys(revenueByDate).sort().slice(-14).map((date) => ({ date, value: revenueByDate[date] }));

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Hello, Owner</div>
          <div style={{ fontSize: 12, color: C.sub }}>{fmtDate(todayStr())}</div>
        </div>
        <Bell size={19} color={C.text} />
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <StatTile label="Total Revenue" value={currency(totalRevenue)} tone="success" icon={TrendingUp} />
        <StatTile label="Total Profit" value={currency(netProfit)} tone="primary" icon={DollarSign} />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <StatTile label="Total KG Sold" value={kgFmt(totalKgSold)} tone="warn" icon={Fuel} />
        <StatTile label="Active Tanks" value={active.length} tone="neutral" icon={Archive} />
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>Revenue Overview</div>
        <div style={{ fontSize: 11, color: C.sub, marginBottom: 4 }}>Last {trendPoints.length} day{trendPoints.length === 1 ? "" : "s"} with sales</div>
        <MiniLineChart points={trendPoints} />
      </Card>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Quick Access</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <QuickAction icon={FileBarChart2} label="Reports" tone="success" onClick={() => goto("reports")} />
        <QuickAction icon={Archive} label="Tanks" tone="primary" onClick={() => goto("history")} />
        <QuickAction icon={DollarSign} label="Financial" tone="warn" onClick={() => goto("reports")} />
        <QuickAction icon={UserCog} label="User Management" tone="alert" onClick={() => goto("users")} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Daily Sales (Pump Readings) — merged screen                            */
/* ---------------------------------------------------------------------- */

function NoActiveTankNotice({ title, goto }) {
  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title={title} onBack={() => goto("dashboard")} />
      <Card><div style={{ color: C.faint, fontSize: 13, textAlign: "center", padding: "20px 0" }}>No active tank. Record a purchase first.</div></Card>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Active Tank — compilation of daily sales, kg sold, cash, POS, revenue  */
/* ---------------------------------------------------------------------- */

function ActiveTankPage({ data, goto }) {
  const activeTank = data.tanks.find((t) => t.status === "ACTIVE");
  if (!activeTank) return <NoActiveTankNotice title="Active Tank" goto={goto} />;
  const m = tankMetrics(activeTank);
  const totalCash = sum(activeTank.dailySales, (d) => d.cash);
  const totalPos = sum(activeTank.dailySales, (d) => d.pos);
  const rows = m.dailyRows.slice().reverse();

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title={`Active Tank — ${activeTank.tankNo}`} onBack={() => goto("dashboard")} right={<Badge tone="success">ACTIVE</Badge>} />

      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <StatTile label="Total KG Sold" value={kgFmt(m.totalKgSold)} tone="primary" icon={Fuel} />
        <StatTile label="Revenue" value={currency(m.totalSalesAmount)} tone="success" icon={TrendingUp} />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <StatTile label="Cash" value={currency(totalCash)} tone="success" icon={Wallet} />
        <StatTile label="POS" value={currency(totalPos)} tone="primary" icon={Wallet} />
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Daily Sales Log</div>
      <Card style={{ marginBottom: 16 }}>
        <ListTable
          columns={[
            { key: "date", label: "Date" },
            { key: "kg", label: "KG Sold", render: (r) => kgFmt(r.kgSoldDay) },
            { key: "cash", label: "Cash", render: (r) => currency(r.cash) },
            { key: "pos", label: "POS", render: (r) => currency(r.pos) },
            { key: "revenue", label: "Revenue", render: (r) => currency(r.salesAmountDay) },
          ]}
          rows={rows}
          empty="No daily sales recorded yet."
        />
      </Card>

      <Button full onClick={() => goto("dailySales")} style={{ marginBottom: 10 }}><Plus size={15} /> Add Daily Sales</Button>
      <Button variant="alert" full onClick={() => goto("endTank")}><Lock size={15} /> End Tank</Button>
    </div>
  );
}

function DailySalesPage({ data, update, log, goto }) {
  const activeTank = data.tanks.find((t) => t.status === "ACTIVE");
  const [date, setDate] = useState(todayStr());
  const [p1o, setP1o] = useState(""); const [p1c, setP1c] = useState("");
  const [p2o, setP2o] = useState(""); const [p2c, setP2c] = useState("");
  const [price, setPrice] = useState(data.settings.defaultPricePerKg);
  const [cash, setCash] = useState("");
  const [pos, setPos] = useState("");
  const [posTouched, setPosTouched] = useState(false);
  const [moniepointTotal, setMoniepointTotal] = useState(null);
  const [moniepointRows, setMoniepointRows] = useState([]);
  const [showLog, setShowLog] = useState(false);

  // Expenses to add for this day, staged locally until Save & Close Day
  const [expCategory, setExpCategory] = useState("Fuel");
  const [expNote, setExpNote] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expPaidBy, setExpPaidBy] = useState("Cash");
  const [pendingExpenses, setPendingExpenses] = useState([]);

  // Internal usage to add for this day, staged locally until Save & Close Day
  const [useType, setUseType] = useState("Generator");
  const [useQty, setUseQty] = useState("");
  const [useNote, setUseNote] = useState("");
  const [useApprovedBy, setUseApprovedBy] = useState("");
  const [pendingUsage, setPendingUsage] = useState([]);

  // Auto-fill POS from Moniepoint for this date, and stay live: any new
  // confirmed transaction for this date updates the total automatically.
  useEffect(() => {
    let cancelled = false;

    async function loadForDate() {
      const { data: rows, error } = await supabase
        .from("pos_transactions")
        .select("transaction_reference, amount, transaction_time, transaction_type, status")
        .gte("transaction_time", `${date}T00:00:00`)
        .lte("transaction_time", `${date}T23:59:59`)
        .order("transaction_time", { ascending: false });
      if (cancelled) return;
      if (error) { setMoniepointRows([]); setMoniepointTotal(null); return; }
      setMoniepointRows(rows || []);
      const total = sum(rows || [], (r) => r.amount);
      setMoniepointTotal(total);
      setPosTouched((touched) => {
        if (!touched) setPos(String(total));
        return touched;
      });
    }
    loadForDate();

    const channel = supabase
      .channel(`pos_transactions_${date}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pos_transactions" }, (payload) => {
        const txDate = (payload.new.transaction_time || "").slice(0, 10);
        if (txDate === date) loadForDate();
      })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [date]);

  if (!activeTank) return <NoActiveTankNotice title="Daily Sales" goto={goto} />;

  const kg1 = (Number(p1c) || 0) - (Number(p1o) || 0);
  const kg2 = (Number(p2c) || 0) - (Number(p2o) || 0);
  const totalKg = kg1 + kg2;
  const pendingUsageKg = sum(pendingUsage, (u) => u.kg);
  const internalDay = sum(activeTank.internalUsage.filter((u) => u.date === date), (u) => u.kg) + pendingUsageKg;
  const paidKg = totalKg - internalDay;
  const salesAmount = paidKg * (Number(price) || 0);
  const realized = (Number(cash) || 0) + (Number(pos) || 0);
  const shortOver = realized - salesAmount;
  const pendingExpenseTotal = sum(pendingExpenses, (e) => e.amount);

  const tankTotalKg = sum(activeTank.dailySales, (d) => (d.p1c - d.p1o) + (d.p2c - d.p2o));

  function addExpense() {
    if (!expAmount) return;
    setPendingExpenses((prev) => [...prev, { id: uid(), date, category: expCategory, note: expNote, amount: Number(expAmount) || 0, paidBy: expPaidBy }]);
    setExpNote(""); setExpAmount("");
  }
  function removeExpense(id) { setPendingExpenses((prev) => prev.filter((e) => e.id !== id)); }

  function addUsage() {
    if (!useQty) return;
    setPendingUsage((prev) => [...prev, { id: uid(), date, type: useType, kg: Number(useQty) || 0, remarks: useNote, approvedBy: useType === "Free Issue" ? useApprovedBy : "" }]);
    setUseNote(""); setUseQty(""); setUseApprovedBy("");
  }
  function removeUsage(id) { setPendingUsage((prev) => prev.filter((u) => u.id !== id)); }

  function submit() {
    const entry = { id: uid(), date, p1o: Number(p1o) || 0, p1c: Number(p1c) || 0, p2o: Number(p2o) || 0, p2c: Number(p2c) || 0, price: Number(price) || 0, cash: Number(cash) || 0, pos: Number(pos) || 0 };
    const tanks = data.tanks.map((t) => t.id === activeTank.id ? {
      ...t,
      dailySales: [...t.dailySales.filter((d) => d.date !== date), entry],
      expenses: [...t.expenses, ...pendingExpenses],
      internalUsage: [...t.internalUsage, ...pendingUsage],
    } : t);
    update({ ...data, tanks });
    log(`Daily sales recorded for ${date}: ${kgFmt(totalKg)} sold, ${currency(realized)} realized, ${pendingExpenses.length} expense(s), ${pendingUsage.length} usage entr${pendingUsage.length === 1 ? "y" : "ies"}`);
    goto("activeTank");
  }

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title="Daily Sales" onBack={() => goto("dashboard")} right={<span style={{ fontSize: 12, color: C.sub }}>{fmtDate(date)}</span>} />
      <Field label="Date"><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPosTouched(false); }} /></Field>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 10 }}>PUMP 1</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Opening Reading"><Input type="number" value={p1o} onChange={(e) => setP1o(e.target.value)} /></Field>
          <Field label="Closing Reading"><Input type="number" value={p1c} onChange={(e) => setP1c(e.target.value)} /></Field>
        </div>
        <div style={{ background: C.successSoft, borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: C.text, display: "flex", justifyContent: "space-between" }}>
          <span>KG SOLD (Auto)</span><b style={{ color: C.success }}>{kgFmt(kg1)}</b>
        </div>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 10 }}>PUMP 2</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Opening Reading"><Input type="number" value={p2o} onChange={(e) => setP2o(e.target.value)} /></Field>
          <Field label="Closing Reading"><Input type="number" value={p2c} onChange={(e) => setP2c(e.target.value)} /></Field>
        </div>
        <div style={{ background: C.successSoft, borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: C.text, display: "flex", justifyContent: "space-between" }}>
          <span>KG SOLD (Auto)</span><b style={{ color: C.success }}>{kgFmt(kg2)}</b>
        </div>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 10 }}>
          <span style={{ color: C.sub }}>TOTAL KG SOLD (Auto)</span><b style={{ color: C.text }}>{kgFmt(totalKg)}</b>
        </div>
        <Field label="Selling Price (₦/kg)"><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Cash Received (₦)"><Input type="number" value={cash} onChange={(e) => setCash(e.target.value)} /></Field>
        <Field label="POS Received (₦)">
          <Input type="number" value={pos} onChange={(e) => { setPos(e.target.value); setPosTouched(true); }} />
        </Field>
        {moniepointTotal !== null && (
          <div style={{ background: C.primarySoft, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div>
                <div style={{ fontSize: 10.5, color: C.sub }}>
                  MONIEPOINT SYNCED ({moniepointRows.length} txn{moniepointRows.length === 1 ? "" : "s"})
                  {!posTouched && <span style={{ color: C.success }}> · auto-filled</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.primary }}>{currency(moniepointTotal)}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {posTouched && (
                  <Button variant="outline" onClick={() => { setPos(String(moniepointTotal)); setPosTouched(false); }} style={{ padding: "6px 10px", fontSize: 11.5 }}>Reset to synced</Button>
                )}
                <Button variant="ghost" onClick={() => setShowLog((s) => !s)} style={{ padding: "6px 10px", fontSize: 11.5 }}>{showLog ? "Hide" : "View"} log</Button>
              </div>
            </div>
            {showLog && (
              <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                {moniepointRows.length === 0 && <div style={{ fontSize: 12, color: C.faint }}>No Moniepoint transactions for this date yet.</div>}
                {moniepointRows.map((r) => (
                  <div key={r.transaction_reference} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ color: C.sub }}>{r.transaction_time ? new Date(r.transaction_time).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                    <span style={{ color: C.text }}>{currency(r.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, background: C.primarySoft, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, color: C.sub }}>SALES AMOUNT (Auto)</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.primary }}>{currency(salesAmount)}</div>
          </div>
          <div style={{ flex: 1, background: C.successSoft, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, color: C.sub }}>AMOUNT REALIZED (Auto)</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.success }}>{currency(realized)}</div>
          </div>
        </div>
        <div style={{ background: shortOver < 0 ? C.alertSoft : C.successSoft, borderRadius: 10, padding: "8px 12px", marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
          <span style={{ color: C.sub }}>SHORT/OVER (Auto)</span><b style={{ color: shortOver < 0 ? C.alert : C.success }}>{currency(shortOver)}</b>
        </div>
      </Card>

      {/* Expenses for the day */}
      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 10 }}>EXPENSES ({fmtDate(date)})</div>
        {pendingExpenses.map((e) => (
          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize: 12.5, color: C.text }}>{e.category} — {currency(e.amount)}</div>
              <div style={{ fontSize: 10.5, color: C.faint }}>{e.note || "—"} · {e.paidBy}</div>
            </div>
            <button onClick={() => removeExpense(e.id)} style={{ background: "none", border: "none", color: C.alert, cursor: "pointer" }}><X size={14} /></button>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: pendingExpenses.length ? 10 : 0 }}>
          <Field label="Category">
            <Select value={expCategory} onChange={(e) => setExpCategory(e.target.value)}>
              <option>Fuel</option><option>Repairs</option><option>Salaries</option><option>Electricity</option><option>Misc</option>
            </Select>
          </Field>
          <Field label="Amount (₦)"><Input type="number" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} /></Field>
        </div>
        <Field label="Note"><Input value={expNote} onChange={(e) => setExpNote(e.target.value)} placeholder="What was this for?" /></Field>
        <Field label="Paid By">
          <div style={{ display: "flex", gap: 16 }}>
            {["Cash", "Bank Transfer", "POS"].map((m) => (
              <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.text, cursor: "pointer" }}>
                <input type="radio" checked={expPaidBy === m} onChange={() => setExpPaidBy(m)} /> {m}
              </label>
            ))}
          </div>
        </Field>
        <Button variant="success" onClick={addExpense} disabled={!expAmount}><Plus size={14} /> Add Expense</Button>
        {pendingExpenses.length > 0 && (
          <div style={{ fontSize: 11.5, color: C.sub, marginTop: 8 }}>Today's expenses so far: <b style={{ color: C.text }}>{currency(pendingExpenseTotal)}</b></div>
        )}
      </Card>

      {/* Internal usage for the day */}
      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 10 }}>INTERNAL USAGE ({fmtDate(date)})</div>
        {pendingUsage.map((u) => (
          <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize: 12.5, color: C.text }}>{u.type} — {kgFmt(u.kg)}</div>
              <div style={{ fontSize: 10.5, color: C.faint }}>{u.remarks || "—"}{u.approvedBy ? ` · Approved by ${u.approvedBy}` : ""}</div>
            </div>
            <button onClick={() => removeUsage(u.id)} style={{ background: "none", border: "none", color: C.alert, cursor: "pointer" }}><X size={14} /></button>
          </div>
        ))}
        <div style={{ marginTop: pendingUsage.length ? 10 : 0 }}>
          <Field label="Type">
            <Select value={useType} onChange={(e) => setUseType(e.target.value)}>
              <option>Generator</option><option>Management</option><option>Free Issue</option>
            </Select>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Quantity (kg)"><Input type="number" value={useQty} onChange={(e) => setUseQty(e.target.value)} /></Field>
            <Field label={useType === "Free Issue" ? "Reason" : "Remarks"}><Input value={useNote} onChange={(e) => setUseNote(e.target.value)} /></Field>
          </div>
          {useType === "Free Issue" && (
            <Field label="Approved By"><Input value={useApprovedBy} onChange={(e) => setUseApprovedBy(e.target.value)} /></Field>
          )}
        </div>
        <Button variant="success" onClick={addUsage} disabled={!useQty}><Plus size={14} /> Add Usage</Button>
        {pendingUsage.length > 0 && (
          <div style={{ fontSize: 11.5, color: C.sub, marginTop: 8 }}>Today's usage so far: <b style={{ color: C.text }}>{kgFmt(pendingUsageKg)}</b></div>
        )}
      </Card>

      <Button full onClick={submit}>Save &amp; Close Day</Button>

      <div style={{ fontSize: 11, color: C.faint, textAlign: "center", marginTop: 10 }}>
        This Tank Total Kg Sold: <b style={{ color: C.text }}>{kgFmt(tankTotalKg)}</b>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Internal Usage — tabbed (Generator / Management / Free Issue)          */
/* ---------------------------------------------------------------------- */

function InternalUsagePage({ data, update, log, goto }) {
  const activeTank = data.tanks.find((t) => t.status === "ACTIVE");
  const [type, setType] = useState("Generator");
  const [qty, setQty] = useState("");
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");

  if (!activeTank) return <NoActiveTankNotice title="Internal Usage" goto={goto} />;

  const todayTotal = sum(activeTank.internalUsage.filter((u) => u.date === todayStr() && u.type === type), (u) => u.kg);
  const tankTotal = sum(activeTank.internalUsage.filter((u) => u.type === type), (u) => u.kg);

  function submit() {
    const entry = { id: uid(), date: todayStr(), type, kg: Number(qty) || 0, remarks: type === "Free Issue" ? reason : remarks, approvedBy: type === "Free Issue" ? approvedBy : "" };
    const tanks = data.tanks.map((t) => t.id === activeTank.id ? { ...t, internalUsage: [...t.internalUsage, entry] } : t);
    update({ ...data, tanks });
    log(`Internal usage recorded: ${kgFmt(entry.kg)} (${type})`);
    setQty(""); setRemarks(""); setReason(""); setApprovedBy("");
  }

  const iconFor = { Generator: PackageMinus, Management: Users, "Free Issue": Fuel };
  const Icon = iconFor[type];
  const label = { Generator: "Office Generator Usage", Management: "Director / Management Usage", "Free Issue": "Free Issue" }[type];
  const sub = { Generator: "Record LPG used for office generator", Management: "Record LPG issued to management", "Free Issue": "Record LPG given as free issue" }[type];

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title="Internal Usage" onBack={() => goto("dashboard")} />
      <Segmented
        options={[{ label: "Generator", value: "Generator" }, { label: "Management", value: "Management" }, { label: "Free Issue", value: "Free Issue" }]}
        value={type} onChange={setType}
      />
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0 16px" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: C.successSoft, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
            <Icon size={24} color={C.success} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{label}</div>
          <div style={{ fontSize: 11.5, color: C.sub, textAlign: "center" }}>{sub}</div>
        </div>
        <Field label="Quantity (kg)"><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        {type !== "Free Issue" && <Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>}
        {type === "Free Issue" && (
          <>
            <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Field label="Approved By"><Input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} /></Field>
          </>
        )}
        <Button variant="success" full onClick={submit} disabled={!qty}>Save</Button>
      </Card>
      <div style={{ display: "flex", gap: 10 }}>
        <StatTile label="Today's Total" value={kgFmt(todayTotal)} tone="success" />
        <StatTile label="This Tank Total" value={kgFmt(tankTotal)} tone="neutral" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Expense Entry                                                           */
/* ---------------------------------------------------------------------- */

function ExpensePage({ data, update, log, goto }) {
  const activeTank = data.tanks.find((t) => t.status === "ACTIVE");
  const [date, setDate] = useState(todayStr());
  const [category, setCategory] = useState("Fuel");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("Cash");

  if (!activeTank) return <NoActiveTankNotice title="Add Expense" goto={goto} />;

  const todayTotal = sum(activeTank.expenses.filter((e) => e.date === todayStr()), (e) => e.amount);
  const tankTotal = sum(activeTank.expenses, (e) => e.amount);

  function submit() {
    const entry = { id: uid(), date, category, note: description, amount: Number(amount) || 0, paidBy };
    const tanks = data.tanks.map((t) => t.id === activeTank.id ? { ...t, expenses: [...t.expenses, entry] } : t);
    update({ ...data, tanks });
    log(`Expense logged: ${currency(entry.amount)} (${category}, paid by ${paidBy})`);
    setDescription(""); setAmount("");
  }

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title="Add Expense" onBack={() => goto("dashboard")} />
      <Card style={{ marginBottom: 14 }}>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option>Fuel</option><option>Repairs</option><option>Salaries</option><option>Electricity</option><option>Misc</option>
          </Select>
        </Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Petrol for Generator" /></Field>
        <Field label="Amount (₦)"><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Paid By">
          <div style={{ display: "flex", gap: 16 }}>
            {["Cash", "Bank Transfer", "POS"].map((m) => (
              <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.text, cursor: "pointer" }}>
                <input type="radio" checked={paidBy === m} onChange={() => setPaidBy(m)} /> {m}
              </label>
            ))}
          </div>
        </Field>
        <Button variant="success" full onClick={submit} disabled={!amount}>Save Expense</Button>
      </Card>
      <div style={{ display: "flex", gap: 10 }}>
        <StatTile label="Today's Total Expense" value={currency(todayTotal)} tone="alert" />
        <StatTile label="This Tank Total" value={currency(tankTotal)} tone="neutral" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* LPG Purchase — dip-based (opening/closing stock)                       */
/* ---------------------------------------------------------------------- */

function PurchasePage({ data, update, log, goto }) {
  const activeTank = data.tanks.find((t) => t.status === "ACTIVE");
  const [date, setDate] = useState(todayStr());
  const [supplier, setSupplier] = useState(data.suppliers[0]?.name || "");
  const [tankNo, setTankNo] = useState("");
  const [opening, setOpening] = useState(activeTank ? String(tankMetrics(activeTank).remainingStock) : "0");
  const [closing, setClosing] = useState("");
  const [rate, setRate] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");

  const qtyKg = (Number(closing) || 0) - (Number(opening) || 0);
  const totalCost = qtyKg * (Number(rate) || 0);

  function submit() {
    if (qtyKg <= 0 || !rate) return;
    const entry = { id: uid(), date, supplier, openingStock: Number(opening) || 0, closingStockAfter: Number(closing) || 0, qtyKg, rate: Number(rate) || 0, amount: totalCost, invoiceNo };
    let tanks = [...data.tanks];
    if (activeTank) {
      tanks = tanks.map((t) => t.id === activeTank.id ? { ...t, purchases: [...t.purchases, entry] } : t);
      log(`Purchase added to Tank ${activeTank.tankNo}: ${kgFmt(qtyKg)} from ${supplier}`);
    } else {
      const id = uid();
      tanks.push({ id, tankNo: tankNo || `Tank ${data.tanks.length + 1}`, status: "ACTIVE", startDate: date, endDate: null, purchases: [entry], dailySales: [], internalUsage: [], expenses: [], closure: null });
      log(`New Active Tank ${tankNo || `Tank ${data.tanks.length}`} created from purchase of ${kgFmt(qtyKg)}`);
    }
    update({ ...data, tanks });
    goto("dashboard");
  }

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title="LPG Purchase" onBack={() => goto("dashboard")} />
      <Card>
        <Field label="Purchase Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Supplier">
          <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Select supplier</option>
            {data.suppliers.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          </Select>
        </Field>
        {!activeTank && <Field label="Tank"><Input value={tankNo} onChange={(e) => setTankNo(e.target.value)} placeholder="Tank 2" /></Field>}
        {activeTank && <Field label="Tank"><Input value={activeTank.tankNo} disabled /></Field>}
        <Field label="Opening Stock (kg)"><Input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
        <Field label="Closing Stock After Purchase (kg)"><Input type="number" value={closing} onChange={(e) => setClosing(e.target.value)} placeholder="3300" /></Field>

        <div style={{ background: C.primarySoft, borderRadius: 10, padding: "8px 12px", marginBottom: 12, display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
          <span style={{ color: C.sub }}>KG PURCHASED (Auto)</span><b style={{ color: C.primary }}>{kgFmt(qtyKg)}</b>
        </div>
        <Field label="Purchase Rate (₦/kg)"><Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        <div style={{ background: C.successSoft, borderRadius: 10, padding: "8px 12px", marginBottom: 12, display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
          <span style={{ color: C.sub }}>TOTAL COST (Auto)</span><b style={{ color: C.success }}>{currency(totalCost)}</b>
        </div>
        <Field label="Invoice / Receipt No."><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="INV/005/2025" /></Field>
        <Button full onClick={submit} disabled={qtyKg <= 0 || !rate || !supplier}>Save Purchase</Button>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* End Tank Confirmation                                                    */
/* ---------------------------------------------------------------------- */

function EndTankPage({ data, update, log, goto }) {
  const activeTank = data.tanks.find((t) => t.status === "ACTIVE");
  const [invTag, setInvTag] = useState("Meter Calibration");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);

  if (!activeTank) return <NoActiveTankNotice title="End Tank" goto={goto} />;
  const m = tankMetrics(activeTank);

  function closeTank() {
    const expectedKg = m.totalPurchasedKg; // physical dip assumed 0 at closure
    const accountedKg = m.totalKgSold;
    const variance = accountedKg - expectedKg;
    const varianceType = classifyVariance(variance);
    const closure = { closingPhysicalStock: 0, expectedKg, accountedKg, variance, varianceType, investigationTag: variance !== 0 ? invTag : null, note, closedAt: new Date().toISOString(), grossProfit: m.grossProfit, netProfit: m.netProfit, totalCost: m.totalCost, totalSalesAmount: m.totalSalesAmount, totalExpenses: m.totalExpenses };
    const tanks = data.tanks.map((t) => t.id === activeTank.id ? { ...t, status: "CLOSED", endDate: todayStr(), closure } : t);
    update({ ...data, tanks });
    log(`Tank ${activeTank.tankNo} CLOSED — ${varianceType} (${variance.toFixed(1)} kg), Net Profit ${currency(closure.netProfit)}`);
    goto("dashboard");
  }

  if (!confirming) {
    return (
      <div style={{ padding: "0 16px 16px" }}>
        <TopBar title="End Tank" onBack={() => goto("dashboard")} />
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Reconciliation Preview — {activeTank.tankNo}</div>
          <Row label="Purchased" value={kgFmt(m.totalPurchasedKg)} />
          <Row label="Total Kg Sold" value={kgFmt(m.totalKgSold)} />
          <Row label="Expected (Purchased − Dip)" value={kgFmt(m.totalPurchasedKg)} />
          <Row label="Variance (Preview)" value={kgFmt(m.totalKgSold - m.totalPurchasedKg)} strong />
          <Row label="Net Profit (unlocks on close)" value={currency(m.netProfit)} strong />
        </Card>
        <Field label="Investigation tag (used only if variance found)">
          <Select value={invTag} onChange={(e) => setInvTag(e.target.value)}>
            {["Meter Calibration", "Recording Error", "Leakage", "Pump Fault", "Unauthorized", "Recon Diff", "Misconduct", "Other"].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explanation for variance..." /></Field>
        <Button variant="alert" full onClick={() => setConfirming(true)}><Lock size={15} /> Proceed to End Tank</Button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.alertSoft, padding: "40px 22px" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 14 }}>
        <div style={{ width: 68, height: 68, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <AlertTriangle size={32} color={C.alert} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.alert }}>END TANK CONFIRMATION</div>
        <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6, maxWidth: 280 }}>
          Are you sure the physical dip reading in the storage tank is 0 kg? This action will close {activeTank.tankNo}
          permanently and generate the final reconciliation report.
        </div>
      </div>
      <Button variant="alert" full onClick={closeTank}>Yes, Confirm End Tank</Button>
      <Button variant="outline" full onClick={() => setConfirming(false)} style={{ marginTop: 10, background: "transparent" }}>Cancel</Button>
      <div style={{ fontSize: 11, color: C.sub, textAlign: "center", marginTop: 12 }}>This action cannot be undone.</div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Tank History (list + detail)                                            */
/* ---------------------------------------------------------------------- */

function HistoryPage({ data, goto }) {
  const [openId, setOpenId] = useState(null);
  const closed = data.tanks.filter((t) => t.status === "CLOSED").slice().reverse();
  const active = data.tanks.filter((t) => t.status === "ACTIVE");

  const detail = openId ? data.tanks.find((t) => t.id === openId) : null;
  if (detail) return <TankDetail tank={detail} onBack={() => setOpenId(null)} />;

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title="Tank History" onBack={() => goto("dashboard")} />
      {active.map((t) => (
        <Card key={t.id} style={{ marginBottom: 10 }} onClick={() => setOpenId(t.id)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{t.tankNo}</div>
            <Badge tone="success">ACTIVE</Badge>
          </div>
        </Card>
      ))}
      {closed.length === 0 && active.length === 0 && <Card><div style={{ color: C.faint, fontSize: 13, textAlign: "center", padding: "16px 0" }}>No tanks yet.</div></Card>}
      {closed.map((t) => (
        <div key={t.id} onClick={() => setOpenId(t.id)} style={{ cursor: "pointer" }}>
          <Card style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{t.tankNo}</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>{fmtDate(t.startDate)} – {fmtDate(t.endDate)}</div>
              </div>
              <Badge tone="neutral">CLOSED</Badge>
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

function TankDetail({ tank, onBack }) {
  const m = tankMetrics(tank);
  const c = tank.closure;
  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title={`${tank.tankNo}`} onBack={onBack} right={c ? <Badge tone="neutral">CLOSED</Badge> : <Badge tone="success">ACTIVE</Badge>} />
      <Card style={{ marginBottom: 14 }}>
        <Row label="Tank Number" value={tank.tankNo} />
        <Row label="Supplier" value={tank.purchases[0]?.supplier || "—"} />
        <Row label="Purchase Date" value={fmtDate(tank.purchases[0]?.date || tank.startDate)} />
        <Row label="Date Started Selling" value={fmtDate(tank.startDate)} />
        {tank.endDate && <Row label="Date Finished Selling" value={fmtDate(tank.endDate)} />}
        <Row label="Quantity Purchased" value={kgFmt(m.totalPurchasedKg)} />
        <Row label="Purchase Rate" value={currency(tank.purchases[0]?.rate || 0) + "/kg"} />
        <Row label="Purchase Amount" value={currency(m.totalCost)} />
        <Row label="Total Kg Sold" value={kgFmt(m.totalKgSold)} />
        <Row label="Paid KG (After Usage)" value={kgFmt(m.paidKg)} />
        <Row label="Generator Usage" value={kgFmt(sum(tank.internalUsage.filter(u => u.type === "Generator"), u => u.kg))} />
        <Row label="Director / Mgmt Usage" value={kgFmt(sum(tank.internalUsage.filter(u => u.type === "Management"), u => u.kg))} />
        <Row label="Other Free Issues" value={kgFmt(sum(tank.internalUsage.filter(u => u.type === "Free Issue"), u => u.kg))} />
        {c && <Row label={c.variance < 0 ? "Shortage" : "Overage"} value={kgFmt(Math.abs(c.variance))} strong />}
        {c && <Row label="Gross Profit" value={currency(c.grossProfit)} strong />}
        {c && <Row label="Net Profit" value={currency(c.netProfit)} strong />}
      </Card>
      <div style={{ display: "flex", gap: 10 }}>
        <Button variant="outline" full onClick={() => downloadCSV(`${tank.tankNo}-report.csv`, m.dailyRows)}><FileSpreadsheet size={14} /> Export Excel</Button>
        <Button full onClick={() => window.print()}><Download size={14} /> Export PDF</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Audit Report / Variance Summary                                         */
/* ---------------------------------------------------------------------- */

function AuditPage({ data, goto }) {
  const closed = data.tanks.filter((t) => t.status === "CLOSED" && t.closure).slice().reverse();
  const [filter, setFilter] = useState("All");
  const filtered = filter === "All" ? closed : closed.filter((t) => varianceTone(t.closure.varianceType) === filter);

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title="Audit Report" onBack={() => goto("dashboard")} />
      <ListTable
        columns={[
          { key: "tank", label: "Tank", render: (r) => r.tankNo },
          { key: "date", label: "Date Closed", render: (r) => fmtDate(r.endDate) },
          { key: "variance", label: "Variance", render: (r) => kgFmt(Math.abs(r.closure.variance)) },
          { key: "status", label: "Status", render: (r) => <Badge tone={varianceTone(r.closure.varianceType)}>{r.closure.varianceType.replace(" - Investigate", "").replace("High Variance", "High")}</Badge> },
          { key: "reason", label: "Reason", render: (r) => r.closure.investigationTag || "—" },
        ]}
        rows={filtered}
        empty="No closed tanks yet."
      />
      <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 14 }}>
        <LegendChip tone="success" label="Normal" range="0–5 kg" />
        <LegendChip tone="warn" label="Review" range="5.1–20 kg" />
        <LegendChip tone="alert" label="High" range="> 20 kg" />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="outline" full onClick={() => downloadCSV("audit-report.csv", filtered.map(t => ({ tank: t.tankNo, dateClosed: t.endDate, variance: t.closure.variance, status: t.closure.varianceType, reason: t.closure.investigationTag || "" })))}>Export Excel</Button>
        <Button variant="outline" full onClick={() => window.print()}>Export PDF</Button>
        <Button full onClick={() => window.print()}><Printer size={14} /></Button>
      </div>
    </div>
  );
}
function LegendChip({ tone, label, range }) {
  const t = toneColors(tone);
  return (
    <div style={{ flex: 1, background: t.bg, borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: t.fg }}>{label}</div>
      <div style={{ fontSize: 9.5, color: C.sub }}>{range}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Reports                                                                  */
/* ---------------------------------------------------------------------- */

function ReportsPage({ data, goto }) {
  const [tab, setTab] = useState("sales");
  const tabs = [
    { key: "sales", label: "Sales" }, { key: "purchases", label: "Purchases" },
    { key: "expenses", label: "Expenses" }, { key: "profit", label: "Profit" },
  ];
  const salesRows = data.tanks.flatMap((t) => tankMetrics(t).dailyRows.map((r) => ({ tank: t.tankNo, date: r.date, price: r.price, paidKg: r.paidKgDay, salesAmt: r.salesAmountDay, realized: r.realizedDay, shortOver: r.shortOverDay })));
  const purchaseRows = data.tanks.flatMap((t) => t.purchases.map((p) => ({ tank: t.tankNo, date: p.date, supplier: p.supplier, qtyKg: p.qtyKg, amount: p.amount })));
  const expenseRows = data.tanks.flatMap((t) => t.expenses.map((e) => ({ tank: t.tankNo, date: e.date, category: e.category, amount: e.amount, paidBy: e.paidBy })));
  const profitRows = data.tanks.filter((t) => t.status === "CLOSED").map((t) => { const m = tankMetrics(t); return { tank: t.tankNo, cost: m.totalCost, sales: m.totalSalesAmount, expenses: m.totalExpenses, gross: m.grossProfit, net: m.netProfit }; });

  const view = { sales: salesRows, purchases: purchaseRows, expenses: expenseRows, profit: profitRows }[tab];
  const cols = {
    sales: [{ key: "tank", label: "Tank" }, { key: "date", label: "Date" }, { key: "paidKg", label: "Paid KG", render: r => kgFmt(r.paidKg) }, { key: "salesAmt", label: "Sales", render: r => currency(r.salesAmt) }, { key: "shortOver", label: "Short/Over", render: r => currency(r.shortOver) }],
    purchases: [{ key: "tank", label: "Tank" }, { key: "date", label: "Date" }, { key: "supplier", label: "Supplier" }, { key: "qtyKg", label: "Qty", render: r => kgFmt(r.qtyKg) }, { key: "amount", label: "Amount", render: r => currency(r.amount) }],
    expenses: [{ key: "tank", label: "Tank" }, { key: "date", label: "Date" }, { key: "category", label: "Category" }, { key: "amount", label: "Amount", render: r => currency(r.amount) }, { key: "paidBy", label: "Paid By" }],
    profit: [{ key: "tank", label: "Tank" }, { key: "gross", label: "Gross", render: r => currency(r.gross) }, { key: "net", label: "Net", render: r => currency(r.net) }],
  }[tab];

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title="Reports" onBack={() => goto("dashboard")} />
      <Segmented options={tabs} value={tab} onChange={setTab} />
      <Card style={{ marginBottom: 12 }}><ListTable columns={cols} rows={view} /></Card>
      <Button full variant="outline" onClick={() => downloadCSV(`${tab}-report.csv`, view)} disabled={!view.length}><Download size={14} /> Export CSV</Button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Moniepoint Log — full replica of terminal transaction history          */
/* ---------------------------------------------------------------------- */

function MoniepointLogPage({ goto }) {
  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setRows(null);
      const { data, error: fetchError } = await supabase
        .from("pos_transactions")
        .select("*")
        .gte("transaction_time", `${date}T00:00:00`)
        .lte("transaction_time", `${date}T23:59:59`)
        .order("transaction_time", { ascending: false });
      if (cancelled) return;
      if (fetchError) { setError(fetchError.message); setRows([]); return; }
      setError("");
      setRows(data || []);
    }
    load();

    const channel = supabase
      .channel(`pos_log_${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_transactions" }, () => load())
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [date]);

  const total = rows ? sum(rows, (r) => r.amount) : 0;

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title="Moniepoint Log" onBack={() => goto("more")} />
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <StatTile label="Transactions" value={rows ? rows.length : "…"} tone="primary" />
        <StatTile label="Total" value={currency(total)} tone="success" />
      </div>

      {error && (
        <Card style={{ marginBottom: 12, background: C.alertSoft, border: "none" }}>
          <div style={{ color: C.alert, fontSize: 12.5 }}>{error}</div>
        </Card>
      )}

      <Card>
        {rows === null && <div style={{ color: C.faint, fontSize: 13, textAlign: "center", padding: "16px 0" }}>Loading...</div>}
        {rows && rows.length === 0 && <div style={{ color: C.faint, fontSize: 13, textAlign: "center", padding: "16px 0" }}>No Moniepoint transactions for this date.</div>}
        {rows && rows.map((r) => (
          <div key={r.transaction_reference} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{currency(r.amount)}</div>
              <div style={{ fontSize: 11, color: C.faint }}>
                {r.transaction_time ? new Date(r.transaction_time).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }) : "—"}
                {r.terminal_serial ? ` · ${r.terminal_serial}` : ""}
              </div>
            </div>
            <Badge tone={r.status === "APPROVED" || r.status === "SUCCESSFUL" ? "success" : "neutral"}>{r.status || r.transaction_type || "—"}</Badge>
          </div>
        ))}
      </Card>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.6 }}>
        This is a live mirror of your Moniepoint terminal — every confirmed transaction lands here
        automatically via webhook, the same total that auto-fills Daily Sales for that date.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Directory (Suppliers / Customers) + Settings                            */
/* ---------------------------------------------------------------------- */

function DirectoryPage({ title, items, addItem, goto }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [note, setNote] = useState("");
  function submit() { if (!name.trim()) return; addItem({ id: uid(), name: name.trim(), phone, note }); setName(""); setPhone(""); setNote(""); }
  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title={title} onBack={() => goto("more")} />
      <Card style={{ marginBottom: 14 }}>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button full onClick={submit} disabled={!name.trim()}><Plus size={14} /> Add</Button>
      </Card>
      <Card><ListTable columns={[{ key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "note", label: "Note" }]} rows={items.slice().reverse()} /></Card>
    </div>
  );
}

function SettingsPage({ data, update, log, goto }) {
  const [name, setName] = useState(data.settings.businessName);
  const [price, setPrice] = useState(data.settings.defaultPricePerKg);
  function save() { update({ ...data, settings: { ...data.settings, businessName: name, defaultPricePerKg: Number(price) || 0 } }); log("Settings updated"); }
  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title="Settings" onBack={() => goto("more")} />
      <Card>
        <Field label="Business name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Default selling price / kg (₦)"><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Button full onClick={save}>Save Settings</Button>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 14, lineHeight: 1.6 }}>
          User accounts with real passwords need a backend — flag it if you want that built next.
        </div>
      </Card>
    </div>
  );
}

function MorePage({ session, data, goto, onLogout }) {
  const items = [
    { key: "suppliers", label: "Suppliers", icon: Truck },
    { key: "customers", label: "Customers", icon: Users },
    { key: "audit", label: "Audit Report", icon: ShieldAlert },
    { key: "reports", label: "Reports", icon: FileBarChart2 },
    { key: "history", label: "Tank History", icon: Archive },
    { key: "moniepointLog", label: "Moniepoint Log", icon: Wallet },
  ];
  if (session.role === "Owner") {
    items.push({ key: "users", label: "Manage Users", icon: UserCog });
    items.push({ key: "settings", label: "Settings", icon: SettingsIcon });
  }
  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title="More" />
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: C.text }}>{session.name}</div>
        <div style={{ fontSize: 12, color: C.sub }}>{session.role}</div>
      </Card>
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <button key={it.key} onClick={() => goto(it.key)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8, cursor: "pointer" }}>
            <Icon size={17} color={C.primary} /><span style={{ fontSize: 13.5, color: C.text, fontWeight: 500 }}>{it.label}</span>
          </button>
        );
      })}
      <button onClick={onLogout} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: C.alertSoft, border: "none", borderRadius: 12, padding: "12px 14px", marginTop: 8, cursor: "pointer" }}>
        <LogOut size={17} color={C.alert} /><span style={{ fontSize: 13.5, color: C.alert, fontWeight: 600 }}>Log out</span>
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Manage Users (Owner only)                                               */
/* ---------------------------------------------------------------------- */

function ManageUsersPage({ goto, session }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: fetchError } = await supabase.from("profiles").select("*").order("name");
      if (cancelled) return;
      if (fetchError) setError(fetchError.message);
      else setUsers(data || []);
    })();
    return () => { cancelled = true; };
  }, []);

  async function changeRole(userId, newRole) {
    setSavingId(userId);
    const { error: updateError } = await supabase.from("profiles").update({ role: newRole }).eq("id", userId);
    if (updateError) {
      setError(updateError.message);
    } else {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    }
    setSavingId(null);
  }

  return (
    <div style={{ padding: "0 16px 16px" }}>
      <TopBar title="Manage Users" onBack={() => goto("more")} />
      {error && (
        <Card style={{ marginBottom: 12, background: C.alertSoft, border: "none" }}>
          <div style={{ color: C.alert, fontSize: 12.5 }}>{error}</div>
        </Card>
      )}
      {users === null && <Card><div style={{ color: C.faint, fontSize: 13, textAlign: "center", padding: "16px 0" }}>Loading users...</div></Card>}
      {users && users.length === 0 && <Card><div style={{ color: C.faint, fontSize: 13, textAlign: "center", padding: "16px 0" }}>No users found.</div></Card>}
      {users && users.map((u) => (
        <Card key={u.id} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: u.id === session.id ? 0 : 10 }}>
            <div>
              <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{u.name || "(no name)"}</div>
              {u.id === session.id && <div style={{ fontSize: 11, color: C.faint }}>This is you</div>}
            </div>
            <Badge tone={u.role === "Owner" ? "primary" : u.role === "Manager" ? "warn" : "neutral"}>{u.role}</Badge>
          </div>
          {u.id !== session.id && (
            <Select value={u.role} disabled={savingId === u.id} onChange={(e) => changeRole(u.id, e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          )}
        </Card>
      ))}
      <div style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.6 }}>
        New accounts always start as Cashier. Upgrade someone to Manager or Owner here once they've signed up.
        You can't change your own role — ask another Owner if you need that changed.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* App shell                                                                */
/* ---------------------------------------------------------------------- */

const NAV_BY_ROLE = {
  Cashier: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "dailySales", label: "Daily Sales", icon: Wallet },
    { key: "more", label: "More", icon: MoreHorizontal },
  ],
  Manager: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "activeTank", label: "Active Tank", icon: Fuel },
    { key: "reports", label: "Reports", icon: FileBarChart2 },
    { key: "more", label: "More", icon: MoreHorizontal },
  ],
  Owner: [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "history", label: "Tanks", icon: Archive },
    { key: "reports", label: "Reports", icon: FileBarChart2 },
    { key: "more", label: "More", icon: MoreHorizontal },
  ],
};

export default function App() {
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [data, setData] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);

  // Restore session on load/refresh, and react to sign-outs from elsewhere (e.g. token expiry)
  useEffect(() => {
    let cancelled = false;

    async function loadFromAuthUser(user) {
      const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (cancelled) return;
      if (profile) setSession({ id: user.id, name: profile.name, role: profile.role, email: user.email });
      else setSession(null);
    }

    (async () => {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (authSession?.user) await loadFromAuthUser(authSession.user);
      if (!cancelled) setAuthChecked(true);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, authSession) => {
      if (!authSession?.user) {
        setSession(null);
      } else {
        loadFromAuthUser(authSession.user);
      }
    });

    return () => { cancelled = true; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY, true);
        if (!cancelled) setData(res ? JSON.parse(res.value) : DEFAULT_DATA);
      } catch (e) {
        if (!cancelled) setData(DEFAULT_DATA);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Live sync: pick up changes saved by other users/devices without a refresh
  useEffect(() => {
    const channel = supabase
      .channel("erp_store_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "erp_store", filter: `id=eq.${STORAGE_KEY}` },
        (payload) => {
          if (payload.new && payload.new.value) {
            try { setData(JSON.parse(payload.new.value)); } catch (e) { /* ignore malformed payload */ }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function update(next) {
    setData(next);
    try {
      const res = await storage.set(STORAGE_KEY, JSON.stringify(next), true);
      setSaveError(!res);
    } catch (e) { setSaveError(true); }
  }
  function log(text) {
    setData((prev) => {
      const next = { ...prev, activityLog: [...prev.activityLog, { at: new Date().toLocaleString("en-NG", { hour12: true, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), text }] };
      storage.set(STORAGE_KEY, JSON.stringify(next), true).catch(() => setSaveError(true));
      return next;
    });
  }
  function goto(key) { setPage(key); }
  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setPage("dashboard");
  }

  const phoneFrame = { width: 393, minHeight: 852, background: "#fff", borderRadius: 44, overflow: "hidden", boxShadow: "0 24px 70px rgba(17,24,39,0.22)", border: "8px solid #111827", display: "flex", flexDirection: "column", position: "relative" };
  const outer = { minHeight: "100vh", background: C.bgAlt, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", fontFamily: FONT };

  if (loading || !data || !authChecked) {
    return (
      <div style={outer}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'); *{box-sizing:border-box;}`}</style>
        <div style={{ ...phoneFrame, alignItems: "center", justifyContent: "center", color: C.sub }}>Loading ERP...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={outer}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'); *{box-sizing:border-box;}`}</style>
        <div style={phoneFrame}><StatusBar /><LoginScreen onAuthed={setSession} /></div>
      </div>
    );
  }

  const nav = NAV_BY_ROLE[session.role];
  const pageProps = { data, update, log, session, goto };

  const homeByRole = {
    Cashier: <CashierDashboard {...pageProps} />,
    Manager: <ManagerDashboard {...pageProps} />,
    Owner: <OwnerDashboard {...pageProps} />,
  };

  const pages = {
    dashboard: homeByRole[session.role],
    dailySales: <DailySalesPage {...pageProps} />,
    activeTank: <ActiveTankPage {...pageProps} />,
    internalUsage: <InternalUsagePage {...pageProps} />,
    expense: <ExpensePage {...pageProps} />,
    purchase: <PurchasePage {...pageProps} />,
    endTank: <EndTankPage {...pageProps} />,
    history: <HistoryPage {...pageProps} />,
    audit: <AuditPage {...pageProps} />,
    reports: <ReportsPage {...pageProps} />,
    suppliers: <DirectoryPage title="Suppliers" items={data.suppliers} addItem={(item) => update({ ...data, suppliers: [...data.suppliers, item] })} goto={goto} />,
    customers: <DirectoryPage title="Customers" items={data.customers} addItem={(item) => update({ ...data, customers: [...data.customers, item] })} goto={goto} />,
    settings: <SettingsPage {...pageProps} />,
    users: <ManageUsersPage goto={goto} session={session} />,
    moniepointLog: <MoniepointLogPage goto={goto} />,
    more: <MorePage session={session} data={data} goto={goto} onLogout={handleLogout} />,
  };

  const showBottomNav = ["dashboard", "reports", "audit", "history", "more", "users", "dailySales", "activeTank"].includes(page);

  return (
    <div style={outer}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:0;height:0;}
      `}</style>
      <div style={phoneFrame}>
        <StatusBar />
        <div style={{ flex: 1, overflowY: "auto" }}>
          {saveError && (
            <div style={{ margin: "0 16px 12px", background: C.alertSoft, color: C.alert, padding: "8px 12px", borderRadius: 10, fontSize: 11.5 }}>
              Last save didn't sync — check your connection.
            </div>
          )}
          {pages[page]}
        </div>
        {showBottomNav && <BottomNav items={nav} active={page === "settings" || page === "suppliers" || page === "customers" || page === "users" ? "more" : page} onChange={goto} />}
      </div>
    </div>
  );
}
