import { useState, useEffect, useRef, useCallback } from "react";
import { Routes, Route, useNavigate, useParams, useLocation, Link } from "react-router-dom";
import { supabase } from "./supabaseClient.js";
import { ensureSession, restorePurchases } from "./entitlement.js";
import QRCode from "qrcode";
import { BASES, MILK, SUGAR, STRENGTH, TEMP, defaultSel, buildName, parseName, genCode } from "./menu.js";

/* ============================ Kopitiam palette ============================ */
const C = {
  cream: "#F0E2C6", paper: "#FBF5E7", paperDeep: "#F5ECD6", ink: "#2C1A0E",
  coffee: "#4A2A18", coffeeMid: "#7A4A2E", green: "#1E6B4F", greenDark: "#114a36",
  red: "#B23A2E", orange: "#D9772E", gold: "#C99A3E", line: "rgba(44,26,14,0.14)",
};

/* ============================ Toast hook ============================ */
function useToast() {
  const [toast, setToast] = useState("");
  const t = useRef(null);
  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(t.current);
    t.current = setTimeout(() => setToast(""), 1800);
  }, []);
  return [toast, flash];
}

/* ============================ Local organizer token ============================ */
const orgKey = (code) => `kopirun:org:${code}`;
const saveOrgToken = (code, token) => {
  try { localStorage.setItem(orgKey(code), token); } catch {}
};
const getOrgToken = (code) => {
  try { return localStorage.getItem(orgKey(code)); } catch { return null; }
};

/* ============================ Items this device added ============================ */
// We don't have logins, so "mine" is tracked locally: the ids of items added
// from this device. Used to decide who may edit/delete a drink (plus organizer).
const mineKey = (code) => `kopirun:mine:${code}`;
const getMine = (code) => {
  try {
    const raw = localStorage.getItem(mineKey(code));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};
const addMine = (code, id) => {
  try {
    const list = getMine(code);
    if (!list.includes(id)) list.push(id);
    localStorage.setItem(mineKey(code), JSON.stringify(list));
    return list;
  } catch { return getMine(code); }
};
const removeMine = (code, id) => {
  try {
    const list = getMine(code).filter((x) => x !== id);
    localStorage.setItem(mineKey(code), JSON.stringify(list));
    return list;
  } catch { return getMine(code); }
};

/* ============================ Remembered name (device convenience) ============================ */
const NAME_KEY = "kopirun:name";
const getSavedName = () => {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
};
const saveName = (name) => {
  try { localStorage.setItem(NAME_KEY, name); } catch {}
};

/* ============================ Per-device drink history ============================ */
// Stored only on this device. Each entry: { drink, notes, baseId, sel, at }.
const HISTORY_KEY = "kopirun:history";
const HISTORY_MAX = 3;

const getHistory = () => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};
// Add a drink to this device's history, de-duplicated by drink+notes, newest first, capped.
const pushHistory = (entry) => {
  try {
    const key = `${entry.drink}|${entry.notes || ""}`;
    const rest = getHistory().filter((e) => `${e.drink}|${e.notes || ""}` !== key);
    const list = [{ ...entry, at: Date.now() }, ...rest].slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    return list;
  } catch { return getHistory(); }
};

/* ============================ App / Router ============================ */
export default function App() {
  // Dormant paywall bootstrap: gives every visitor a Supabase session (so a
  // trial clock exists once the paywall is turned on) and silently re-links
  // any existing Play purchase after a reinstall. No UI effect while
  // public.config.paywall_enabled stays false — see src/entitlement.js.
  useEffect(() => {
    ensureSession().then(() => restorePurchases()).catch(() => {});
  }, []);

  return (
    <div style={pageStyle}>
      <style>{css}</style>
      <div style={{ width: "100%", maxWidth: 480, margin: "0 auto", padding: "0 18px 60px" }}>
        <Brand />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/order/:code" element={<OrderPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <footer style={{ textAlign: "center", marginTop: 22, font: "500 11px/1.5 'DM Sans'", color: C.coffeeMid }}>
          Share the order link with your kaki — everyone sees the same live order.
          <div style={{ marginTop: 6 }}>Developer: CatStackDev</div>
        </footer>
      </div>
    </div>
  );
}

