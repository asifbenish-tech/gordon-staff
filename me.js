// האזור האישי: כניסה (ת"ז -> קוד במייל -> Firebase) ומערכת השעות האישית.
// השרת: server/Code.gs (Apps Script בחשבון adgordon248). המערכת: timetable.json מלוח המערכות.
// AUTH_API ריק = האזור האישי מוסתר לגמרי והאפליקציה מתנהגת כמו קודם.
const AUTH_API = "";   // כתובת ה-Web App של server/Code.gs (מסתיימת ב-/exec)
const SDK = "https://www.gstatic.com/firebasejs/12.19.0/";
const FIREBASE = {
  apiKey: "AIzaSyAXThb9nGkGSKH8ulaznf0ABgzJmlRxYEo",
  authDomain: "gordon-staff.firebaseapp.com",
  projectId: "gordon-staff",
  storageBucket: "gordon-staff.firebasestorage.app",
  messagingSenderId: "120741333798",
  appId: "1:120741333798:web:301e18ca732bd6bca9cfe7"
};
const TT_URL = "https://raw.githubusercontent.com/asifbenish-tech/gordon-timetable/master/timetable.json";
const BOARD_URL = "https://asifbenish-tech.github.io/gordon-timetable/";
const SIDES = {"יסודי": "#0284c7", "חטיבה": "#4f46e5", 'תל"ן': "#d97706", "מגמות": "#9333ea", "סדירות": "#059669"};
const HOUSES = {A: "א", B: "ב", C: "ג"};

const $ = id => document.getElementById(id);
const esc = t => String(t == null ? "" : t).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const ls = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } };

let A, auth;              // מודול ההזדהות של Firebase והמופע שלו
let user = null;          // {name, role, house}
let ready = false;        // Firebase כבר אמר אם יש משתמש מחובר
let T = ls("gordonTT");   // {g, days, teachers, full} - עותק אחרון, כדי שהמערכת תעבוד גם בלי רשת
let day = null, who = null, step = {s: "id"};

async function start() {
  for (const el of document.querySelectorAll("[data-me]")) el.hidden = false;
  paintCard();
  window.addEventListener("hashchange", route);
  $("mback").addEventListener("click", back);
  route();
  const [F, Au] = await Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js")]);
  A = Au;
  auth = A.initializeAuth(F.initializeApp(FIREBASE), {persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence]});
  A.onAuthStateChanged(auth, async u => {
    user = u ? await profile(u) : null;
    ready = true;
    if (user) loadTT();
    paintCard(); route();
  });
}

// השם נגזר מהמזהה (t_ + hex של השם), כך שהוא תמיד זמין; התפקיד מגיע מהאסימון.
async function profile(u) {
  const hex = u.uid.slice(2), name = new TextDecoder().decode(new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16))));
  let c = ls("gordonMe") || {};
  try { c = (await u.getIdTokenResult()).claims; ls("gordonMe", {r: c.r, h: c.h}); } catch (e) {}
  return {name, role: c.r || "", house: c.h || ""};
}

function loadTT() {
  fetch(TT_URL, {cache: "no-cache"}).then(r => r.json()).then(j => {
    T = {g: j.generated, days: j.days, teachers: j.teachers, full: j.full_names};
    ls("gordonTT", T);
    paintCard(); if (shown()) render();
  }).catch(() => {});
}

// ---- הכרטיס בעמוד הראשי ----
function paintCard() {
  if (!ready) {   // עוד לא ידוע אם מחובר - בלי להבהב "כניסה" למי שכבר מחובר/ת
    $("mineTitle").textContent = "האזור האישי";
    $("mineDesc").textContent = "טוען…";
    $("mineMeta").textContent = "";
    return;
  }
  if (!user) {
    $("mineTitle").textContent = "כניסה אישית";
    $("mineDesc").textContent = "המערכת האישית שלך בטלפון, ובהמשך גם תורנויות, הודעות והתראות. נכנסים פעם אחת עם תעודת זהות וקוד שמגיע למייל.";
    $("mineMeta").textContent = "כניסה עם ת\"ז";
    $("mineGo").firstChild.textContent = "לכניסה ";
    return;
  }
  const d = defaultDay(), list = slots(user.name, d);
  $("mineTitle").textContent = "שלום, " + fullName(user.name);
  $("mineDesc").textContent = !T ? "טוען את המערכת…" : summary(list, d);
  $("mineMeta").textContent = roleLabel(user);
  $("mineGo").firstChild.textContent = "למערכת שלי ";
}

function summary(list, d) {
  const busy = list.filter(s => s.ev.length);
  const when = d === todayIdx() ? "היום" : "ביום " + T.days[d];
  if (!busy.length) return when + " אין לך שיעורים במערכת.";
  return when + ": " + (busy.length === 1 ? "שעה אחת" : busy.length + " שעות") + ", משעה " + busy[0].h + " עד שעה " + busy[busy.length - 1].h + ".";
}

