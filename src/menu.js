// Fixed Singapore kopitiam menu + Singlish name builder.

export const MILK = [
  { id: "condensed", label: "Condensed milk", token: "" },
  { id: "evaporated", label: "Evaporated · C", token: "C" },
  { id: "none", label: "No milk · O", token: "O" },
];
export const SUGAR = [
  { id: "normal", label: "Normal sweet", token: "" },
  { id: "siewdai", label: "Less sweet · Siew Dai", token: "Siew Dai" },
  { id: "gahdai", label: "Extra sweet · Gah Dai", token: "Gah Dai" },
  { id: "kosong", label: "No sugar · Kosong", token: "Kosong" },
];
export const STRENGTH = [
  { id: "normal", label: "Normal", token: "" },
  { id: "gao", label: "Strong · Gao", token: "Gao" },
  { id: "po", label: "Light · Po", token: "Po" },
];
export const TEMP = [
  { id: "hot", label: "Hot", token: "" },
  { id: "peng", label: "Iced · Peng", token: "Peng" },
];

export const BASES = [
  { id: "kopi", name: "Kopi", desc: "Nanyang coffee", mods: ["milk", "strength", "sugar", "temp"] },
  { id: "teh", name: "Teh", desc: "Tea", mods: ["milk", "strength", "sugar", "temp"] },
  { id: "oolong", name: "Oolong", desc: "Oolong tea", mods: ["temp"] },
  { id: "water", name: "Water", desc: "Plain water", mods: ["temp"] },
  { id: "others", name: "Others", desc: "Type your own", mods: ["custom"] },
];

export function defaultSel() {
  return {
    milk: MILK[0],
    sugar: SUGAR[0],
    strength: STRENGTH[0],
    temp: TEMP[0],
    tarik: false,
    dino: false,
    custom: "",
  };
}

export function buildName(base, sel) {
  if (base.mods.includes("custom")) {
    return (sel.custom || "").trim() || "Others";
  }
  const p = [base.name];
  if (base.mods.includes("milk") && sel.milk.token) p.push(sel.milk.token);
  if (base.mods.includes("strength") && sel.strength.token) p.push(sel.strength.token);
  if (base.mods.includes("sugar") && sel.sugar.token) p.push(sel.sugar.token);
  if (base.mods.includes("tarik") && sel.tarik) p.push("Tarik");
  if (base.mods.includes("dino") && sel.dino) p.push("Dinosaur");
  if (base.mods.includes("temp") && sel.temp.token) p.push(sel.temp.token);
  return p.join(" ");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Best-effort inverse of buildName: turn a saved drink string back into
// { baseId, sel } so the builder can be pre-filled when editing an item.
// If the string can't be reproduced exactly from the menu (e.g. a free-text
// "Others" drink, or anything unrecognised), it falls back to the custom
// "Others" base holding the original text — so nothing is ever lost.
export function parseName(drink) {
  const text = (drink || "").trim();
  const others = { baseId: "others", sel: { ...defaultSel(), custom: text } };

  const base = BASES.find(
    (b) => !b.mods.includes("custom") &&
      new RegExp(`^${escapeRegExp(b.name)}(\\s|$)`, "i").test(text)
  );
  if (!base) return others;

  const rest = text.slice(base.name.length);
  const pick = (options) => {
    for (const o of options) {
      if (o.token && new RegExp(`(^|\\s)${escapeRegExp(o.token)}(\\s|$)`, "i").test(rest)) return o;
    }
    return options.find((o) => o.token === "") || options[0];
  };

  const sel = defaultSel();
  if (base.mods.includes("milk")) sel.milk = pick(MILK);
  if (base.mods.includes("strength")) sel.strength = pick(STRENGTH);
  if (base.mods.includes("sugar")) sel.sugar = pick(SUGAR);
  if (base.mods.includes("temp")) sel.temp = pick(TEMP);
  if (base.mods.includes("tarik")) sel.tarik = /(^|\s)Tarik(\s|$)/i.test(rest);

  // Only trust the parse if it round-trips exactly; otherwise keep free text.
  return buildName(base, sel).toLowerCase() === text.toLowerCase()
    ? { baseId: base.id, sel }
    : others;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function genCode(n = 5) {
  let s = "";
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}