/* ============================ Home ============================ */
function Home() {
  const navigate = useNavigate();
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setErr("");
    if (!newName.trim()) return setErr("Give your kopi run a name first.");
    setBusy(true);
    try {
      const code = genCode();
      const token = crypto.randomUUID();
      const { error } = await supabase
        .from("orders")
        .insert({ code, name: newName.trim(), organizer_token: token });
      if (error) throw error;
      saveOrgToken(code, token);
      navigate(`/order/${code}`, { state: { justCreated: true } });
    } catch (e) {
      setErr("Couldn't create the order. Check your Supabase setup and try again.");
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function joinWithCode(codeInput) {
    setErr("");
    const code = codeInput.trim().toUpperCase();
    if (code.length < 4) return setErr("Enter the full order code.");
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("orders").select("code").eq("code", code).maybeSingle();
      if (error) throw error;
      if (!data) setErr("No order found for that code.");
      else navigate(`/order/${code}`);
    } catch (e) {
      setErr("Couldn't join. Try again.");
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  function handleJoin() { return joinWithCode(joinCode); }

  const [scanning, setScanning] = useState(false);
  const canScan = typeof window !== "undefined" && "BarcodeDetector" in window;

  function handleScanned(text) {
    setScanning(false);
    const match = text.match(/\/order\/([A-Za-z0-9]+)/);
    joinWithCode(match ? match[1] : text);
  }

  return (
    <>
      <div style={cardStyle}>
        <SectionTitle>Start a run</SectionTitle>
        <p style={subText}>Create an order, then share the link with everyone joining the dabao.</p>
        <input className="kr-input" placeholder='e.g. "Monday morning kopi"'
          value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="kr-add" onClick={handleCreate} disabled={busy}>
          {busy ? "Creating…" : "Create order"}
        </button>
      </div>

      <div style={cardStyle}>
        <SectionTitle>Join a run</SectionTitle>
        <p style={subText}>Got a code from a friend? Punch it in.</p>
        <input className="kr-input" placeholder="Order code"
          value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          style={{ letterSpacing: ".24em", fontWeight: 700, textTransform: "uppercase" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="kr-add" style={{ background: C.green, flex: 1 }} onClick={handleJoin} disabled={busy}>
            {busy ? "Joining…" : "Join order"}
          </button>
          {canScan && (
            <button className="kr-ghost" onClick={() => setScanning(true)} disabled={busy}>
              Scan QR
            </button>
          )}
        </div>
      </div>

      {err && <div style={errStyle}>{err}</div>}

      {scanning && <QrScanner onClose={() => setScanning(false)} onDecode={handleScanned} />}
    </>
  );
}

/* ============================ Order page ============================ */
function OrderPage() {
  const { code: rawCode } = useParams();
  const code = (rawCode || "").toUpperCase();
  const navigate = useNavigate();
  const location = useLocation();
  const [toast, flash] = useToast();
  const [showShare, setShowShare] = useState(false);

  // If we just landed here from "Create order", pop the share dialog once.
  useEffect(() => {
    if (location.state?.justCreated) {
      setShowShare(true);
      window.history.replaceState({}, document.title); // so a refresh won't reopen it
    }
  }, [location.state]);

  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | notfound
  const [myName, setMyName] = useState(getSavedName());
  const [baseId, setBaseId] = useState("kopi");
  const [sel, setSel] = useState(defaultSel());
  const [notes, setNotes] = useState("");
  // Ordering on someone else's behalf: when forOther is on, the drink is
  // added under otherName instead of myName.
  const [forOther, setForOther] = useState(false);
  const [otherName, setOtherName] = useState("");

  // Per-device history: list of { drink, notes, baseId, sel }
  const [history, setHistory] = useState(getHistory());

  // Ids of items added from this device — drives edit/delete permissions.
  const [mine, setMine] = useState(() => getMine(code));
  // Inline editing state for a single item. The drink is edited through the
  // same pill builder as the Add card, so we keep structured baseId + sel.
  const [editId, setEditId] = useState(null);
  const [editBaseId, setEditBaseId] = useState("kopi");
  const [editSel, setEditSel] = useState(defaultSel());
  const [editNotes, setEditNotes] = useState("");
  const [editPerson, setEditPerson] = useState("");
  // Id of the item awaiting a delete confirmation.
  const [confirmId, setConfirmId] = useState(null);
  // Item chosen via "Same" in the order-so-far list — drives the SameModal.
  const [sameItem, setSameItem] = useState(null);
  // Pending name-required prompt: { title, onConfirm(name) } or null.
  const [nameModal, setNameModal] = useState(null);

  const base = BASES.find((b) => b.id === baseId);
  const isOrganizer = !!getOrgToken(code);
  const canManage = (it) => !order?.closed && (isOrganizer || mine.includes(it.id));

  const fetchItems = useCallback(async (orderId) => {
    const { data } = await supabase
      .from("items").select("*").eq("order_id", orderId).order("created_at", { ascending: true });
    setItems(data || []);
  }, []);

  // Load order + items, then subscribe to realtime changes
  useEffect(() => {
    let channel;
    (async () => {
      setStatus("loading");
      const { data: ord, error } = await supabase
        .from("orders").select("id, code, name, closed, created_at").eq("code", code).maybeSingle();
      if (error || !ord) { setStatus("notfound"); return; }
      setOrder(ord);
      setStatus("ready");
      await fetchItems(ord.id);

      channel = supabase
        .channel(`order-${ord.id}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "items", filter: `order_id=eq.${ord.id}` },
          () => fetchItems(ord.id))
        .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${ord.id}` },
          (payload) => setOrder((o) => ({ ...o, ...payload.new })))
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [code, fetchItems]);

  // Restore a past drink into the builder.
  function pickFromHistory(entry) {
    if (entry.baseId && BASES.some((b) => b.id === entry.baseId)) {
      setBaseId(entry.baseId);
      setSel({ ...defaultSel(), ...entry.sel });
    }
    setNotes(entry.notes || "");
    flash("Loaded — tap Add to confirm");
  }

  // Shared insert logic used by the main builder, the "Same as" modal, and
  // the name-required modal once a name has been supplied.
  async function addItem({ baseId: bId, sel: s, notes: n, person, forOther: fo }) {
    if (!order || order.closed) return false;
    const b = BASES.find((x) => x.id === bId);
    if (b.mods.includes("custom") && !s.custom.trim()) { flash("Type your drink first"); return false; }
    const drink = buildName(b, s);
    const cleanNotes = n.trim();
    const { data, error } = await supabase
      .from("items").insert({ order_id: order.id, person, drink, notes: cleanNotes })
      .select("id").single();
    if (error) { flash("Couldn't add — try again"); console.error(error); return false; }
    // Remember this drink as "mine" so it shows edit/delete controls — even
    // for drinks placed on someone else's behalf, since the recipient may
    // never open the app themselves.
    if (data?.id) setMine(addMine(code, data.id));
    if (!fo) {
      saveName(person);
      // Only self-orders go into this device's private history, so someone
      // else's drink doesn't pollute the quick-picks.
      setHistory(pushHistory({ drink, notes: cleanNotes, baseId: bId, sel: s }));
    }
    flash(`${drink} added${fo ? ` for ${person}` : ""}`);
    fetchItems(order.id);
    return true;
  }

  async function handleAdd() {
    if (!order || order.closed) return;
    if (base.mods.includes("custom") && !sel.custom.trim()) return flash("Type your drink first");
    if (forOther && !otherName.trim()) {
      // They're ordering for someone else but forgot the name — ask for it
      // in a modal instead of just toasting, so they don't lose the drink
      // they just built.
      setNameModal({
        title: "Who's this drink for?",
        onConfirm: async (name) => {
          setNameModal(null);
          const ok = await addItem({ baseId, sel, notes, person: name, forOther: true });
          if (ok) { setNotes(""); setOtherName(""); setForOther(false); }
        },
      });
      return;
    }
    if (!forOther && !myName.trim()) return flash("Enter your name first");
    const person = forOther ? otherName.trim() : myName.trim();
    const ok = await addItem({ baseId, sel, notes, person, forOther });
    if (ok) { setNotes(""); setOtherName(""); setForOther(false); }
  }

  // "Same" in the order-so-far list opens a focused modal to add that drink
  // right away, instead of loading it into the builder up top.
  async function handleSameAdd({ baseId: bId, sel: s, notes: n, forOther: fo, name, otherName: on }) {
    if (fo && !on.trim()) {
      setNameModal({
        title: "Who's this drink for?",
        onConfirm: async (nm) => {
          setNameModal(null);
          const ok = await addItem({ baseId: bId, sel: s, notes: n, person: nm, forOther: true });
          if (ok) setSameItem(null);
        },
      });
      return;
    }
    if (!fo && !name.trim()) return flash("Enter your name first");
    const person = fo ? on.trim() : name.trim();
    const ok = await addItem({ baseId: bId, sel: s, notes: n, person, forOther: fo });
    if (ok) setSameItem(null);
  }

  function startEdit(it) {
    setConfirmId(null);
    const { baseId, sel } = parseName(it.drink);
    setEditId(it.id);
    setEditBaseId(baseId);
    setEditSel(sel);
    setEditNotes(it.notes || "");
    setEditPerson(it.person);
  }

  function cancelEdit() {
    setEditId(null);
    setEditNotes("");
    setEditPerson("");
  }

  async function handleSaveEdit(it) {
    const editBase = BASES.find((b) => b.id === editBaseId);
    if (editBase.mods.includes("custom") && !editSel.custom.trim()) return flash("Type your drink first");
    const drink = buildName(editBase, editSel);
    const person = editPerson.trim();
    if (!person) return flash("Name can't be empty");
    const { error } = await supabase
      .from("items")
      .update({ drink, person, notes: editNotes.trim() })
      .eq("id", it.id);
    if (error) { flash("Couldn't save — try again"); console.error(error); return; }
    cancelEdit();
    flash("Order updated");
    fetchItems(order.id);
  }

  async function handleDelete(it) {
    const { error } = await supabase.from("items").delete().eq("id", it.id);
    if (error) { flash("Couldn't remove — try again"); console.error(error); return; }
    setMine(removeMine(code, it.id));
    setConfirmId(null);
    flash("Drink removed");
    fetchItems(order.id);
  }

  async function handleClose() {
    const token = getOrgToken(code);
    if (!token || !order) return;
    const { error } = await supabase.rpc("close_order", { p_code: code, p_token: token });
    if (error) { flash("Couldn't close — try again"); console.error(error); return; }
    setOrder((o) => ({ ...o, closed: true }));
    flash("Order closed");
  }

  function copy(text, label) {
    try { navigator.clipboard.writeText(text); flash(label || "Copied"); }
    catch { flash("Copy not available"); }
  }

  if (status === "loading") return <div style={{ ...cardStyle, textAlign: "center", color: C.coffeeMid }}>Loading order…</div>;
  if (status === "notfound") return <NotFound />;

  const shareLink = `${window.location.origin}/order/${code}`;
  const tally = {};
  items.forEach((it) => {
    const key = it.drink + (it.notes ? ` (${it.notes})` : "");
    tally[key] = (tally[key] || 0) + 1;
  });
  const grouped = Object.entries(tally).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <SmartAppBanner code={code} />

      {/* header */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ font: "800 22px/1.1 'Fraunces'", color: C.ink, wordBreak: "break-word" }}>{order.name}</div>
            <div style={{ font: "500 12px/1 'DM Sans'", color: C.coffeeMid, marginTop: 6 }}>
              {order.closed ? "Closed · final order below" : `${items.length} drink${items.length === 1 ? "" : "s"} · live`}
            </div>
          </div>
          <button className="kr-ghost" onClick={() => navigate("/")}>Home</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <div style={codeChip}>
            <span style={{ font: "600 9px/1 'DM Sans'", letterSpacing: ".2em", color: C.coffeeMid }}>CODE</span>
            <span style={{ font: "800 19px/1 'Fraunces'", letterSpacing: ".18em", color: C.coffee }}>{order.code}</span>
          </div>
          <button className="kr-solid" style={{ background: C.green }} onClick={() => setShowShare(true)}>
            Share / invite
          </button>
          <button className="kr-solid" style={{ background: C.coffee }} onClick={() => copy(order.code, "Code copied")}>
            Copy code
          </button>
        </div>

        {isOrganizer && !order.closed && (
          <button className="kr-close" onClick={handleClose}>Close order</button>
        )}
      </div>

      {/* builder */}
      {!order.closed ? (
        <div style={cardStyle}>
          <SectionTitle>Build your drink</SectionTitle>

          {/* Name first, so history can load */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ font: "600 11px/1 'DM Sans'", letterSpacing: ".14em", textTransform: "uppercase", color: C.coffeeMid, marginBottom: 8 }}>
              Your name
            </div>
            <input className="kr-input" placeholder="Your name"
              value={myName} onChange={(e) => setMyName(e.target.value)} />
          </div>

          {/* Order for yourself or on someone else's behalf */}
          <ModRow label="Who's this drink for?"
            options={[{ id: "me", label: "Me" }, { id: "other", label: "Someone else" }]}
            value={{ id: forOther ? "other" : "me" }}
            onPick={(o) => setForOther(o.id === "other")} />
          {forOther && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ font: "600 11px/1 'DM Sans'", letterSpacing: ".14em", textTransform: "uppercase", color: C.coffeeMid, marginBottom: 8 }}>
                Their name
              </div>
              <input className="kr-input" placeholder="e.g. Wei Ling"
                value={otherName} onChange={(e) => setOtherName(e.target.value)} />
            </div>
          )}

          {/* Your usual — this device's recent drinks */}
          {history.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ font: "600 11px/1 'DM Sans'", letterSpacing: ".14em", textTransform: "uppercase", color: C.coffeeMid, marginBottom: 8 }}>
                Your usual — tap to reuse
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {history.map((row, i) => (
                  <button key={i} className="kr-usual" onClick={() => pickFromHistory(row)}>
                    {row.drink}{row.notes ? ` · ${row.notes}` : ""}
                  </button>
                ))}
              </div>
            </div>
          )}

          <DrinkBuilder baseId={baseId} sel={sel}
            onBase={(id) => { setBaseId(id); setSel(defaultSel()); }} onSel={setSel} />

          <div style={previewStyle}>
            <span style={{ font: "500 11px/1 'DM Sans'", color: C.coffeeMid, letterSpacing: ".1em" }}>
              YOUR ORDER{forOther && otherName.trim() ? ` — FOR ${otherName.trim().toUpperCase()}` : ""}
            </span>
            <span style={{ font: "700 italic 20px/1.1 'Fraunces'", color: C.coffee }}>{buildName(base, sel)}</span>
          </div>

          <input className="kr-input" placeholder="Notes (optional) — e.g. less ice"
            value={notes} onChange={(e) => setNotes(e.target.value)} style={{ marginTop: 12 }} />
          <button className="kr-add" onClick={handleAdd}>Add to the order</button>
        </div>
      ) : (
        <div style={{ ...cardStyle, textAlign: "center", borderColor: C.red }}>
          <div style={{ font: "800 18px/1.2 'Fraunces'", color: C.red }}>This order is closed</div>
          <div style={{ font: "500 13px/1.4 'DM Sans'", color: C.coffeeMid, marginTop: 6 }}>
            The organizer has locked it in. Final list below.
          </div>
        </div>
      )}

      {/* consolidated */}
      <div style={cardStyle}>
        <SectionTitle>The order so far</SectionTitle>
        {grouped.length === 0 ? (
          <div style={{ font: "500 14px/1.5 'DM Sans'", color: C.coffeeMid, padding: "6px 0" }}>
            Nothing yet — be the first to add a drink.
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              {grouped.map(([nm, n]) => (
                <div key={nm} style={tallyRow}>
                  <span style={{ font: "800 16px/1.2 'Fraunces'", color: C.green, minWidth: 34 }}>{n}×</span>
                  <span style={{ font: "600 15px/1.3 'DM Sans'", color: C.ink }}>{nm}</span>
                </div>
              ))}
            </div>
            <div style={{ height: 1, background: C.line, margin: "4px 0 12px" }} />
            <div style={{ font: "600 11px/1 'DM Sans'", letterSpacing: ".14em", textTransform: "uppercase", color: C.coffeeMid, marginBottom: 8 }}>
              Who ordered what
            </div>
            {items.map((it) =>
              editId === it.id ? (
                <div key={it.id} style={{ padding: "12px 0", borderBottom: `1px dotted ${C.line}` }}>
                  <div style={{ font: "600 11px/1 'DM Sans'", letterSpacing: ".14em", textTransform: "uppercase", color: C.coffeeMid, marginBottom: 8 }}>
                    Name
                  </div>
                  <input className="kr-input" placeholder="Name" value={editPerson}
                    onChange={(e) => setEditPerson(e.target.value)} style={{ marginBottom: 16 }} />

                  <DrinkBuilder baseId={editBaseId} sel={editSel}
                    onBase={(id) => { setEditBaseId(id); setEditSel(defaultSel()); }} onSel={setEditSel} />

                  <div style={previewStyle}>
                    <span style={{ font: "500 11px/1 'DM Sans'", color: C.coffeeMid, letterSpacing: ".1em" }}>UPDATED ORDER</span>
                    <span style={{ font: "700 italic 20px/1.1 'Fraunces'", color: C.coffee }}>
                      {buildName(BASES.find((b) => b.id === editBaseId), editSel)}
                    </span>
                  </div>

                  <input className="kr-input" placeholder="Notes (optional) — e.g. less ice" value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)} style={{ marginTop: 12 }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="kr-solid" style={{ background: C.green, flex: 1 }} onClick={() => handleSaveEdit(it)}>Save changes</button>
                    <button className="kr-ghost" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: `1px dotted ${C.line}` }}>
                  <span style={{ font: "600 13px/1.3 'DM Sans'", color: C.coffee, flexShrink: 0 }}>{it.person}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span style={{ font: "500 13px/1.3 'DM Sans'", color: C.ink, textAlign: "right" }}>
                      {it.drink}{it.notes ? <em style={{ color: C.coffeeMid }}> · {it.notes}</em> : null}
                    </span>
                    {!order.closed && (
                      <button className="kr-mini" style={{ borderColor: C.green, color: C.green }}
                        onClick={() => setSameItem(it)} aria-label={`Order the same as ${it.person}`}>
                        Same
                      </button>
                    )}
                    {canManage(it) && (
                      confirmId === it.id ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <button className="kr-mini" style={{ borderColor: C.red, color: C.red }} onClick={() => handleDelete(it)}>Remove</button>
                          <button className="kr-mini" onClick={() => setConfirmId(null)}>Cancel</button>
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <button className="kr-mini" onClick={() => startEdit(it)} aria-label="Edit drink">Edit</button>
                          <button className="kr-mini" style={{ borderColor: C.red, color: C.red }} onClick={() => { cancelEdit(); setConfirmId(it.id); }} aria-label="Delete drink">Delete</button>
                        </span>
                      )
                    )}
                  </div>
                </div>
              )
            )}
          </>
        )}
      </div>

      {showShare && (
        <ShareModal
          orderName={order.name}
          code={order.code}
          shareLink={shareLink}
          onCopyLink={() => copy(shareLink, "Link copied")}
          onCopyCode={() => copy(order.code, "Code copied")}
          onClose={() => setShowShare(false)}
        />
      )}

      {sameItem && (
        <SameModal
          sourceItem={sameItem}
          defaultName={myName}
          onAdd={handleSameAdd}
          onClose={() => setSameItem(null)}
        />
      )}

      {nameModal && (
        <NameModal
          title={nameModal.title}
          onConfirm={nameModal.onConfirm}
          onClose={() => setNameModal(null)}
        />
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </>
  );
}