// ---- המסך האישי ----
const shown = () => location.hash === "#me";
function route() {
  const v = $("mview");
  if (!shown()) { if (!v.hidden) { v.hidden = true; if ($("aview").hidden) document.body.style.overflow = ""; } return; }
  v.hidden = false; document.body.style.overflow = "hidden";
  render();
}
function back() {
  history.pushState("", document.title, location.pathname + location.search);
  route();
  $("mine").scrollIntoView();
}

function render() {
  const b = $("mbody");
  $("mhead").textContent = user ? "המערכת שלי" : "כניסה אישית";
  if (!ready) { b.innerHTML = '<p class="alead">טוען…</p>'; return; }
  if (!user) { b.innerHTML = loginHtml(); bindLogin(); return; }
  if (day == null) day = defaultDay();
  const me = who || user.name, list = T ? slots(me, day) : [];
  let h = '<div class="mcard mwho"><span class="mav">' + esc(user.name.charAt(0)) + '</span><div><b>' + esc(fullName(user.name)) +
    '</b><span>' + esc(roleLabel(user)) + '</span></div><button type="button" class="mlink" id="mout">יציאה</button></div>';
  if (!T) { b.innerHTML = h + '<p class="alead">טוען את המערכת…</p>'; bindMe(); return; }
  if (user.role === "admin") {
    const names = Object.keys(T.teachers).sort((a, c) => a.localeCompare(c, "he"));
    h += '<label class="mpick"><span>הצגת המערכת של</span><select id="mwho"><option value="">המערכת שלי</option>' +
      names.map(n => '<option value="' + esc(n) + '"' + (n === who ? " selected" : "") + ">" + esc(fullName(n)) + "</option>").join("") + "</select></label>";
  }
  h += '<div class="mdays" role="group" aria-label="בחירת יום">' + T.days.map((d, i) =>
    '<button type="button" data-d="' + i + '" aria-pressed="' + (i === day) + '"' + (i === todayIdx() ? ' class="today"' : "") + ">" + esc(d) + "</button>").join("") + "</div>";
  if (!list.length) {
    h += '<div class="aempty"><b>' + (T.teachers[me] ? "אין שיעורים ביום " + esc(T.days[day]) : "לא נמצאה מערכת שעות על השם " + esc(me)) + "</b>" +
      (T.teachers[me] ? "" : "אם יש לך שיעורים, כדאי לבדוק מול אסיף איך השם מופיע בלוח המערכות.") + "</div>";
  } else {
    h += '<div class="mslots">' + list.map(s => s.ev.length
      ? '<div class="mslot"><div class="mhour"><small>שעה</small><b>' + s.h + '</b></div><div class="mwhat">' + s.ev.map(e =>
          '<div><b>' + esc(e[3]) + '</b> <span class="mtag" style="--t:' + (SIDES[e[0]] || "#475569") + '">' + esc(e[0] === "סדירות" ? "פגישה" : e[0]) + "</span></div>").join("") + "</div></div>"
      : '<div class="mslot free"><div class="mhour"><small>שעה</small><b>' + s.h + '</b></div><div class="mwhat"><b>פנוי</b></div></div>').join("") + "</div>";
  }
  h += '<p class="mhint">המערכת מעודכנת ל-' + esc(fmtDate(T.g)) + ' · <a href="' + BOARD_URL + '" target="_blank" rel="noopener">ללוח המערכות המלא</a></p>';
  b.innerHTML = h;
  bindMe();
}

function bindMe() {
  $("mout").onclick = () => { if (confirm("לצאת מהחשבון בטלפון הזה?")) { ls("gordonMe", null); ls("gordonTT", null); T = null; who = null; day = null; A.signOut(auth); } };
  for (const btn of document.querySelectorAll(".mdays button")) btn.onclick = () => { day = +btn.dataset.d; render(); };
  const sel = $("mwho"); if (sel) sel.onchange = () => { who = sel.value || null; render(); };
}

// ---- כניסה: שלב 1 ת"ז, שלב 2 הקוד מהמייל ----
function loginHtml() {
  const err = step.err ? '<div class="merr" role="alert">' + esc(step.err) + "</div>" : step.note ? '<div class="mok" role="status">' + esc(step.note) + "</div>" : "";
  if (step.s === "id") return '<form class="mcard mform" id="mform" novalidate>' +
    '<div class="mico"><i class="fa-solid fa-user-lock"></i></div><h2>כניסה אישית</h2>' +
    "<p>נכנסים פעם אחת בכל טלפון. אחרי הכניסה האפליקציה זוכרת אותך.</p>" +
    '<div class="mfield"><label for="mid">תעודת זהות</label><input id="mid" inputmode="numeric" autocomplete="off" maxlength="9" required value="' + esc(step.id || "") + '"></div>' +
    err + '<button class="mbtn" id="mgo"' + (step.busy ? " disabled" : "") + ">" + (step.busy ? "שולח…" : "שליחת קוד למייל") + "</button>" +
    '<p class="mhint">תעודת הזהות לא יוצאת מהטלפון: נשלח רק קוד חד־כיווני שמחושב ממנה, כמו בלוח המערכות.</p></form>';
  return '<form class="mcard mform" id="mform" novalidate>' +
    '<div class="mico"><i class="fa-solid fa-envelope-open-text"></i></div><h2>בדקו את המייל</h2>' +
    "<p>שלום " + esc(step.name) + ", שלחנו קוד בן 6 ספרות אל <bdi dir=\"ltr\">" + esc(step.to) + "</bdi>. הקוד בתוקף ל-10 דקות.</p>" +
    '<div class="mfield"><label for="mcode">הקוד מהמייל</label><input id="mcode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>' +
    err + '<button class="mbtn" id="mgo"' + (step.busy ? " disabled" : "") + ">" + (step.busy ? "רגע…" : "כניסה") + "</button>" +
    '<div class="mrow"><button type="button" class="mlink" id="mre">שליחת קוד חדש</button><button type="button" class="mlink" id="mreset">תעודת זהות אחרת</button></div></form>';
}

