const state = {
  token: "",
  username: "sanskar001",
  repo: "my-training-log-data",
  path: "data/athlete.json",
  data: null
};

const $ = (id) => document.getElementById(id);
const tokenInput = $("token");

function setStatus(el, message, type = "") {
  el.textContent = message;
  el.className = `status ${type}`;
}

function openModal(title, message, icon = "✓") {
  $("modalIcon").textContent = icon;
  $("modalTitle").textContent = title;
  $("modalMessage").textContent = message;
  $("modal").showModal();
}

$("modalClose").addEventListener("click", () => $("modal").close());

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
  const response = await fetch(`${apiBase()}/contents/${path}`, {
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

    $("connectionBadge").textContent = "✓ Connected";
    $("connectionBadge").className = "badge online";
    $("connectCard").classList.add("hidden");
    $("logCard").classList.remove("hidden");
    $("historyCard").classList.remove("hidden");
    setStatus($("connectStatus"), "Connected and verified.", "success");
    setDefaultDates();
    renderHistory(state.data.weeks);
  } catch (error) {
    state.token = "";
    $("connectBtn").disabled = false;
    $("connectBtn").textContent = "🔗 Connect GitHub";
    const message = error.status === 401
      ? "Token is invalid or expired. Check the token and try again."
      : error.status === 403
        ? "GitHub denied access. Confirm Contents → Read and write for this repository."
        : error.message;
    setStatus($("connectStatus"), message, "error");
  } finally {
    $("connectBtn").disabled = false;
    $("connectBtn").textContent = "🔗 Connect GitHub";
  }
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

function addSession(values = {}) {
  const fragment = $("sessionTemplate").content.cloneNode(true);
  const card = fragment.querySelector(".session-card");
  card.querySelector(".session-type").value = values.type || "run";
  card.querySelector(".session-date").value = values.date || $("startDate").value;
  card.querySelector(".session-duration").value = values.duration ?? "";
  card.querySelector(".session-distance").value = values.distance ?? "";
  card.querySelector(".session-unit").value = values.unit || "km";
  card.querySelector(".session-rpe").value = values.rpe ?? "";
  card.querySelector(".session-notes").value = values.notes || "";
  card.querySelector(".remove-session").addEventListener("click", () => card.remove());
  $("sessions").appendChild(fragment);
}

$("addSession").addEventListener("click", () => addSession());

function collectSessions() {
  return [...document.querySelectorAll(".session-card")].map(card => ({
    type: card.querySelector(".session-type").value,
    date: card.querySelector(".session-date").value,
    duration: numberOrNull(card.querySelector(".session-duration").value),
    distance: numberOrNull(card.querySelector(".session-distance").value),
    unit: card.querySelector(".session-unit").value,
    rpe: numberOrNull(card.querySelector(".session-rpe").value),
    notes: card.querySelector(".session-notes").value.trim()
  }));
}

function numberOrNull(value) {
  return value === "" ? null : Number(value);
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
  $("saveBtn").textContent = "⏳ Locking it in…";
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
    $("lastSaved").textContent = `✓ Week ${week.weekNumber} saved and verified at ${new Date().toLocaleString()}.`;
    $("lastSaved").classList.remove("hidden");
    renderHistory(verified.weeks);
    openModal("Week Locked In", "Your training data was saved to GitHub and read back successfully.", "🏁");
  } catch (error) {
    setStatus($("saveStatus"), error.message.includes("verify")
      ? "Could not verify the save. Your form is still here—try again."
      : `Save failed: ${error.message}`, "error");
  } finally {
    $("saveBtn").disabled = false;
    $("saveBtn").textContent = "🏁 Lock In This Week";
  }
}

function renderHistory(weeks) {
  const container = $("historyResults");
  if (!weeks.length) {
    container.innerHTML = `<div class="empty">No weeks saved yet.</div>`;
    return;
  }

  container.innerHTML = weeks.slice().reverse().map(w => `
    <article class="history-item">
      <strong>Week ${escapeHtml(String(w.weekNumber))} · ${escapeHtml(w.startDate)} → ${escapeHtml(w.endDate)}</strong>
      <span>${w.sessions?.length || 0} session(s) · RPE ${w.weeklyRpe ?? "—"}</span>
    </article>
  `).join("");
}

function filterHistory() {
  let weeks = state.data?.weeks || [];
  const from = $("filterFrom").value;
  const to = $("filterTo").value;
  const week = $("filterWeek").value;
  const month = $("filterMonth").value;

  weeks = weeks.filter(w => {
    if (from && w.endDate < from) return false;
    if (to && w.startDate > to) return false;
    if (week && Number(w.weekNumber) !== Number(week)) return false;
    if (month && !String(w.startDate).startsWith(month) && !String(w.endDate).startsWith(month)) return false;
    return true;
  });

  renderHistory(weeks);
}

$("connectBtn").addEventListener("click", connect);
$("saveBtn").addEventListener("click", saveWeek);
$("filterBtn").addEventListener("click", filterHistory);

$("clearFilterBtn").addEventListener("click", () => {
  ["filterFrom", "filterTo", "filterWeek", "filterMonth"].forEach(id => $(id).value = "");
  renderHistory(state.data?.weeks || []);
});

$("resetBtn").addEventListener("click", () => {
  $("weekNumber").value = (state.data?.weeks?.length || 0) + 1;
  $("weeklyRpe").value = "";
  setDefaultDates();
  $("sessions").innerHTML = "";
  addSession();
  $("saveStatus").textContent = "";
  $("lastSaved").classList.add("hidden");
});

$("downloadBtn").addEventListener("click", () => {
  if (!state.data) return;
  const blob = new Blob([JSON.stringify(state.data, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "athlete.json";
  a.click();
  URL.revokeObjectURL(url);
});

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}