/* ============================ QR scanner ============================ */
// Only rendered when `BarcodeDetector` exists (Chrome/Android WebView —
// the TWA's runtime). No cross-browser polyfill; the manual code input
// next to it stays as the fallback on unsupported browsers.
function QrScanner({ onDecode, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream = null;
    let rafId = null;
    let stopped = false;
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });

    async function scan() {
      if (stopped) return;
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes.length > 0) {
          onDecode(codes[0].rawValue);
          return;
        }
      } catch {
        // frame not decodable yet — keep scanning
      }
      rafId = requestAnimationFrame(scan);
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        scan();
      } catch {
        setError("Couldn't access the camera. Check camera permission for the app.");
      }
    })();

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onDecode]);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, padding: 0, overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        {error ? (
          <div style={{ padding: 20 }}>
            <p style={subText}>{error}</p>
            <button className="kr-close" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted style={{ width: "100%", display: "block" }} />
            <button className="kr-close" style={{ margin: 12 }} onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================ Smart app banner ============================ */
// Only relevant on Android: when a shared link lands in a real browser tab
// (App Links verification failed, or the app isn't installed yet), offer a
// one-tap path into the installed app, or the Play Store with the order
// code carried through as an install referrer.
function SmartAppBanner({ code }) {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  if (!isAndroid || isStandalone) return null;

  const pkg = "run.kprun.twa";
  const fallback = encodeURIComponent(
    `https://play.google.com/store/apps/details?id=${pkg}&referrer=${encodeURIComponent(`order=${code}`)}`
  );
  const intentUrl =
    `intent://${window.location.host}/order/${code}#Intent;scheme=https;package=${pkg};` +
    `S.browser_fallback_url=${fallback};end`;

  return (
    <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <span style={{ font: "600 13px/1.3 'DM Sans'", color: C.coffee }}>Open this in the Kopi Run app</span>
      <a href={intentUrl} className="kr-solid" style={{ background: C.green, textDecoration: "none" }}>Open app</a>
    </div>
  );
}

/* ============================ Share modal ============================ */
function ShareModal({ orderName, code, shareLink, onCopyLink, onCopyCode, onClose }) {
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(shareLink, { width: 200, margin: 1, color: { dark: "#4A2A18", light: "#FBF5E7" } })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [shareLink]);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ font: "800 20px/1.2 'Fraunces'", color: C.ink }}>Run created — invite your kaki 🎉</div>
        <p style={{ ...subText, marginTop: 8 }}>
          This is the unique link for <strong>{orderName}</strong>. Anyone who opens it lands on the
          same live order. Send it to everyone joining the dabao.
        </p>

        {qrDataUrl && (
          <div style={{ display: "flex", justifyContent: "center", margin: "14px 0" }}>
            <img src={qrDataUrl} alt="Scan to join" width={160} height={160}
              style={{ borderRadius: 12, border: `1px solid ${C.line}` }} />
          </div>
        )}

        <div style={{ font: "600 11px/1 'DM Sans'", letterSpacing: ".14em", textTransform: "uppercase", color: C.coffeeMid, margin: "4px 0 8px" }}>
          Share link
        </div>
        <div className="kr-input" style={{ fontSize: 13, color: C.coffeeMid, display: "flex", alignItems: "center" }}>
          Kopi Run · order {code}
        </div>
        <button className="kr-add" style={{ background: C.green, marginTop: 12 }} onClick={onCopyLink}>
          Copy link
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 4px" }}>
          <div style={{ height: 1, flex: 1, background: C.line }} />
          <span style={{ font: "500 11px/1 'DM Sans'", color: C.coffeeMid }}>or share the code</span>
          <div style={{ height: 1, flex: 1, background: C.line }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 8 }}>
          <span style={{ font: "800 24px/1 'Fraunces'", letterSpacing: ".2em", color: C.coffee }}>{code}</span>
          <button className="kr-ghost" onClick={onCopyCode}>Copy code</button>
        </div>

        <button className="kr-close" style={{ borderColor: C.line, color: C.coffeeMid, marginTop: 18 }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

/* ============================ Same-as modal ============================ */
// Lets someone add another item's drink straight from the "order so far"
// list, without touching (or losing) whatever's in the builder up top.
function SameModal({ sourceItem, defaultName, onAdd, onClose }) {
  const { baseId, sel } = parseName(sourceItem.drink);
  const base = BASES.find((b) => b.id === baseId);
  const [forOther, setForOther] = useState(false);
  const [name, setName] = useState(defaultName || "");
  const [otherName, setOtherName] = useState("");
  const [notes, setNotes] = useState(sourceItem.notes || "");

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ font: "800 20px/1.2 'Fraunces'", color: C.ink }}>Same as {sourceItem.person}</div>

        <div style={{ ...previewStyle, marginTop: 12 }}>
          <span style={{ font: "500 11px/1 'DM Sans'", color: C.coffeeMid, letterSpacing: ".1em" }}>DRINK</span>
          <span style={{ font: "700 italic 20px/1.1 'Fraunces'", color: C.coffee }}>{buildName(base, sel)}</span>
        </div>

        <div style={{ marginTop: 14 }}>
          <ModRow label="Who's this drink for?"
            options={[{ id: "me", label: "Me" }, { id: "other", label: "Someone else" }]}
            value={{ id: forOther ? "other" : "me" }}
            onPick={(o) => setForOther(o.id === "other")} />
        </div>

        {forOther ? (
          <input className="kr-input" placeholder="Their name" autoFocus
            value={otherName} onChange={(e) => setOtherName(e.target.value)} style={{ marginBottom: 14 }} />
        ) : (
          <input className="kr-input" placeholder="Your name"
            value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 14 }} />
        )}

        <input className="kr-input" placeholder="Notes (optional) — e.g. less ice"
          value={notes} onChange={(e) => setNotes(e.target.value)} />

        <button className="kr-add" onClick={() => onAdd({ baseId, sel, notes, forOther, name, otherName })}>
          Add to the order
        </button>
        <button className="kr-close" style={{ borderColor: C.line, color: C.coffeeMid, marginTop: 10 }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ============================ Name-required modal ============================ */
// Shown when someone tries to add a drink "for someone else" without
// entering that person's name, so they can supply it without losing
// the drink they already built.
function NameModal({ title = "Enter a name", onConfirm, onClose }) {
  const [name, setName] = useState("");
  const submit = () => { if (name.trim()) onConfirm(name.trim()); };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ font: "800 20px/1.2 'Fraunces'", color: C.ink }}>{title}</div>
        <p style={{ ...subText, marginTop: 8 }}>Enter a name so everyone knows whose drink this is.</p>
        <input className="kr-input" placeholder="e.g. Wei Ling" autoFocus
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <button className="kr-add" onClick={submit} disabled={!name.trim()}>Continue</button>
        <button className="kr-close" style={{ borderColor: C.line, color: C.coffeeMid, marginTop: 10 }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div style={{ ...cardStyle, textAlign: "center" }}>
      <div style={{ font: "800 18px/1.2 'Fraunces'", color: C.red }}>Order not found</div>
      <p style={subText}>That code does not match any order.</p>
      <Link to="/" style={{ color: C.green, font: "700 14px/1 'DM Sans'", textDecoration: "none" }}>← Back home</Link>
    </div>
  );
}