function bindLogin() {
  const f = $("mform"), inp = $(step.s === "id" ? "mid" : "mcode");
  f.onsubmit = e => { e.preventDefault(); step.s === "id" ? askCode(inp.value) : sendCode(inp.value); };
  if (step.s === "code") {
    inp.oninput = () => { inp.value = inp.value.replace(/\D/g, "").slice(0, 6); if (inp.value.length === 6) sendCode(inp.value); };
    $("mre").onclick = () => askCode(step.id);
    $("mreset").onclick = () => { step = {s: "id"}; render(); };
  }
  if (!step.busy) inp.focus();
}

async function askCode(raw) {
  const id = String(raw || "").replace(/\D/g, "");
  if (id.length < 5) { step.err = "צריך להקליד את מספר תעודת הזהות המלא."; render(); return; }
  step = Object.assign(step, {id, busy: true, err: ""}); render();
  try {
    step.h = await idHash(id);
    const r = await api({a: "code", h: step.h});
    const again = step.s === "code";
    step = r.ok ? {s: "code", id, h: step.h, to: r.to, name: r.name, note: again ? "נשלח קוד חדש. הקוד הקודם כבר לא בתוקף." : ""} : {s: "id", id, err: r.error};
  } catch (e) { step = {s: step.s, id, h: step.h, to: step.to, name: step.name, err: "אין חיבור לשרת הכניסה. לבדוק את האינטרנט ולנסות שוב."}; }
  render();
}

async function sendCode(code) {
  if (step.busy) return;
  if (!/^\d{6}$/.test(code)) { step.err = "הקוד הוא 6 ספרות."; render(); return; }
  step.busy = true; step.err = ""; render();
  try {
    const r = await api({a: "verify", h: step.h, c: code});
    if (r.ok) { await A.signInWithCustomToken(auth, r.token); step = {s: "id"}; return; }
    step.err = r.error;
    if (r.expired) step = {s: "id", id: step.id, err: r.error};
  } catch (e) { step.err = "הכניסה נכשלה. לבדוק את האינטרנט ולנסות שוב."; }
  step.busy = false; render();
}

async function api(body) {
  const r = await fetch(AUTH_API, {method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"}, body: JSON.stringify(body)});
  return r.json();
}

// אותו גיבוב כמו בכניסה ללוח המערכות (viewer: idHash)
async function idHash(raw) {
  const id = raw.replace(/\D/g, "").padStart(9, "0"), enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(id), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name: "PBKDF2", hash: "SHA-256", salt: enc.encode("gordon-lohot-2026"), iterations: 100000}, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---- עזרים ----
// השעות של היום, מהראשונה עד האחרונה; שעה בלי כלום באמצע = חלון פנוי.
function slots(name, d) {
  const ev = ((T && T.teachers[name]) || []).filter(e => e[1] === d);
  if (!ev.length) return [];
  const hs = ev.map(e => e[2]), out = [];
  for (let h = Math.min(...hs); h <= Math.max(...hs); h++) out.push({h, ev: ev.filter(e => e[2] === h)});
  return out;
}
const todayIdx = () => new Date().getDay();   // 0 = ראשון, כמו ב-timetable.json
function defaultDay() { const t = todayIdx(); return t === 6 || (T && t >= T.days.length) ? 0 : t; }
const fullName = n => (T && T.full && T.full[n]) || n;
function roleLabel(u) {
  if (u.role === "admin") return "הנהלה";
  if (u.role === "coordinator") return "ריכוז בית " + (HOUSES[u.house] || "");
  if (u.role === "teacher") return "צוות הוראה";
  return "צוות בית החינוך";
}
function fmtDate(s) { const d = new Date(s); return isNaN(d) ? "" : d.getDate() + "." + (d.getMonth() + 1) + "." + d.getFullYear(); }

if (AUTH_API) start();   // בסוף הקובץ: כל הפונקציות והקבועים כבר מוגדרים
