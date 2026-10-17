const carNumber = (value) => typeof value === "string" && /^\d+$/.test(value) ? value : null;

export function comparisonSelection(value = {}) {
  if (!value || value.mode !== "manual") return { mode: "ahead", a: carNumber(value?.a) ?? "3", b: null };
  const a = carNumber(value.a), b = carNumber(value.b);
  return { mode: "manual", a, b: b === a ? null : b };
}

export function resolveComparison(rows = [], preference = {}, favorite = "3", { withinClass = false } = {}) {
  const choice = comparisonSelection(preference);
  const aNumber = choice.mode === "ahead" ? carNumber(preference?.a) ?? favorite : choice.a;
  const a = rows.find((row) => row.number === aNumber) ?? null;
  if (choice.mode === "manual") return { mode: "manual", aNumber, bNumber: choice.b, a,
    b: rows.find((row) => row.number === choice.b) ?? null, reason: "manual" };
  let reason = "ready", b = null;
  if (!a) reason = rows.length ? "favorite-missing" : "waiting";
  else if (!Number.isInteger(a.position) || a.position < 1) reason = "unranked";
  else if (a.position === 1) reason = "leader";
  else {
    b = withinClass
      ? rows.filter((row) => row.number !== aNumber && Number.isInteger(row.position) && row.position > 0 && row.position < a.position).sort((left, right) => right.position - left.position)[0] ?? null
      : rows.find((row) => row.number !== aNumber && row.position === a.position - 1) ?? null;
    if (!b) reason = withinClass ? "leader" : "ahead-unavailable";
  }
  return { mode: "ahead", aNumber, bNumber: b?.number ?? null, a, b, reason };
}

export function chooseComparisonSide(current, side, number) {
  const a = carNumber(current.aNumber), b = carNumber(current.bNumber), chosen = carNumber(number);
  if (side === "a" && current.mode === "ahead" && chosen) return { mode: "ahead", a: chosen, b: null };
  if (side === "a") return { mode: "manual", a: chosen, b: chosen && chosen === b ? a : b };
  return { mode: "manual", a: chosen && chosen === a ? b : a, b: chosen };
}