/* ============================ UI atoms ============================ */
function Pill({ on, onClick, children, accent = C.green }) {
  return (
    <button onClick={onClick} className="kr-pill"
      style={{ background: on ? accent : "transparent", color: on ? "#fff" : C.coffee,
               borderColor: on ? accent : C.line, fontWeight: on ? 700 : 500 }}>
      {children}
    </button>
  );
}

// Base pills + modifier rows. `onBase(id)` should reset the selection;
// `onSel` is a setState-style updater so callers can pass setSel directly.
function DrinkBuilder({ baseId, sel, onBase, onSel }) {
  const base = BASES.find((b) => b.id === baseId);
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
        {BASES.map((b) => (
          <Pill key={b.id} on={b.id === baseId} accent={C.red}
            onClick={() => onBase(b.id)}>{b.name}</Pill>
        ))}
      </div>

      {base.mods.includes("milk") && (
        <ModRow label="Milk" options={MILK} value={sel.milk}
          onPick={(o) => onSel((s) => ({ ...s, milk: o }))} />)}
      {base.mods.includes("strength") && (
        <ModRow label="Strength" options={STRENGTH} value={sel.strength}
          onPick={(o) => onSel((s) => ({ ...s, strength: o }))} />)}
      {base.mods.includes("sugar") && (
        <ModRow label="Sweetness" options={SUGAR} value={sel.sugar}
          onPick={(o) => onSel((s) => ({ ...s, sugar: o }))} />)}
      {base.mods.includes("tarik") && (
        <ModRow label="Pulled" options={[{ id: "no", label: "No" }, { id: "yes", label: "Tarik" }]}
          value={{ id: sel.tarik ? "yes" : "no" }}
          onPick={(o) => onSel((s) => ({ ...s, tarik: o.id === "yes" }))} />)}
      {base.mods.includes("temp") && (
        <ModRow label="Temperature" options={TEMP} value={sel.temp}
          onPick={(o) => onSel((s) => ({ ...s, temp: o }))} />)}
      {base.mods.includes("custom") && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ font: "600 11px/1 'DM Sans'", letterSpacing: ".14em", textTransform: "uppercase", color: C.coffeeMid, marginBottom: 8 }}>
            What would you like?
          </div>
          <input className="kr-input" placeholder="Type your drink — e.g. Iced lemon tea"
            value={sel.custom} onChange={(e) => onSel((s) => ({ ...s, custom: e.target.value }))} />
        </div>)}
    </>
  );
}

