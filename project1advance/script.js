// ===== Config =====
const API_BASE_URL = "http://127.0.0.1:8000";

// Fields copied exactly from the StudentInput Pydantic model in main.py
const num = (name, label, min, max, step, hint, ph) => ({ name, label, type: "number", min, max, step, hint, ph, req: true });
const sel = (name, label, opts, hint) => ({ name, label, type: "select", opts, hint, req: true });
const FIELDS = [
  num("Age", "Age", 10, 100, 1, "Years (10–100)", 21),
  sel("Gender", "Gender", ["Male", "Female"]),
  { name: "Country", label: "Country", type: "text", hint: "Optional. Unlisted countries are grouped as 'Other'.", ph: "e.g. Canada", req: false },
  sel("Academic_Level", "Academic level", ["Undergraduate", "Graduate", "High School"]),
  sel("Most_Used_Platform", "Most used platform", ["Instagram","Facebook","WhatsApp","LinkedIn","Snapchat","TikTok","YouTube","Twitter","VKontakte","KakaoTalk","LINE","WeChat"]),
  sel("Purpose_Of_Use", "Main purpose of use", ["Entertainment","Education","Networking","News"]),
  num("Avg_Daily_Usage_Hours", "Daily social media hours", 0, 24, 0.1, "Hours per day (0–24)", 4.6),
  num("Daily_Unlocks", "Daily phone unlocks", 0, 1000, 1, "Times per day (0–1000)", 166),
  num("Study_Hours", "Daily study hours", 0, 24, 0.1, "Hours per day (0–24)", 4),
  num("Physical_Activity_Hours", "Daily physical activity hours", 0, 24, 0.1, "Hours per day (0–24)", 1.8),
  num("Sleep_Hours_Per_Night", "Sleep hours per night", 0, 24, 0.1, "Hours per night (0–24)", 6.7),
  sel("Stress_Level", "Stress level", ["Low","Medium","High","Very High"], "Perceived stress"),
];
const INTEGER_FIELDS = ["Age", "Daily_Unlocks"];

const $ = (id) => document.getElementById(id);
const form = $("form");

// ===== Build form =====
FIELDS.forEach((f) => {
  const w = document.createElement("div");
  w.className = "field";
  const control = f.type === "select"
    ? `<select id="${f.name}" name="${f.name}"><option value="">Select…</option>${f.opts.map((o) => `<option>${o}</option>`).join("")}</select>`
    : `<input id="${f.name}" name="${f.name}" type="${f.type}" ${f.type === "number" ? `min="${f.min}" max="${f.max}" step="${f.step}" inputmode="decimal"` : ""} placeholder="${f.ph ?? ""}">`;
  w.innerHTML = `<label for="${f.name}">${f.label}${f.req ? ' <span class="req">*</span>' : ""}</label>${control}<small>${f.hint ?? ""}</small><span class="fe" id="e-${f.name}"></span>`;
  form.appendChild(w);
});

// ===== Page navigation (one visible screen at a time) =====
function show(id) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
const showHome = () => show("page-home");
const showAnalysis = () => { $("error").hidden = true; show("page-analysis"); };
const showResult = () => show("page-result");

// ===== Validation + payload =====
function validate() {
  let ok = true;
  FIELDS.forEach((f) => {
    const el = $(f.name), v = el.value.trim();
    let msg = "";
    if (f.req && v === "") msg = "Required";
    else if (f.type === "number" && v !== "") {
      const n = Number(v);
      if (Number.isNaN(n) || n < f.min || n > f.max) msg = `Enter ${f.min}–${f.max}`;
      else if (INTEGER_FIELDS.includes(f.name) && !Number.isInteger(n)) msg = "Whole number only";
    }
    $("e-" + f.name).textContent = msg;
    el.classList.toggle("bad", !!msg);
    if (msg) ok = false;
  });
  return ok;
}

function buildPayload() {
  const data = {};
  FIELDS.forEach((f) => {
    const v = $(f.name).value.trim();
    if (f.type === "number") data[f.name] = Number(v);
    else if (f.name === "Country") data[f.name] = v || "Other"; // backend default
    else data[f.name] = v;
  });
  return data;
}

// ===== Errors =====
function showError(msg) {
  const e = $("error");
  e.textContent = msg + " You can fix the issue and press Analyze to retry.";
  e.hidden = false;
}
function describeHttpError(status, body) {
  if (status === 422) return "The server rejected some values (HTTP 422). Please check every field.";
  if (status === 503) return "The prediction model isn't loaded on the server (HTTP 503).";
  if (status >= 500) return `The server hit an error while predicting (HTTP ${status}).`;
  return `The request failed (HTTP ${status}).`;
}

// ===== Submit =====
form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("error").hidden = true;
  if (!validate()) return showError("Some fields need attention.");
  const btn = $("analyze");
  btn.disabled = true;
  $("loader").hidden = false;
  try {
    const res = await fetch(`${API_BASE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    if (!res.ok) throw { http: res.status };
    renderResult(await res.json());
    showResult();
  } catch (err) {
    showError(err.http
      ? describeHttpError(err.http)
      : "Can't reach the prediction server at " + API_BASE_URL + ". Check that the backend is running and open this page from http://127.0.0.1:8000.");
  } finally {
    $("loader").hidden = true;
    btn.disabled = false;
  }
});

$("reset").addEventListener("click", () => {
  form.reset();
  FIELDS.forEach((f) => { $("e-" + f.name).textContent = ""; $(f.name).classList.remove("bad"); });
  $("error").hidden = true;
});

// ===== Render real API response: predicted_mental_health_score, risk_category, status =====
function renderResult(r) {
  const score = Number(r.predicted_mental_health_score);
  $("score").textContent = score.toFixed(2);
  const ring = $("ring");
  ring.style.strokeDashoffset = 327;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ring.style.strokeDashoffset = 327 * (1 - Math.min(Math.max(score / 10, 0), 1));
  }));
  const b = $("badge");
  b.textContent = r.risk_category;
  b.className = "badge " + (/Excellent/.test(r.risk_category) ? "good" : /Good/.test(r.risk_category) ? "" : /Fair/.test(r.risk_category) ? "warn" : "risk");
  $("status").textContent = r.status;
}

// ===== 3D tilt on cards =====
document.addEventListener("mousemove", (e) => {
  document.querySelectorAll(".tilt").forEach((c) => {
    const r = c.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { c.style.transform = ""; return; }
    const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    c.style.transform = `rotateY(${x * 12}deg) rotateX(${-y * 12}deg) translateZ(10px)`;
  });
});

// ===== Neural-network background =====
(function () {
  const cv = $("bg"), ctx = cv.getContext("2d");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let w, h, pts = [];
  const resize = () => { w = cv.width = innerWidth; h = cv.height = innerHeight; pts = Array.from({ length: Math.min(70, w / 18) }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4 })); };
  addEventListener("resize", resize); resize();
  (function draw() {
    ctx.clearRect(0, 0, w, h);
    pts.forEach((p, i) => {
      p.x = (p.x + p.vx + w) % w; p.y = (p.y + p.vy + h) % h;
      ctx.fillStyle = "rgba(34,211,238,.7)"; ctx.fillRect(p.x, p.y, 2, 2);
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(p.x - pts[j].x, p.y - pts[j].y);
        if (d < 130) { ctx.strokeStyle = `rgba(139,92,246,${.25 * (1 - d / 130)})`; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke(); }
      }
    });
    requestAnimationFrame(draw);
  })();
})();
