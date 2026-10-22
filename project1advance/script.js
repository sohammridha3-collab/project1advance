// ===== Fast Backend Auto-Detection & Config =====
let activeBackendUrl = sessionStorage.getItem("mindscope_backend_url") || null;
let isDetectingBackend = false;

async function detectActiveBackend() {
  if (isDetectingBackend) return;
  isDetectingBackend = true;

  const origin = window.location.origin;
  const isLocal = !origin || origin.startsWith("file:") ||
                  window.location.hostname === "localhost" ||
                  window.location.hostname === "127.0.0.1";

  const candidates = [
    activeBackendUrl,
    "http://127.0.0.1:8001",
    "http://localhost:8001",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    (isLocal && window.location.port !== "5500" && window.location.port !== "5501") ? origin : null
  ].filter(Boolean);

  const uniqueCandidates = [...new Set(candidates)];

  // Race candidates in parallel with a fast 400ms health check
  const pingPromises = uniqueCandidates.map(async (url) => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 400);
    try {
      const res = await fetch(`${url}/health`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.app === "MindScope" || data.service === "Student Mental Health Prediction" || data.model_file_exists !== undefined) {
          return url;
        }
      }
    } catch (_) {
      clearTimeout(tid);
    }
    throw new Error("unreachable");
  });

  try {
    const fastest = await Promise.any(pingPromises);
    if (fastest) {
      activeBackendUrl = fastest;
      sessionStorage.setItem("mindscope_backend_url", fastest);
    }
  } catch (_) {
    // If no backend is reachable right now, offline AI engine handles everything instantly
  } finally {
    isDetectingBackend = false;
  }
}

// Pre-warm backend detection on startup
detectActiveBackend();

async function fetchWithTimeout(url, options, timeoutMs = 800) {
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

// Fields matching the StudentInput model
const num = (name, label, min, max, step, hint, ph) => ({ name, label, type: "number", min, max, step, hint, ph, req: true });
const sel = (name, label, opts, hint) => ({ name, label, type: "select", opts, hint, req: true });
const FIELDS = [
  num("Age", "Age", 10, 100, 1, "Years (10–100)", 21),
  sel("Gender", "Gender", ["Male", "Female"]),
  { name: "Country", label: "Country", type: "text", hint: "Optional. Unlisted countries are grouped as 'Other'.", ph: "e.g. Canada", req: false },
  sel("Academic_Level", "Academic level", ["Undergraduate", "Graduate", "High School"]),
  sel("Most_Used_Platform", "Most used platform", ["Instagram", "Facebook", "WhatsApp", "LinkedIn", "Snapchat", "TikTok", "YouTube", "Twitter", "VKontakte", "KakaoTalk", "LINE", "WeChat"]),
  sel("Purpose_Of_Use", "Main purpose of use", ["Entertainment", "Education", "Networking", "News"]),
  num("Avg_Daily_Usage_Hours", "Daily social media hours", 0, 24, 0.1, "Hours per day (0–24)", 4.6),
  num("Daily_Unlocks", "Daily phone unlocks", 0, 1000, 1, "Times per day (0–1000)", 166),
  num("Study_Hours", "Daily study hours", 0, 24, 0.1, "Hours per day (0–24)", 4.0),
  num("Physical_Activity_Hours", "Daily physical activity hours", 0, 24, 0.1, "Hours per day (0–24)", 1.8),
  num("Sleep_Hours_Per_Night", "Sleep hours per night", 0, 24, 0.1, "Hours per night (0–24)", 6.7),
  sel("Stress_Level", "Stress level", ["Low", "Medium", "High", "Very High"], "Perceived stress"),
];
const INTEGER_FIELDS = ["Age", "Daily_Unlocks"];

const $ = (id) => document.getElementById(id);
const form = $("form");

// ===== Build form =====
FIELDS.forEach((f) => {
  const w = document.createElement("div");
  w.className = "field";
  const control = f.type === "select"
    ? `<select id="${f.name}" name="${f.name}"><option value="">Select…</option>${f.opts.map((o) => `<option value="${o}">${o}</option>`).join("")}</select>`
    : `<input id="${f.name}" name="${f.name}" type="${f.type}" ${f.type === "number" ? `min="${f.min}" max="${f.max}" step="${f.step}" inputmode="decimal"` : ""} placeholder="${f.ph ?? ""}">`;
  w.innerHTML = `<label for="${f.name}">${f.label}${f.req ? ' <span class="req">*</span>' : ""}</label>${control}<small>${f.hint ?? ""}</small><span class="fe" id="e-${f.name}"></span>`;
  form.appendChild(w);
});

// ===== Helper to fill sample student data =====
window.fillSampleData = function() {
  const sample = {
    Age: 21,
    Gender: "Male",
    Country: "Canada",
    Academic_Level: "Undergraduate",
    Most_Used_Platform: "Instagram",
    Purpose_Of_Use: "Entertainment",
    Avg_Daily_Usage_Hours: 4.6,
    Daily_Unlocks: 166,
    Study_Hours: 4.0,
    Physical_Activity_Hours: 1.8,
    Sleep_Hours_Per_Night: 6.7,
    Stress_Level: "Medium"
  };
  Object.entries(sample).forEach(([key, val]) => {
    const el = $(key);
    if (el) {
      el.value = val;
      el.classList.remove("bad");
      const err = $("e-" + key);
      if (err) err.textContent = "";
    }
  });
  $("error").hidden = true;
};

// ===== Page navigation =====
function show(id) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "instant" });
}
const showHome = () => show("page-home");
const showAnalysis = () => {
  $("error").hidden = true;
  show("page-analysis");
  detectActiveBackend(); // Background probe when opening analysis tab
};
const showResult = () => show("page-result");

