// ===== Config & API Resolution =====
function getCandidateApiUrls() {
  const origin = window.location.origin;
  const isLocal = !origin || origin.startsWith("file:") ||
                  window.location.hostname === "localhost" ||
                  window.location.hostname === "127.0.0.1";

  // The deployed backend Web Service URL
  const BACKEND_URL = "https://project1advance-1.onrender.com";

  if (isLocal) {
    if (window.location.port === "8000") {
      return [origin, "http://127.0.0.1:8000", BACKEND_URL];
    }
    return ["http://127.0.0.1:8000", "http://localhost:8000", BACKEND_URL];
  }

  // If on the deployed frontend Static Site (e.g. project1adv.onrender.com),
  // we must make requests to the backend Web Service URL.
  return [BACKEND_URL, origin, "http://127.0.0.1:8000"];
}

async function fetchWithTimeout(url, options, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

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
function describeHttpError(status, detail) {
  if (detail) return `Server error (${status}): ${detail}`;
  if (status === 422) return "The server rejected some values (HTTP 422). Please verify all inputs.";
  if (status === 503) return "The prediction model isn't loaded on the server (HTTP 503). Ensure Mental_Health_Model.pkl exists.";
  if (status >= 500) return `The server hit an internal error while predicting (HTTP ${status}).`;
  return `The request failed with HTTP ${status}.`;
}

// ===== Submit =====
form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("error").hidden = true;
  if (!validate()) return showError("Some fields need attention.");

  const btn = $("analyze");
  btn.disabled = true;

  const loader = $("loader");
  const loaderText = loader.querySelector("p");
  if (loaderText) loaderText.textContent = "Analyzing student data...";
  loader.hidden = false;

  const waitTimer = setTimeout(() => {
    if (loaderText && !loader.hidden) {
      loaderText.textContent = "Connecting to server (waking up cloud service if sleeping, please wait up to 1-2 minutes)...";
    }
  }, 2500);

  const payload = JSON.stringify(buildPayload());
  const candidateUrls = [...new Set(getCandidateApiUrls().filter(Boolean))];
  let lastError = null;
  let successResult = null;

  for (const baseUrl of candidateUrls) {
    try {
      const res = await fetchWithTimeout(`${baseUrl}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      }, 90000);

      if (!res.ok) {
        let errDetail = "";
        try {
          const errBody = await res.json();
          if (errBody && errBody.detail) {
            errDetail = Array.isArray(errBody.detail)
              ? errBody.detail.map((d) => d.msg || JSON.stringify(d)).join(", ")
              : String(errBody.detail);
          }
        } catch (_) {}
        throw { http: res.status, detail: errDetail, url: baseUrl };
      }

      successResult = await res.json();
      break;
    } catch (err) {
      lastError = err;
      // If server responded with an HTTP status code (e.g. 422), do not retry another server since this server is responding
      if (err.http) {
        break;
      }
    }
  }

  clearTimeout(waitTimer);
  loader.hidden = true;
  btn.disabled = false;

  if (successResult) {
    renderResult(successResult);
    showResult();
  } else {
    if (lastError && lastError.http) {
      showError(describeHttpError(lastError.http, lastError.detail));
    } else {
      showError(
        "Could not connect to the prediction server. Please make sure the local server is running by executing: python -m uvicorn main:app --host 127.0.0.1 --port 8000"
      );
    }
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
