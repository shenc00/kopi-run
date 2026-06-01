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
  { id: "teh", name: "Teh", desc: "Tea", mods: ["milk", "strength", "sugar", "tarik", "temp"] },
  { id: "yuanyang", name: "Yuan Yang", desc: "Kopi + Teh", mods: ["milk", "sugar", "temp"] },
  { id: "milo", name: "Milo", desc: "Malted chocolate", mods: ["dino", "temp"] },
  { id: "bandung", name: "Bandung", desc: "Rose syrup milk", mods: ["temp"] },
  { id: "horlicks", name: "Horlicks", desc: "Malted drink", mods: ["temp"] },
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

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function genCode(n = 5) {
  let s = "";
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}