function ModRow({ label, options, value, onPick }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ font: "600 11px/1 'DM Sans'", letterSpacing: ".14em", textTransform: "uppercase", color: C.coffeeMid, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {options.map((o) => (
          <Pill key={o.id} on={value.id === o.id} onClick={() => onPick(o)}>{o.label}</Pill>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ width: 7, height: 7, borderRadius: 9, background: C.red, display: "inline-block" }} />
      <h2 style={{ font: "800 17px/1 'Fraunces'", color: C.ink, margin: 0 }}>{children}</h2>
    </div>
  );
}

function Brand() {
  return (
    <header style={{ textAlign: "center", paddingTop: 30, paddingBottom: 8 }}>
      <Link to="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        <svg width="42" height="42" viewBox="0 0 42 42" fill="none" aria-hidden>
          <path d="M9 14h21v9a9 9 0 0 1-9 9h-3a9 9 0 0 1-9-9v-9z" fill={C.green} />
          <path d="M30 16h3a4 4 0 0 1 0 8h-3" stroke={C.coffee} strokeWidth="2.4" fill="none" />
          <path d="M14 4c-1.6 2 1.6 3 0 5M21 4c-1.6 2 1.6 3 0 5M28 4c-1.6 2 1.6 3 0 5" stroke={C.coffeeMid} strokeWidth="2" strokeLinecap="round" />
          <rect x="9" y="14" width="21" height="3.4" fill="#fff" opacity=".85" />
        </svg>
        <div style={{ textAlign: "left" }}>
          <div style={{ font: "900 30px/0.9 'Fraunces'", color: C.coffee, letterSpacing: "-.01em" }}>Kopi Run</div>
          <div style={{ font: "600 10px/1 'DM Sans'", letterSpacing: ".28em", textTransform: "uppercase", color: C.green, marginTop: 5 }}>
            Dabao for the whole gang
          </div>
        </div>
      </Link>
    </header>
  );
}

