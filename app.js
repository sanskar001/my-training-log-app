const state = {
  token: "",
  username: "sanskar001",
  repo: "my-training-log-data",
  path: "data/athlete.json",
  data: null
};

const $ = (id) => document.getElementById(id);
const tokenInput = $("token");

const SPORT_LABELS = {
  swim: "Swim", bike: "Bike", run: "Run",
  strength: "Strength", mobility: "Mobility", rest: "Rest"
};
// UI-only convenience: default unit per sport (writes to the existing unit field)
const SPORT_DEFAULT_UNIT = {
  swim: "m", bike: "km", run: "km", strength: "none", mobility: "none", rest: "none"
};
// Sport glyph symbol id (SVG icon shown on each session card)
const SPORT_ICON = {
  swim: "s-swim", bike: "s-bike", run: "s-run",
  strength: "s-strength", mobility: "s-mobility", rest: "s-rest"
};
// Which fields apply to each sport. Fields NOT listed are disabled + cleared
// for that sport (so they save as null — the data contract is unchanged).
// date, duration and notes always apply, so they are never gated.
const SPORT_FIELDS = {
  swim:     ["distance", "unit", "rpe", "avgHr", "maxHr"],
  bike:     ["distance", "unit", "rpe", "avgHr", "maxHr"],
  run:      ["distance", "unit", "rpe", "avgHr", "maxHr"],
  strength: ["rpe", "avgHr", "maxHr"],
  mobility: ["rpe", "avgHr", "maxHr"],
  rest:     ["restingHr"]
};
// Map a data-field key to its control selectors inside a session card.
const FIELD_CONTROLS = {
  distance:  [".session-distance"],
  unit:      [".session-unit"],
  rpe:       [".session-rpe"],
  avgHr:     [".session-avg-hr", ".session-avg-hr-slider"],
  maxHr:     [".session-max-hr", ".session-max-hr-slider"],
  restingHr: [".session-resting-hr", ".session-resting-hr-slider"]
};

function setStatus(el, message, type = "") {
  el.textContent = message;
  el.className = `status ${type}`;
}

function openModal(title, message) {
  $("modalTitle").textContent = title;
  $("modalMessage").textContent = message;
  $("modal").showModal();
}

$("modalClose").addEventListener("click", () => {
  $("modal").close();
  resetForm();
});

/* RPE info modal */
$("rpeClose").addEventListener("click", () => $("rpeModal").close());
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-rpe-info]")) {
    e.preventDefault();
    $("rpeModal").showModal();
  }
});

/* Tabs */
function switchTab(which) {
  const log = which === "log";
  $("tabLog").classList.toggle("active", log);
  $("tabBrowse").classList.toggle("active", !log);
  $("tabLog").setAttribute("aria-selected", String(log));
  $("tabBrowse").setAttribute("aria-selected", String(!log));
  $("logCard").classList.toggle("hidden", !log);
  $("historyCard").classList.toggle("hidden", log);
  $("historyCard").hidden = log;
  $("logCard").hidden = !log;
  if (!log) applyFilters();
}
$("tabLog").addEventListener("click", () => switchTab("log"));
$("tabBrowse").addEventListener("click", () => switchTab("browse"));

$("toggleToken").addEventListener("click", () => {
  const visible = tokenInput.type === "text";
  tokenInput.type = visible ? "password" : "text";
  $("toggleToken").textContent = visible ? "Show" : "Hide";
});

$("copyToken").addEventListener("click", async () => {
  if (!tokenInput.value) return;
  try {
    await navigator.clipboard.writeText(tokenInput.value);
    setStatus($("connectStatus"), "Token copied to clipboard.", "success");
  } catch {
    setStatus($("connectStatus"), "Clipboard access was blocked by the browser.", "error");
  }
});

function apiBase() {
  return `https://api.github.com/repos/${encodeURIComponent(state.username)}/${encodeURIComponent(state.repo)}`;
}

