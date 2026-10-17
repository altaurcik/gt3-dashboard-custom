const classKey = (value) => String(value ?? "").trim().toUpperCase();
const numberKey = (value) => String(value).replace(/^0+(?=\d)/, "");
export const matchesClass = (entry, selected) => selected === "all" || classKey(entry?.className) === classKey(selected);

export function messageCars(text = "") {
  const numbers = new Set();
  text = text.replace(/\bSAFETY\s+CAR\b/gi, "SAFETY_CONTROL");
  const pattern = /\bCARS?\s*#?\s*(\d+\b(?:(?:\s*(?:[-,/&+]|AND)\s*#?|\s+#)\d+\b)*)/gi;
  for (const match of text.matchAll(pattern)) for (const number of match[1].match(/\d+/g) ?? []) numbers.add(numberKey(number));
  for (const match of text.matchAll(/#\s*(\d+)\b/g)) numbers.add(numberKey(match[1]));
  return [...numbers];
}

export function classSnapshot(snapshot, selected = "all") {
  if (!snapshot || selected === "all") return snapshot;
  const rows = snapshot.rows.filter((row) => matchesClass(row, selected));
  const allowed = new Set(rows.map((row) => numberKey(row.number)));
  const includes = (number) => allowed.has(numberKey(number));
  return { ...snapshot, rows,
    history: Object.fromEntries(Object.entries(snapshot.history ?? {}).filter(([number]) => includes(number))),
    pitEvents: (snapshot.pitEvents ?? []).filter((event) => includes(event.number)),
    driverEvents: (snapshot.driverEvents ?? []).filter((event) => includes(event.number)),
    messages: (snapshot.messages ?? []).filter((message) => {
      const numbers = messageCars(message.text);
      return !numbers.length || numbers.some(includes);
    }),
  };
}

export function classComparison(choice, rows, selected = "all") {
  if (selected === "all") return choice;
  const allowed = new Set(rows.map((row) => row.number));
  if (choice.mode === "ahead" && allowed.has(choice.a)) return choice;
  return { mode: "manual", a: allowed.has(choice.a) ? choice.a : null,
    b: choice.mode === "manual" && allowed.has(choice.b) ? choice.b : null };
}