// ===== Validation + payload =====
function validate() {
  let ok = true;
  FIELDS.forEach((f) => {
    const el = $(f.name);
    if (!el) return;
    const v = el.value.trim();
    let msg = "";
    if (f.req && v === "") msg = "Required";
    else if (f.type === "number" && v !== "") {
      const n = Number(v);
      if (Number.isNaN(n) || n < f.min || n > f.max) msg = `Enter ${f.min}–${f.max}`;
      else if (INTEGER_FIELDS.includes(f.name) && !Number.isInteger(n)) msg = "Whole number only";
    }
    const errEl = $("e-" + f.name);
    if (errEl) errEl.textContent = msg;
    el.classList.toggle("bad", !!msg);
    if (msg) ok = false;
  });
  return ok;
}

function buildPayload() {
  const data = {};
  FIELDS.forEach((f) => {
    const el = $(f.name);
    const v = el ? el.value.trim() : "";
    if (f.type === "number") data[f.name] = Number(v);
    else if (f.name === "Country") data[f.name] = v || "Other";
    else data[f.name] = v;
  });
  return data;
}

// ===== Instant Offline Statistical Model Engine Fallback (<0.2ms) =====
function predictLocally(student) {
  const stressWeights = { "Low": 0, "Medium": 1, "High": 2, "Very High": 3 };
  const stressVal = stressWeights[student.Stress_Level] ?? 1;

  let base = 5.6195;
  base += 0.0227 * (student.Age - 21);
  base -= 0.2519 * student.Avg_Daily_Usage_Hours;
  base -= 0.0012 * (student.Daily_Unlocks - 171);
  base += 0.0841 * student.Study_Hours;
  base += 0.0255 * student.Physical_Activity_Hours;
  base += 0.2574 * student.Sleep_Hours_Per_Night;
  base -= 0.2104 * (stressVal - 1);

  if (["LinkedIn", "YouTube"].includes(student.Most_Used_Platform)) base += 0.15;
  if (["TikTok", "Snapchat"].includes(student.Most_Used_Platform)) base -= 0.15;

  const score = Math.min(9.8, Math.max(1.5, Math.round(base * 100) / 100));

  let category = "Good / Moderate";
  let status = "Balanced Health";
  if (score >= 7.5) {
    category = "Excellent / Low Risk";
    status = "Optimal Well-Being";
  } else if (score >= 6.0) {
    category = "Good / Moderate";
    status = "Balanced Health";
  } else if (score >= 4.5) {
    category = "Fair / Mild Concern";
    status = "Mild Fatigue Concern";
  } else {
    category = "Poor / High Risk";
    status = "High Risk / Attention Recommended";
  }

  const insights = generateClientInsights(student, score);

  return {
    predicted_mental_health_score: score,
    risk_category: category,
    status: status,
    insights: insights,
    source: "local_engine"
  };
}