async function github(path = "", options = {}) {
  const method = (options.method || "GET").toUpperCase();
  // The GitHub Contents API caches GETs. Bust it with a unique query param on
  // reads so a verify read-back never returns the stale (pre-delete/edit) file.
  // NOTE: do NOT send a Cache-Control request header — it triggers a CORS
  // preflight that api.github.com rejects (header not in Access-Control-Allow-
  // Headers). The query param alone is enough and keeps the request "simple".
  const bust = method === "GET" ? `?nocache=${Date.now()}` : "";
  const response = await fetch(`${apiBase()}/contents/${path}${bust}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${state.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(body?.message || `GitHub request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function connect() {
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus($("connectStatus"), "Enter your GitHub token first.", "error");
    return;
  }

  state.token = token;
  state.username = $("username").value.trim();
  state.repo = $("repo").value.trim();

  $("connectBtn").disabled = true;
  $("connectBtn").textContent = "Connecting…";
  setStatus($("connectStatus"), "Checking the private data repository…");

  try {
    let file;
    try {
      file = await github(state.path);
    } catch (error) {
      if (error.status !== 404) throw error;
      state.data = {
        schemaVersion: "1.0",
        athlete: { name: "" },
        weeks: []
      };
      await createDataFile(state.data, "Initial athlete log");
      file = await github(state.path);
    }

    state.data = decodeGithubContent(file.content);
    if (!Array.isArray(state.data.weeks)) state.data.weeks = [];

    $("connectionBadge").innerHTML = '<span class="badge-dot"></span>Connected';
    $("connectionBadge").className = "badge online";
    $("connectCard").classList.add("hidden");
    $("tabBar").classList.remove("hidden");
    $("logCard").classList.remove("hidden");
    $("logCard").hidden = false;
    setStatus($("connectStatus"), "Connected and verified.", "success");
    setDefaultDates();
    renderHistory(state.data.weeks);
  } catch (error) {
    state.token = "";
    restoreConnectBtn();
    const message = error.status === 401
      ? "Token is invalid or expired. Check the token and try again."
      : error.status === 403
        ? "GitHub denied access. Confirm Contents → Read and write for this repository."
        : error.message;
    setStatus($("connectStatus"), message, "error");
  } finally {
    restoreConnectBtn();
  }
}

function restoreConnectBtn() {
  const btn = $("connectBtn");
  btn.disabled = false;
  btn.innerHTML = '<svg class="ic"><use href="#i-plug" xlink:href="#i-plug"/></svg>Connect GitHub';
}

function decodeGithubContent(content) {
  const binary = atob(content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function encodeContent(value) {
  const json = JSON.stringify(value, null, 2);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

async function createDataFile(data, message, sha) {
  const body = {
    message,
    content: encodeContent(data)
  };
  if (sha) body.sha = sha;
  return github(state.path, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

function setDefaultDates() {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  $("startDate").value = toDateInput(monday);
  $("endDate").value = toDateInput(sunday);

  const next = (state.data?.weeks?.length || 0) + 1;
  $("weekNumber").value = next;
  if (!$("sessions").children.length) addSession();
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function addSession(values = {}, prepend = false) {
  const fragment = $("sessionTemplate").content.cloneNode(true);
  const card = fragment.querySelector(".session-card");
  const typeSel = card.querySelector(".session-type");
  const unitSel = card.querySelector(".session-unit");

  typeSel.value = values.type || "run";
  card.dataset.type = typeSel.value;
  card.querySelector(".session-date").value = values.date || $("startDate").value;
  card.querySelector(".session-duration").value = values.duration ?? "";
  card.querySelector(".session-distance").value = values.distance ?? "";
  unitSel.value = values.unit || SPORT_DEFAULT_UNIT[typeSel.value] || "km";
  card.querySelector(".session-rpe").value = values.rpe ?? "";

  // Heart-rate fields: wire slider <-> number input two-way, seed from saved values
  wireHrControl(card, ".session-avg-hr", ".session-avg-hr-slider", values.avgHeartRate);
  wireHrControl(card, ".session-max-hr", ".session-max-hr-slider", values.maxHeartRate);
  wireHrControl(card, ".session-resting-hr", ".session-resting-hr-slider", values.restingHeartRate);

  card.querySelector(".session-notes").value = values.notes || "";

  const badgeUse = card.querySelector(".sport-ic use");

  // UI only: color accent + auto unit + applicable fields when sport changes.
  let unitTouched = false;
  unitSel.addEventListener("change", () => { unitTouched = true; });
  const onType = () => {
    card.dataset.type = typeSel.value;
    if (badgeUse) setUse(badgeUse, SPORT_ICON[typeSel.value] || "s-run");
    if (!unitTouched) unitSel.value = SPORT_DEFAULT_UNIT[typeSel.value] || "km";
    applySportRules(card);
  };
  typeSel.addEventListener("change", onType);

  card.querySelector(".remove-session").addEventListener("click", () => card.remove());

  // New sessions (from the Add Session button) go to the TOP so the user doesn't
  // scroll down to fill them. Loading a saved week passes prepend=false to keep
  // the sessions in their correct saved order.
  if (prepend) $("sessions").insertBefore(fragment, $("sessions").firstElementChild);
  else $("sessions").appendChild(fragment);

  // Seed badge icon + field rules for the just-added card (after insert so it's live).
  const liveCard = prepend ? $("sessions").firstElementChild : $("sessions").lastElementChild;
  const liveUse = liveCard.querySelector(".sport-ic use");
  if (liveUse) setUse(liveUse, SPORT_ICON[typeSel.value] || "s-run");
  applySportRules(liveCard);
}

// Set an SVG <use> target with a legacy xlink:href fallback (older Safari).
function setUse(useEl, symbolId) {
  useEl.setAttribute("href", "#" + symbolId);
  useEl.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#" + symbolId);
}

// Enable only the fields that apply to the card's current sport; disable and
// CLEAR the rest. Clearing is contract-safe: collectSessions reads the same
// keys and numberOrNull turns a blank into null, so disabled fields save as null.
function applySportRules(card) {
  const sport = card.querySelector(".session-type").value;
  const allowed = new Set(SPORT_FIELDS[sport] || []);
  Object.entries(FIELD_CONTROLS).forEach(([field, selectors]) => {
    const wrap = card.querySelector(`[data-field="${field}"]`);
    const on = allowed.has(field);
    if (wrap) wrap.classList.toggle("field-off", !on);
    selectors.forEach(sel => {
      const el = card.querySelector(sel);
      if (!el) return;
      el.disabled = !on;
      if (!on) {
        if (el.classList.contains("hr-slider")) el.value = 0;
        else if (el.tagName === "SELECT") el.value = "none";
        else el.value = "";
      }
    });
  });
}

// Keep a slider and its number box in sync. A blank number means "no value"
// (slider rests at 0); typing/moving either updates the other.
function wireHrControl(card, numSel, sliderSel, initial) {
  const num = card.querySelector(numSel);
  const slider = card.querySelector(sliderSel);
  const seed = initial ?? "";
  num.value = seed;
  slider.value = seed === "" ? 0 : seed;

  slider.addEventListener("input", () => {
    num.value = slider.value === "0" ? "" : slider.value;
  });
  num.addEventListener("input", () => {
    const v = num.value === "" ? 0 : Math.max(0, Math.min(300, Number(num.value)));
    slider.value = isFinite(v) ? v : 0;
  });
}

$("addSession").addEventListener("click", () => addSession({}, true));

function collectSessions() {
  return [...document.querySelectorAll("#sessions .session-card")].map(card => ({
    type: card.querySelector(".session-type").value,
    date: card.querySelector(".session-date").value,
    duration: numberOrNull(card.querySelector(".session-duration").value),
    distance: numberOrNull(card.querySelector(".session-distance").value),
    unit: card.querySelector(".session-unit").value,
    rpe: numberOrNull(card.querySelector(".session-rpe").value),
    avgHeartRate: numberOrNull(card.querySelector(".session-avg-hr").value),
    maxHeartRate: numberOrNull(card.querySelector(".session-max-hr").value),
    restingHeartRate: numberOrNull(card.querySelector(".session-resting-hr").value),
    notes: card.querySelector(".session-notes").value.trim()
  }));
}

function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

// Clear the Log form for the next week (runs after a successful save)
function resetForm() {
  $("weekNumber").value = (state.data?.weeks?.length || 0) + 1;
  $("weeklyRpe").value = "";
  setDefaultDates();
  $("sessions").innerHTML = "";
  addSession();
  $("saveStatus").textContent = "";
  $("saveStatus").className = "status";
}

function validateWeek() {
  const weekNumber = Number($("weekNumber").value);
  const start = $("startDate").value;
  const end = $("endDate").value;
  const weeklyRpe = $("weeklyRpe").value;

  if (!Number.isInteger(weekNumber) || weekNumber < 1) return "Week number must be 1 or higher.";
  if (!start || !end) return "Week start and end dates are required.";
  if (start > end) return "Week end cannot be before week start.";
  if (weeklyRpe !== "" && (Number(weeklyRpe) < 1 || Number(weeklyRpe) > 10)) return "Weekly RPE must be between 1 and 10.";

  for (const session of collectSessions()) {
    if (!session.date) return "Every session needs a date.";
    if (session.date < start || session.date > end) return "A session date is outside the selected week.";
    if (session.rpe !== null && (session.rpe < 1 || session.rpe > 10)) return "Session RPE must be between 1 and 10.";
  }
  return null;
}

async function saveWeek() {
  const validationError = validateWeek();
  if (validationError) {
    setStatus($("saveStatus"), validationError, "error");
    return;
  }

  $("saveBtn").disabled = true;
  $("saveBtn").textContent = "Saving…";
  setStatus($("saveStatus"), "Saving and verifying…");

  try {
    const currentFile = await github(state.path);
    const latestData = decodeGithubContent(currentFile.content);
    if (!Array.isArray(latestData.weeks)) latestData.weeks = [];

    const week = {
      weekNumber: Number($("weekNumber").value),
      startDate: $("startDate").value,
      endDate: $("endDate").value,
      weeklyRpe: numberOrNull($("weeklyRpe").value),
      sessions: collectSessions()
    };

    const index = latestData.weeks.findIndex(w =>
      w.weekNumber === week.weekNumber ||
      (w.startDate === week.startDate && w.endDate === week.endDate)
    );

    if (index >= 0) latestData.weeks[index] = week;
    else latestData.weeks.push(week);

    latestData.weeks.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

    await createDataFile(latestData, `Update training week ${week.weekNumber}`, currentFile.sha);

    const verifyFile = await github(state.path);
    const verified = decodeGithubContent(verifyFile.content);
    const saved = verified.weeks?.find(w =>
      w.weekNumber === week.weekNumber &&
      w.startDate === week.startDate &&
      w.endDate === week.endDate
    );

    if (!saved || JSON.stringify(saved) !== JSON.stringify(week)) {
      throw new Error("GitHub accepted the update, but the saved week could not be verified.");
    }

    state.data = verified;
    $("saveStatus").textContent = "";
    $("saveStatus").className = "status";
    $("lastSaved").textContent = `Week ${week.weekNumber} saved and verified at ${new Date().toLocaleString()}.`;
    $("lastSaved").classList.remove("hidden");
    renderHistory(verified.weeks);
    openModal("Week Saved", "Your training data was saved to GitHub and read back successfully.");
  } catch (error) {
    setStatus($("saveStatus"), error.message.includes("verify")
      ? "Could not verify the save. Your form is still here—try again."
      : `Save failed: ${error.message}`, "error");
  } finally {
    $("saveBtn").disabled = false;
    $("saveBtn").innerHTML = '<svg class="ic"><use href="#i-check" xlink:href="#i-check"/></svg>Save Week';
  }
}

/* ---- History & Browse ---- */
function getFilteredWeeks() {
  let weeks = state.data?.weeks || [];
  const from = $("filterFrom").value;
  const to = $("filterTo").value;
  const week = $("filterWeek").value;
  const month = $("filterMonth").value;

  return weeks.filter(w => {
    if (from && w.endDate < from) return false;
    if (to && w.startDate > to) return false;
    if (week && Number(w.weekNumber) !== Number(week)) return false;
    if (month && !String(w.startDate).startsWith(month) && !String(w.endDate).startsWith(month)) return false;
    return true;
  });
}

// Flatten to individual sessions for the session view / sport filter / export
function getFilteredSessions() {
  const sport = $("filterSport").value;
  const from = $("filterFrom").value;
  const to = $("filterTo").value;
  const rows = [];
  getFilteredWeeks().forEach(w => {
    (w.sessions || []).forEach(s => {
      if (sport && s.type !== sport) return;
      if (from && s.date < from) return;
      if (to && s.date > to) return;
      rows.push({ ...s, weekNumber: w.weekNumber });
    });
  });
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return rows;
}

function applyFilters() {
  const mode = $("viewMode").value;
  const sport = $("filterSport").value;
  renderCharts(getFilteredSessions());
  if (mode === "sessions") {
    const sessions = getFilteredSessions();
    renderSessions(sessions);
    const mins = sessions.reduce((a, s) => a + (s.duration || 0), 0);
    $("browseSummary").textContent = `${sessions.length} session(s) · ${mins} min total${sport ? ` · ${SPORT_LABELS[sport]}` : ""}`;
    $("browseSummary").classList.toggle("hidden", !sessions.length);
  } else {
    let weeks = getFilteredWeeks();
    if (sport) weeks = weeks.filter(w => (w.sessions || []).some(s => s.type === sport));
    renderHistory(weeks);
    $("browseSummary").textContent = `${weeks.length} week(s)${sport ? ` with ${SPORT_LABELS[sport]}` : ""}`;
    $("browseSummary").classList.toggle("hidden", !weeks.length);
  }
}

/* ---- Charts (dependency-free SVG, read-only) ---- */
const CHART_SPORTS = ["swim", "bike", "run"];
const SPORT_COLOR = { swim: "#0ea5e9", bike: "#16a34a", run: "#ff5a1f" };
const SPORT_NAME = { swim: "Swim", bike: "Bike", run: "Run" };
const HR_SERIES = [
  { key: "maxHeartRate", name: "Max HR", color: "#d92d20" },
  { key: "avgHeartRate", name: "Avg HR", color: "#ff5a1f" },
  { key: "restingHeartRate", name: "Resting HR", color: "#0ea5e9" }
];

// Speed in distance-units per minute. Swim is m/min; bike/run km/min.
// Each discipline is plotted on its OWN normalized track (units differ), so
// lines show relative progress over time, never cross-sport comparison.
function sessionSpeed(s) {
  if (s.distance == null || !s.duration || s.unit === "none" || !s.unit) return null;
  const v = Number(s.distance) / Number(s.duration);
  return isFinite(v) && v > 0 ? v : null;
}

// Build a time-ordered list of {date, value} for a sport's speed.
function speedSeries(sessions, sport) {
  return sessions
    .filter(s => s.type === sport)
    .map(s => ({ date: s.date, value: sessionSpeed(s) }))
    .filter(p => p.date && p.value != null)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function hrSeries(sessions, key) {
  return sessions
    .map(s => ({ date: s.date, value: s[key] }))
    .filter(p => p.date && p.value != null && Number(p.value) > 0)
    .map(p => ({ date: p.date, value: Number(p.value) }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Draw a multi-series line chart into an SVG string.
// series: [{ name, color, points: [{date, value}], normalize?: bool }]
function lineChartSVG(series, { yLabel = "", normalize = false } = {}) {
  const live = series.filter(s => s.points.length);
  if (!live.length) return "";

  // Collect all dates across series for a shared x-axis.
  const allDates = [...new Set(live.flatMap(s => s.points.map(p => p.date)))].sort();
  const W = 560, H = 220, padL = 44, padR = 14, padT = 16, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const xAt = d => allDates.length === 1
    ? padL + plotW / 2
    : padL + (allDates.indexOf(d) / (allDates.length - 1)) * plotW;

  // y-scale: per-series normalized to 0..1 (speed, differing units) or shared (HR, bpm).
  let yAt, yTicks;
  if (normalize) {
    yAt = (val, s) => {
      const vs = s.points.map(p => p.value);
      const lo = Math.min(...vs), hi = Math.max(...vs);
      const t = hi === lo ? 0.5 : (val - lo) / (hi - lo);
      return padT + (1 - t) * plotH;
    };
    yTicks = "";
  } else {
    const allVals = live.flatMap(s => s.points.map(p => p.value));
    let lo = Math.min(...allVals), hi = Math.max(...allVals);
    if (lo === hi) { lo -= 5; hi += 5; }
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    yAt = val => padT + (1 - (val - lo) / (hi - lo)) * plotH;
    const t0 = Math.round(lo), t1 = Math.round((lo + hi) / 2), t2 = Math.round(hi);
    yTicks = [t0, t1, t2].map(t =>
      `<text x="${padL - 8}" y="${yAt(t) + 4}" class="c-axis" text-anchor="end">${t}</text>
       <line x1="${padL}" y1="${yAt(t)}" x2="${W - padR}" y2="${yAt(t)}" class="c-grid"/>`
    ).join("");
  }

  const lines = live.map(s => {
    const pts = s.points.map(p => `${xAt(p.date).toFixed(1)},${yAt(p.value, s).toFixed(1)}`).join(" ");
    const dots = s.points.map(p =>
      `<circle cx="${xAt(p.date).toFixed(1)}" cy="${yAt(p.value, s).toFixed(1)}" r="3.2" fill="${s.color}"/>`
    ).join("");
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.4"
            stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  }).join("");

  // sparse x labels (first, middle, last)
  const idxs = allDates.length <= 1 ? [0] : [0, Math.floor((allDates.length - 1) / 2), allDates.length - 1];
  const xLabels = [...new Set(idxs)].map(i =>
    `<text x="${xAt(allDates[i]).toFixed(1)}" y="${H - 10}" class="c-axis" text-anchor="middle">${allDates[i].slice(5)}</text>`
  ).join("");

  const legend = live.map(s =>
    `<span class="c-key"><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`
  ).join("");

  return `<div class="chart-legend">${legend}</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(yLabel)} trend">
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" class="c-grid"/>
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" class="c-grid"/>
      ${yTicks}${lines}${xLabels}
    </svg>`;
}

function renderCharts(sessions) {
  const el = $("charts");
  if (!el) return;
  const blocks = [];

  // Speed progress — one normalized line per discipline (units differ).
  const speed = CHART_SPORTS
    .map(sp => ({ name: SPORT_NAME[sp], color: SPORT_COLOR[sp], points: speedSeries(sessions, sp) }))
    .filter(s => s.points.length);
  if (speed.length) {
    blocks.push(`<div class="chart-card">
      <div class="chart-head"><svg class="ic"><use href="#i-trend" xlink:href="#i-trend"/></svg><h3>Speed Progress</h3>
        <span class="chart-note">distance ÷ time over the season · each sport scaled to its own range</span></div>
      ${lineChartSVG(speed, { normalize: true })}
    </div>`);
  }

  // Heart-rate trend — avg / max / resting, shared bpm axis.
  const hr = HR_SERIES
    .map(h => ({ name: h.name, color: h.color, points: hrSeries(sessions, h.key) }))
    .filter(s => s.points.length);
  if (hr.length) {
    blocks.push(`<div class="chart-card">
      <div class="chart-head"><svg class="ic"><use href="#i-heart" xlink:href="#i-heart"/></svg><h3>Heart Rate Trend</h3>
        <span class="chart-note">beats per minute over time</span></div>
      ${lineChartSVG(hr, { yLabel: "bpm" })}
    </div>`);
  }

  if (!blocks.length) {
    el.innerHTML = `<div class="empty"><span class="big"><svg class="ic"><use href="#i-trend" xlink:href="#i-trend"/></svg></span>No chartable data yet. Log sessions with distance and duration for speed, or heart rate for the HR trend.</div>`;
    el.classList.remove("hidden");
    return;
  }
  el.innerHTML = blocks.join("");
  el.classList.remove("hidden");
}

function renderHistory(weeks) {
  const container = $("historyResults");
  if (!weeks.length) {
    container.innerHTML = `<div class="empty"><span class="big"><svg class="ic"><use href="#i-archive" xlink:href="#i-archive"/></svg></span>No weeks match yet. Log a week or clear the filters.</div>`;
    return;
  }
  container.innerHTML = weeks.slice().reverse().map(w => `
    <article class="history-item" data-week="${escapeHtml(String(w.weekNumber))}">
      <div class="hi-main">
        <strong>Week ${escapeHtml(String(w.weekNumber))} · ${escapeHtml(w.startDate)} → ${escapeHtml(w.endDate)}</strong>
        <span>${w.sessions?.length || 0} session(s) · RPE ${w.weeklyRpe ?? "—"}</span>
      </div>
      <div class="hi-actions">
        <button class="hi-btn" type="button" data-edit="${escapeHtml(String(w.weekNumber))}"><svg class="ic"><use href="#i-edit" xlink:href="#i-edit"/></svg>Edit</button>
        <button class="hi-btn del" type="button" data-delete="${escapeHtml(String(w.weekNumber))}"><svg class="ic"><use href="#i-trash" xlink:href="#i-trash"/></svg>Delete</button>
      </div>
    </article>
  `).join("");
}

function renderSessions(sessions) {
  const container = $("historyResults");
  if (!sessions.length) {
    container.innerHTML = `<div class="empty"><span class="big"><svg class="ic"><use href="#i-search" xlink:href="#i-search"/></svg></span>No sessions match these filters.</div>`;
    return;
  }
  container.innerHTML = sessions.map(s => {
    const dist = s.distance != null && s.unit && s.unit !== "none" ? `${s.distance} ${s.unit}` : null;
    const meta = [s.duration != null ? `${s.duration} min` : null, dist].filter(Boolean).join(" · ");
    const hr = s.avgHeartRate != null ? `${s.avgHeartRate} bpm avg` : null;
    return `
    <div class="session-row" data-type="${escapeHtml(s.type)}">
      <span class="sport">${SPORT_LABELS[s.type] || escapeHtml(s.type)}</span>
      <span class="meta">${escapeHtml(s.date)}</span>
      ${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ""}
      <span class="pill">W${escapeHtml(String(s.weekNumber))}</span>
      ${s.rpe != null ? `<span class="pill rpe">RPE ${escapeHtml(String(s.rpe))}</span>` : ""}
      ${hr ? `<span class="pill hr">${escapeHtml(hr)}</span>` : ""}
      <button class="hi-btn sr-edit" type="button" data-edit="${escapeHtml(String(s.weekNumber))}"><svg class="ic"><use href="#i-edit" xlink:href="#i-edit"/></svg>Edit week</button>
      ${s.notes ? `<span class="notes">${escapeHtml(s.notes)}</span>` : ""}
    </div>`;
  }).join("");
}

$("filterBtn").addEventListener("click", applyFilters);
$("viewMode").addEventListener("change", applyFilters);
$("filterSport").addEventListener("change", applyFilters);

$("clearFilterBtn").addEventListener("click", () => {
  ["filterFrom", "filterTo", "filterWeek", "filterMonth"].forEach(id => $(id).value = "");
  $("filterSport").value = "";
  applyFilters();
});

/* ---- Edit & Delete saved weeks (same read-modify-write-verify path) ---- */

// Delegated clicks for Edit/Delete buttons in History (weeks view) and Sessions view.
$("historyResults").addEventListener("click", (e) => {
  const editBtn = e.target.closest("[data-edit]");
  if (editBtn) { editWeek(Number(editBtn.dataset.edit)); return; }
  const delBtn = e.target.closest("[data-delete]");
  if (delBtn) { promptDeleteWeek(Number(delBtn.dataset.delete)); return; }
});

// Load a saved week back into the Log form for editing, then switch to Log.
// Saving re-runs saveWeek, which upserts by weekNumber/dates — overwriting in place.
function editWeek(weekNumber) {
  const week = (state.data?.weeks || []).find(w => Number(w.weekNumber) === weekNumber);
  if (!week) return;

  $("weekNumber").value = week.weekNumber;
  $("startDate").value = week.startDate || "";
  $("endDate").value = week.endDate || "";
  $("weeklyRpe").value = week.weeklyRpe ?? "";

  // Rebuild session cards from the saved sessions (addSession applies per-sport rules).
  $("sessions").innerHTML = "";
  const sessions = week.sessions || [];
  if (sessions.length) sessions.forEach(s => addSession(s));
  else addSession();

  switchTab("log");
  $("saveStatus").textContent = `Editing week ${week.weekNumber}. Make changes and press Save Week to overwrite it.`;
  $("saveStatus").className = "status";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Confirmation step before a destructive repo write.
let pendingDeleteWeek = null;
function promptDeleteWeek(weekNumber) {
  const week = (state.data?.weeks || []).find(w => Number(w.weekNumber) === weekNumber);
  if (!week) return;
  pendingDeleteWeek = weekNumber;
  $("confirmTitle").textContent = `Delete week ${week.weekNumber}?`;
  $("confirmMessage").textContent =
    `This permanently removes week ${week.weekNumber} (${week.startDate} → ${week.endDate}, ${week.sessions?.length || 0} session(s)) from your private repository. This can't be undone.`;
  $("confirmModal").showModal();
}

$("confirmCancel").addEventListener("click", () => {
  pendingDeleteWeek = null;
  $("confirmModal").close();
});

$("confirmDelete").addEventListener("click", async () => {
  const weekNumber = pendingDeleteWeek;
  $("confirmModal").close();
  if (weekNumber == null) return;
  await deleteWeek(weekNumber);
  pendingDeleteWeek = null;
});

// Remove a week: read latest (fresh sha) -> filter it out -> PUT -> verify absent.
async function deleteWeek(weekNumber) {
  setStatus($("saveStatus"), `Deleting week ${weekNumber}…`);
  try {
    const currentFile = await github(state.path);
    const latestData = decodeGithubContent(currentFile.content);
    if (!Array.isArray(latestData.weeks)) latestData.weeks = [];

    const before = latestData.weeks.length;
    latestData.weeks = latestData.weeks.filter(w => Number(w.weekNumber) !== Number(weekNumber));
    if (latestData.weeks.length === before) {
      // Already gone remotely — resync local state and report.
      state.data = latestData;
      renderHistory(state.data.weeks);
      applyFilters();
      setStatus($("saveStatus"), `Week ${weekNumber} was already removed.`, "success");
      return;
    }

    await createDataFile(latestData, `Delete training week ${weekNumber}`, currentFile.sha);

    const verifyFile = await github(state.path);
    const verified = decodeGithubContent(verifyFile.content);
    const stillThere = (verified.weeks || []).some(w => Number(w.weekNumber) === Number(weekNumber));
    if (stillThere) throw new Error("GitHub accepted the change, but the week is still present on read-back.");

    state.data = verified;
    renderHistory(state.data.weeks);
    applyFilters();
    $("lastSaved").textContent = `Week ${weekNumber} deleted at ${new Date().toLocaleString()}.`;
    $("lastSaved").classList.remove("hidden");
    setStatus($("saveStatus"), "", "");
    openModal("Week Deleted", `Week ${weekNumber} was removed from GitHub and the change was verified.`);
  } catch (error) {
    setStatus($("saveStatus"), `Delete failed: ${error.message}`, "error");
  }
}

$("downloadBtn").addEventListener("click", () => {
  if (!state.data) return;
  downloadJson(state.data, "athlete.json");
});

/* Download ONLY the filtered view — a separate read-only export, not the data file */
$("exportFilteredBtn").addEventListener("click", () => {
  if (!state.data) return;
  const mode = $("viewMode").value;
  const payload = mode === "sessions"
    ? { exportType: "filtered-sessions", generatedAt: new Date().toISOString(), sessions: getFilteredSessions() }
    : { exportType: "filtered-weeks", generatedAt: new Date().toISOString(), weeks: getFilteredWeeks() };
  downloadJson(payload, `athlete-${mode}-filtered.json`);
});

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

$("connectBtn").addEventListener("click", connect);
$("saveBtn").addEventListener("click", saveWeek);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}

// ---- Startup splash cleanup ----
// The intro animation is pure CSS; this just removes the overlay from the DOM
// once it has faded out so it can never intercept clicks. Reduced-motion users
// (CSS hides .intro) get it removed immediately.
(function dismissIntro() {
  const splash = $("introSplash");
  if (!splash) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const remove = () => splash.remove();
  if (reduce) { remove(); return; }
  // Fallback timeout slightly longer than the CSS timeline (~3.7s) in case the
  // animationend event is missed; whichever fires first wins.
  const timer = setTimeout(remove, 3900);
  splash.addEventListener("animationend", (e) => {
    if (e.animationName === "introFade") { clearTimeout(timer); remove(); }
  });
})();
