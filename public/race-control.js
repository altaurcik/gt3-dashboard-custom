// Swiss Timing uses local DD.MM.YYYY HH:mm:ss; Date.parse is locale dependent.
const timeKey = (value) => typeof value === "string"
  ? value.replace(/^(\d{2})\.(\d{2})\.(\d{4})\s+/, "$3-$2-$1 ") : "";

export function newestRaceMessages(messages = []) {
  return [...messages].sort((a, b) => timeKey(b.time).localeCompare(timeKey(a.time)));
}

// The same semantic tones as F1 EventPanels; SRO supplies text instead of typed Flag/Category.
export function raceEventStyle(message) {
  const text = typeof message === "string" ? message : message?.text ?? "";
  if (/\bPENALT(?:Y|IES)\b|\bDISQUALIF|\bDSQ\b/i.test(text)) return { name: "Penalty", tone: "red", icon: "penalty" };
  if (/\bRED\s+FLAG\b|\b(?:RACE|SESSION)\s+SUSPENDED\b/i.test(text)) return { name: "Red flag", tone: "red", icon: "flag" };
  if (/\bGREEN\s+(?:FLAG|LIGHT)\b|\b(?:ALL|TRACK)\s+CLEAR\b|\bPIT\s+EXIT\s+(?:IS\s+)?OPEN\b/i.test(text)) return { name: "Green", tone: "green", icon: "flag" };
  if (/\bBLUE\s+FLAG\b/i.test(text)) return { name: "Blue flag", tone: "blue", icon: "flag" };
  if (/\b(?:INCIDENT|NOTED|INVESTIGAT\w*)\b/i.test(text)) return { name: "Investigation", tone: "purple", icon: "info" };
  if (/TRACK\s+LIMIT|(?:TIME|LAP).*DELETED/i.test(text)) return { name: "Track Limits", tone: "orange", icon: "limits" };
  if (/\bWARNING\b|BLACK\s*(?:\/|AND|&)\s*WHITE\s+FLAG/i.test(text)) return { name: "Warning", tone: "orange", icon: "limits" };
  if (/\bFULL\s+COURSE\s+YELLOW\b|\bFCY\b/i.test(text)) return { name: "FCY", tone: "yellow", icon: "flag" };
  if (/\b(?:DOUBLE\s+)?YELLOW\s+FLAG\b/i.test(text)) return { name: /DOUBLE/i.test(text) ? "Double Yellow" : "Yellow", tone: "yellow", icon: "flag" };
  if (/\bSAFETY\s+CAR\b|\bVSC\b/i.test(text)) return { name: /\bVSC\b|\bVIRTUAL\b/i.test(text) ? "Virtual Safety Car" : "Safety Car", tone: "orange", icon: "car" };
  return { name: "Info", tone: "neutral", icon: "info" };
}