function generateClientInsights(student, score) {
  const insights = [];

  if (student.Avg_Daily_Usage_Hours >= 5.0) {
    insights.push(
      `High social media screen time (${student.Avg_Daily_Usage_Hours}h/day) contributes heavily to mental fatigue. Trimming 1–2 hours daily noticeably boosts well-being.`
    );
  } else if (student.Avg_Daily_Usage_Hours <= 2.5) {
    insights.push(
      `Mindful social media usage (${student.Avg_Daily_Usage_Hours}h/day) is a strong positive protective factor against digital burnout.`
    );
  }

  if (student.Sleep_Hours_Per_Night < 6.0) {
    insights.push(
      `Sleep duration (${student.Sleep_Hours_Per_Night}h/night) is below recommended levels. Target 7 to 8 hours for cognitive recovery and mood stability.`
    );
  } else if (student.Sleep_Hours_Per_Night >= 7.0) {
    insights.push(
      `Consistent restorative sleep (${student.Sleep_Hours_Per_Night}h/night) strongly preserves stress resilience.`
    );
  }

  if (student.Daily_Unlocks >= 180) {
    insights.push(
      `Frequent phone checks (${student.Daily_Unlocks} unlocks/day) disrupt sustained academic focus. Consider scheduling silent focus blocks.`
    );
  }

  if (student.Physical_Activity_Hours < 1.0) {
    insights.push(
      "Low daily physical activity detected. Even 20–30 minutes of light aerobic exercise or brisk walking significantly elevates dopamine and reduces anxiety."
    );
  } else if (student.Physical_Activity_Hours >= 2.0) {
    insights.push(
      "Active lifestyle routine bolsters neurological health and emotional equilibrium."
    );
  }

  if (["High", "Very High"].includes(student.Stress_Level)) {
    insights.push(
      `Reported ${student.Stress_Level.toLowerCase()} stress level. Take short 5-minute breathing pauses between study sessions and leverage campus counseling.`
    );
  }

  if (insights.length === 0) {
    insights.push("Your daily lifestyle habits maintain positive balance across study, activity, and digital usage.");
  }

  return insights;
}

// ===== Errors =====
function showError(msg) {
  const e = $("error");
  e.textContent = msg + " You can fix the issue and press Analyze to retry.";
  e.hidden = false;
}

// ===== Fast Submit Handler =====
form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("error").hidden = true;
  if (!validate()) return showError("Some fields need attention.");

  const btn = $("analyze");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Analyzing…";

  const studentData = buildPayload();
  const payload = JSON.stringify(studentData);
  let finalResult = null;

  // 1. If active backend URL is pre-detected, fetch directly with a tight 500ms timeout
  if (activeBackendUrl) {
    try {
      const res = await fetchWithTimeout(`${activeBackendUrl}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      }, 500);

      if (res.ok) {
        const data = await res.json();
        if (data && data.predicted_mental_health_score !== undefined) {
          finalResult = data;
          finalResult.source = "live_model";
          finalResult.url = activeBackendUrl;
        }
      }
    } catch (_) {
      activeBackendUrl = null;
    }
  }

  // 2. If not yet resolved, race candidate local ports in parallel with 450ms timeout
  if (!finalResult) {
    const candidates = [
      "http://127.0.0.1:8001",
      "http://localhost:8001",
      "http://127.0.0.1:8000"
    ];

    const parallelRequests = candidates.map(async (baseUrl) => {
      const res = await fetchWithTimeout(`${baseUrl}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      }, 450);

      if (!res.ok) throw new Error("HTTP error " + res.status);
      const data = await res.json();
      if (data && data.predicted_mental_health_score !== undefined) {
        activeBackendUrl = baseUrl;
        sessionStorage.setItem("mindscope_backend_url", baseUrl);
        data.source = "live_model";
        data.url = baseUrl;
        return data;
      }
      throw new Error("Invalid payload");
    });

    try {
      finalResult = await Promise.any(parallelRequests);
    } catch (_) {
      // 3. Instant local statistical model fallback (<0.1ms)
      finalResult = predictLocally(studentData);
    }
  }

  btn.disabled = false;
  btn.textContent = originalText;

  // Render the result immediately
  renderResult(finalResult, studentData);
});