/* ============================ Styles ============================ */
const pageStyle = {
  minHeight: "100vh", fontFamily: "'DM Sans', system-ui, sans-serif", color: C.ink,
  background:
    `radial-gradient(circle at 12% 8%, rgba(30,107,79,0.10), transparent 38%),` +
    `radial-gradient(circle at 88% 4%, rgba(178,58,46,0.10), transparent 34%),` +
    `radial-gradient(${C.line} 1px, transparent 1px)`,
  backgroundColor: C.cream, backgroundSize: "auto, auto, 22px 22px",
};
const cardStyle = { background: C.paper, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18, marginTop: 16, boxShadow: "0 10px 26px -18px rgba(44,26,14,0.55)" };
const codeChip = { display: "inline-flex", flexDirection: "column", gap: 3, padding: "8px 14px", borderRadius: 12, background: C.paperDeep, border: `1px dashed ${C.gold}` };
const previewStyle = { marginTop: 6, padding: "14px 16px", borderRadius: 14, background: `linear-gradient(135deg, ${C.paperDeep}, #fff)`, border: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 4 };
const tallyRow = { display: "flex", alignItems: "baseline", gap: 10, padding: "5px 0" };
const subText = { font: "500 13px/1.5 'DM Sans'", color: C.coffeeMid, margin: "0 0 12px" };
const errStyle = { marginTop: 14, padding: "10px 14px", borderRadius: 12, background: "#fbe3df", color: C.red, font: "600 13px/1.4 'DM Sans'", textAlign: "center" };
const toastStyle = { position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: C.ink, color: C.paper, padding: "11px 20px", borderRadius: 100, font: "600 13px/1 'DM Sans'", boxShadow: "0 10px 30px -8px rgba(0,0,0,.5)", zIndex: 50, animation: "krpop .25s ease" };
const overlayStyle = { position: "fixed", inset: 0, background: "rgba(44,26,14,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, zIndex: 60, animation: "krfade .2s ease" };
const modalStyle = { width: "100%", maxWidth: 420, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 20, padding: "22px 20px", boxShadow: "0 24px 60px -20px rgba(44,26,14,0.7)", animation: "krrise .25s ease" };

const css = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;0,9..144,900;1,9..144,600;1,9..144,700&family=DM+Sans:wght@400;500;600;700&display=swap');
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body { margin: 0; }
.kr-pill { padding: 8px 13px; border-radius: 100px; border: 1.5px solid; font-family: 'DM Sans'; font-size: 13px; cursor: pointer; transition: all .15s ease; }
.kr-pill:hover { transform: translateY(-1px); }
.kr-usual { padding: 8px 13px; border-radius: 100px; border: 1.5px dashed ${C.gold}; background: ${C.paperDeep}; color: ${C.coffee}; font-family: 'DM Sans'; font-weight: 600; font-size: 12.5px; cursor: pointer; transition: all .15s ease; }
.kr-usual:hover { border-style: solid; border-color: ${C.green}; color: ${C.green}; transform: translateY(-1px); }
.kr-input { width: 100%; padding: 12px 14px; border-radius: 12px; border: 1.5px solid ${C.line}; background: #fff; font-family: 'DM Sans'; font-size: 15px; color: ${C.ink}; outline: none; transition: border-color .15s; }
.kr-input:focus { border-color: ${C.green}; }
.kr-add { width: 100%; margin-top: 14px; padding: 13px; border: none; border-radius: 12px; background: ${C.red}; color: #fff; font-family: 'Fraunces'; font-weight: 700; font-size: 16px; cursor: pointer; transition: transform .12s, filter .15s; }
.kr-add:hover { filter: brightness(1.06); }
.kr-add:active { transform: scale(.985); }
.kr-add:disabled { opacity: .6; cursor: default; }
.kr-solid { padding: 9px 13px; border: none; border-radius: 10px; color: #fff; font-family: 'DM Sans'; font-weight: 600; font-size: 12.5px; cursor: pointer; transition: filter .15s; }
.kr-solid:hover { filter: brightness(1.08); }
.kr-ghost { padding: 7px 12px; border: 1.5px solid ${C.line}; border-radius: 100px; background: transparent; color: ${C.coffeeMid}; font-family: 'DM Sans'; font-weight: 600; font-size: 12px; cursor: pointer; }
.kr-ghost:hover { border-color: ${C.coffeeMid}; }
.kr-mini { padding: 4px 10px; border: 1.5px solid ${C.line}; border-radius: 100px; background: transparent; color: ${C.coffeeMid}; font-family: 'DM Sans'; font-weight: 600; font-size: 11px; cursor: pointer; transition: all .15s; }
.kr-mini:hover { filter: brightness(.95); transform: translateY(-1px); }
.kr-close { width: 100%; margin-top: 14px; padding: 11px; border: 1.5px solid ${C.red}; border-radius: 12px; background: transparent; color: ${C.red}; font-family: 'DM Sans'; font-weight: 700; font-size: 14px; cursor: pointer; transition: all .15s; }
.kr-close:hover { background: ${C.red}; color: #fff; }
a { color: inherit; }
@keyframes krpop { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes krfade { from { opacity: 0; } to { opacity: 1; } }
@keyframes krrise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
`;