$("reset").addEventListener("click", () => {
  form.reset();
  FIELDS.forEach((f) => {
    const err = $("e-" + f.name);
    if (err) err.textContent = "";
    const el = $(f.name);
    if (el) el.classList.remove("bad");
  });
  $("error").hidden = true;
});

// ===== Render Result Dashboard (Instantaneous) =====
function renderResult(r, studentData) {
  // Switch to result page immediately
  showResult();

  const score = Number(r.predicted_mental_health_score);
  const scoreEl = $("score");
  const ring = $("ring");

  // Determine color theme based on score / risk category
  let ringColor = "#22d3ee";
  let badgeClass = "badge";
  let statusDesc = "Your habits show positive general balance with low to moderate mental health stress.";

  if (score >= 7.5 || /Excellent/i.test(r.risk_category)) {
    ringColor = "#34d399";
    badgeClass = "badge good";
    statusDesc = "Optimal emotional well-being. Your daily sleep, study, and physical activity habits provide strong psychological resilience.";
  } else if (score >= 6.0 || /Good/i.test(r.risk_category)) {
    ringColor = "#22d3ee";
    badgeClass = "badge ok";
    statusDesc = "Healthy baseline with good balance. Maintaining consistent sleep and physical activity will prevent digital fatigue.";
  } else if (score >= 4.5 || /Fair/i.test(r.risk_category)) {
    ringColor = "#fbbf24";
    badgeClass = "badge warn";
    statusDesc = "Mild concern detected. Screen time and study stress may be accumulating. Small daily habit adjustments are recommended.";
  } else {
    ringColor = "#f87171";
    badgeClass = "badge risk";
    statusDesc = "Elevated risk profile. High digital screen time, elevated stress, or restricted sleep are significantly impacting well-being.";
  }

  // Update ring color and animate
  ring.style.stroke = ringColor;
  ring.style.filter = `drop-shadow(0 0 8px ${ringColor})`;
  ring.style.strokeDashoffset = "327";

  // Fast score counter (250ms)
  const duration = 250;
  const startTime = performance.now();
  function animateScore(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    const currentScore = (score * easeProgress).toFixed(2);
    scoreEl.textContent = currentScore;
    if (progress < 1) {
      requestAnimationFrame(animateScore);
    } else {
      scoreEl.textContent = score.toFixed(2);
    }
  }
  requestAnimationFrame(animateScore);

  // Trigger SVG stroke immediately
  requestAnimationFrame(() => {
    const offset = 327 * (1 - Math.min(Math.max(score / 10, 0), 1));
    ring.style.strokeDashoffset = String(offset);
  });

  // Update Badges & Status
  const b = $("badge");
  if (b) {
    b.textContent = r.risk_category;
    b.className = badgeClass;
  }

  const s = $("status");
  if (s) {
    s.textContent = r.status || "Balanced Health";
    s.className = badgeClass;
  }

  const sDesc = $("status-desc");
  if (sDesc) {
    sDesc.textContent = statusDesc;
  }

  // Update Engine Chip
  const engineText = $("engine-text");
  if (engineText) {
    if (r.source === "live_model") {
      engineText.textContent = `Live RandomForest Model Connected (${r.url ? r.url.replace(/https?:\/\//, "") : "FastAPI"})`;
    } else {
      engineText.textContent = "Instant Offline AI Engine (0ms Latency)";
    }
  }

  // Update Habit Breakdown Meters
  if (studentData) {
    const screenHours = Number(studentData.Avg_Daily_Usage_Hours) || 0;
    const sleepHours = Number(studentData.Sleep_Hours_Per_Night) || 0;
    const studyHours = Number(studentData.Study_Hours) || 0;
    const activityHours = Number(studentData.Physical_Activity_Hours) || 0;

    const screenVal = $("metric-screen-val");
    const screenBar = $("metric-screen-bar");
    if (screenVal && screenBar) {
      screenVal.textContent = `${screenHours} hrs/day`;
      const pct = Math.min(Math.round((screenHours / 12) * 100), 100);
      screenBar.style.width = `${pct}%`;
      screenBar.style.background = screenHours > 5 ? "linear-gradient(90deg, #fbbf24, #f87171)" : "linear-gradient(90deg, #4f8cff, #22d3ee)";
    }

    const sleepVal = $("metric-sleep-val");
    const sleepBar = $("metric-sleep-bar");
    if (sleepVal && sleepBar) {
      sleepVal.textContent = `${sleepHours} hrs/night`;
      const pct = Math.min(Math.round((sleepHours / 10) * 100), 100);
      sleepBar.style.width = `${pct}%`;
      sleepBar.style.background = sleepHours < 6 ? "linear-gradient(90deg, #f87171, #fbbf24)" : "linear-gradient(90deg, #34d399, #22d3ee)";
    }

    const studyVal = $("metric-study-val");
    const studyBar = $("metric-study-bar");
    if (studyVal && studyBar) {
      studyVal.textContent = `${studyHours} hrs/day`;
      studyBar.style.width = `${Math.min(Math.round((studyHours / 8) * 100), 100)}%`;
    }

    const activityVal = $("metric-activity-val");
    const activityBar = $("metric-activity-bar");
    if (activityVal && activityBar) {
      activityVal.textContent = `${activityHours} hrs/day`;
      activityBar.style.width = `${Math.min(Math.round((activityHours / 3) * 100), 100)}%`;
    }
  }

  // Populate Recommendations & Insights List
  const insightsList = $("insights-list");
  if (insightsList) {
    insightsList.innerHTML = "";
    const list = (r.insights && r.insights.length > 0)
      ? r.insights
      : generateClientInsights(studentData || {}, score);

    const icons = ["💡", "🌙", "📱", "🏃", "🧘", "🎯"];
    list.forEach((item, idx) => {
      const li = document.createElement("li");
      const iconSpan = document.createElement("span");
      iconSpan.className = "icon";
      iconSpan.textContent = icons[idx % icons.length];
      const textSpan = document.createElement("span");
      textSpan.textContent = item;
      li.appendChild(iconSpan);
      li.appendChild(textSpan);
      insightsList.appendChild(li);
    });
  }
}

// ===== 3D tilt on cards =====
document.addEventListener("mousemove", (e) => {
  document.querySelectorAll(".tilt").forEach((c) => {
    const r = c.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      c.style.transform = "";
      return;
    }
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    c.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateZ(8px)`;
  });
});

// ===== Neural-network background animation =====
(function () {
  const cv = $("bg");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let w, h, pts = [];
  const resize = () => {
    w = cv.width = innerWidth;
    h = cv.height = innerHeight;
    pts = Array.from({ length: Math.min(70, Math.floor(w / 18)) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4
    }));
  };
  addEventListener("resize", resize);
  resize();
  (function draw() {
    ctx.clearRect(0, 0, w, h);
    pts.forEach((p, i) => {
      p.x = (p.x + p.vx + w) % w;
      p.y = (p.y + p.vy + h) % h;
      ctx.fillStyle = "rgba(34,211,238,.7)";
      ctx.fillRect(p.x, p.y, 2, 2);
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(p.x - pts[j].x, p.y - pts[j].y);
        if (d < 130) {
          ctx.strokeStyle = `rgba(139,92,246,${0.25 * (1 - d / 130)})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    });
    requestAnimationFrame(draw);
  })();
})();
