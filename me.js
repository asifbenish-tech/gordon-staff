// האזור האישי: כניסה (ת"ז -> קוד במייל -> Firebase), מערכת השעות האישית, שמירות, הודעות ולוח אירועים.
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

// מצב הדגמה: ?demo=1 בכתובת. בלי שרת ובלי Firebase - נתוני דוגמה שנשמרים רק במכשיר הזה.
// נועד לבדיקת המסכים לפני שהשרת מוקם. לא נותן גישה לשום מידע אמיתי מלבד המערכת המפורסמת.
const DEMO = (() => { try { if (new URLSearchParams(location.search).has("demo")) sessionStorage.setItem("gordonDemo", "1"); return sessionStorage.getItem("gordonDemo") === "1"; } catch (e) { return false; } })();
const TABS = [["home", "היום", "fa-house"], ["tt", "מערכת", "fa-table-cells"], ["duty", "שמירות", "fa-shield-halved"], ["msg", "הודעות", "fa-bullhorn"], ["cal", "אירועים", "fa-calendar-days"]];
const COLS = ["duties", "messages", "events"];   // האוספים ב-Firestore (firestore.rules)
const DAYN = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

let A, auth, fbApp;       // מודול ההזדהות של Firebase, המופע שלו והאפליקציה
let user = null;          // {name, role, house}
let ready = false;        // כבר ידוע אם יש משתמש מחובר
let T = ls("gordonTT");   // {g, days, teachers, full} - עותק אחרון, כדי שהמערכת תעבוד גם בלי רשת
let day = null, who = null, step = {s: "id"};
let store = null;         // {add(col, obj), del(col, id)} - Firestore, או המכשיר במצב הדגמה
let D = {duties: null, messages: null, events: null};   // null = עוד לא נטען
let dataErr = "", allDuties = false, flash = "";

async function start() {
  for (const el of document.querySelectorAll("[data-me]")) el.hidden = false;
  $("mtabs").innerHTML = TABS.map(t => '<a href="#me' + (t[0] === "home" ? "" : "/" + t[0]) + '" data-t="' + t[0] + '"><i class="fa-solid ' + t[2] + '"></i><span>' + t[1] + '</span><em hidden></em></a>').join("");
  paintCard();
  window.addEventListener("hashchange", route);
  $("mback").addEventListener("click", back);
  route();
  if (DEMO) {
    user = ls("gordonDemoUser"); ready = true;
    loadTT(); if (user) openData();
    paintCard(); route();
    return;
  }
  const [F, Au] = await Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js")]);
  A = Au; fbApp = F.initializeApp(FIREBASE);
  auth = A.initializeAuth(fbApp, {persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence]});
  A.onAuthStateChanged(auth, async u => {
    user = u ? await profile(u) : null;
    ready = true;
    if (user) { loadTT(); openData(); }
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

// ---- הנתונים המשותפים: שמירות, הודעות, אירועים ----
// מערכות אחרות (למשל מערכת שמירות ייעודית) כותבות לאותם אוספים, והאפליקציה מציגה.
// duties:   {date:"2026-11-15", from:"07:30", to:"08:00", place, who:<שם בלוח המערכות>, note}
// messages: {title, body, by, at:<ms>}
// events:   {date, time?, title, place?, note?}
function onData(col, list) { D[col] = list; paintCard(); paintBadge(); if (shown()) render(); }

async function openData() {
  if (store) return;
  if (DEMO) { store = demoStore(); return; }
  try {
    const Fs = await import(SDK + "firebase-firestore.js");
    let db;
    try { db = Fs.initializeFirestore(fbApp, {localCache: Fs.persistentLocalCache({tabManager: Fs.persistentMultipleTabManager()})}); }
    catch (e) { db = Fs.getFirestore(fbApp); }
    store = {
      add: (col, o) => Fs.addDoc(Fs.collection(db, col), o),
      del: (col, id) => Fs.deleteDoc(Fs.doc(db, col, id))
    };
    for (const col of COLS) Fs.onSnapshot(Fs.collection(db, col),
      snap => { dataErr = ""; onData(col, snap.docs.map(d => Object.assign({id: d.id}, d.data()))); },
      () => { dataErr = "לא הצלחנו לטעון את הנתונים. לבדוק את האינטרנט ולפתוח שוב."; if (D[col] == null) onData(col, []); });
  } catch (e) { dataErr = "לא הצלחנו להתחבר למאגר הנתונים."; for (const col of COLS) D[col] = D[col] || []; if (shown()) render(); }
}

function demoStore() {
  let db = ls("gordonDemoData");
  if (!db) {
    const names = T ? Object.keys(T.teachers).sort((a, b) => a.localeCompare(b, "he")) : [];
    const me = user.name, o1 = names.find(n => n !== me) || "מורה א", o2 = names.filter(n => n !== me)[1] || "מורה ב";
    const dd = n => { const d = new Date(); d.setDate(d.getDate() + n); if (d.getDay() === 6) d.setDate(d.getDate() + 1); return iso(d); };   // לא בשבת
    let k = 0; const id = () => "d" + (++k);
    db = {
      duties: [
        {id: id(), date: dd(1), from: "07:30", to: "08:00", place: "שער ראשי", who: me, note: "דוגמה"},
        {id: id(), date: dd(1), from: "13:15", to: "13:45", place: "רחבת ההסעות", who: o1, note: ""},
        {id: id(), date: dd(3), from: "10:00", to: "10:25", place: "חצר היסודי", who: o2, note: ""},
        {id: id(), date: dd(6), from: "13:15", to: "13:45", place: "רחבת ההסעות", who: me, note: ""}
      ],
      messages: [
        {id: id(), title: "הודעה לדוגמה: אסיפת צוות", body: "כך תיראה הודעה מההנהלה לכל הצוות.\nאפשר לכתוב כמה שורות.", by: "הנהלה", at: Date.now() - 36e5},
        {id: id(), title: "הודעה לדוגמה: עדכון מערכת", body: "המערכת עודכנה. כדאי להציץ בלשונית \"מערכת\".", by: "הנהלה", at: Date.now() - 26 * 36e5}
      ],
      events: [
        {id: id(), date: dd(2), time: "16:00", title: "אירוע לדוגמה: אסיפת הורים", place: "בכיתות", note: ""},
        {id: id(), date: dd(9), time: "", title: "אירוע לדוגמה: יום טיול שכבתי", place: "", note: "שכבת ו"},
        {id: id(), date: dd(34), time: "18:00", title: "אירוע לדוגמה: טקס חנוכה", place: "אולם", note: ""}
      ]
    };
    ls("gordonDemoData", db);
  }
  const emit = () => { ls("gordonDemoData", db); for (const col of COLS) onData(col, db[col].slice()); };
  setTimeout(emit, 0);
  return {
    add: async (col, o) => { db[col].push(Object.assign({id: "d" + Date.now()}, o)); emit(); },
    del: async (col, id) => { db[col] = db[col].filter(x => x.id !== id); emit(); }
  };
}

const isAdmin = () => !!user && user.role === "admin";
const today = () => iso(new Date());
const byWhen = (a, b) => (a.date + (a.from || a.time || "")).localeCompare(b.date + (b.from || b.time || ""));
const upcoming = col => (D[col] || []).filter(x => x.date >= today()).sort(byWhen);
const myDuties = () => upcoming("duties").filter(x => x.who === user.name);
const unread = () => { const seen = ls("gordonSeen") || 0; return (D.messages || []).filter(m => m.at > seen).length; };

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
    $("mineDesc").textContent = "המערכת האישית שלך, השמירות, הודעות ההנהלה ולוח האירועים. נכנסים פעם אחת עם תעודת זהות וקוד שמגיע למייל.";
    $("mineMeta").textContent = "כניסה עם ת\"ז";
    $("mineGo").firstChild.textContent = "לכניסה ";
    return;
  }
  const d = defaultDay(), list = slots(user.name, d), nd = D.duties ? myDuties()[0] : null, u = unread();
  $("mineTitle").textContent = "שלום, " + fullName(user.name);
  $("mineDesc").textContent = (!T ? "טוען את המערכת…" : summary(list, d)) +
    (nd ? " שמירה: " + nice(nd.date) + " ב-" + nd.from + ", " + nd.place + "." : "") + (u ? " " + (u === 1 ? "הודעה חדשה אחת." : u + " הודעות חדשות.") : "");
  $("mineMeta").textContent = roleLabel(user);
  $("mineGo").firstChild.textContent = "לאזור שלי ";
}

function paintBadge() {
  const em = document.querySelector('#mtabs a[data-t="msg"] em'); if (!em) return;
  const u = user ? unread() : 0; em.hidden = !u; em.textContent = u || "";
}

function summary(list, d) {
  const busy = list.filter(s => s.ev.length);
  const when = d === todayIdx() ? "היום" : "ביום " + T.days[d];
  if (!busy.length) return when + " אין לך שיעורים במערכת.";
  return when + ": " + (busy.length === 1 ? "שעה אחת" : busy.length + " שעות") + ", משעה " + busy[0].h + " עד שעה " + busy[busy.length - 1].h + ".";
}

// ---- ניווט: #me, #me/tt, #me/duty, #me/msg, #me/cal ----
const shown = () => location.hash === "#me" || location.hash.startsWith("#me/");
const tab = () => { const t = location.hash.slice(4); return TABS.some(x => x[0] === t) ? t : "home"; };
function route() {
  const v = $("mview");
  if (!shown()) { if (!v.hidden) { v.hidden = true; if ($("aview").hidden) document.body.style.overflow = ""; } return; }
  v.hidden = false; document.body.style.overflow = "hidden";
  flash = "";
  render();
  v.scrollTop = 0;
}
function back() {
  history.pushState("", document.title, location.pathname + location.search);
  route();
  $("mine").scrollIntoView();
}

function render() {
  const b = $("mbody"), t = tab(), tabs = $("mtabs");
  tabs.hidden = !user;
  for (const a of tabs.children) a.setAttribute("aria-current", a.dataset.t === t ? "page" : "false");
  $("mhead").textContent = user ? {home: "שלום, " + fullName(user.name), tt: "המערכת שלי", duty: "שמירות", msg: "הודעות", cal: "לוח אירועים"}[t] : "כניסה אישית";
  if (!ready) { b.innerHTML = '<p class="alead">טוען…</p>'; return; }
  if (!user) { b.innerHTML = loginHtml(); bindLogin(); return; }
  // טופס פתוח שהמשתמש ממלא: לא לדרוס אותו כשמגיע עדכון נתונים ברקע
  const open = b.querySelector("details.madd[open]"), keep = open && document.activeElement && open.contains(document.activeElement);
  if (keep && b.dataset.t === t) return;
  b.dataset.t = t;
  const top = (DEMO ? '<div class="mdemo"><b>מצב הדגמה.</b> הנתונים כאן הם דוגמה ונשמרים רק במכשיר הזה. <button type="button" class="mlink" id="mdemoReset">איפוס</button></div>' : "") +
    (dataErr && t !== "tt" ? '<div class="merr" role="alert">' + esc(dataErr) + "</div>" : "") + (flash ? '<div class="mok" role="status">' + esc(flash) + "</div>" : "");
  b.innerHTML = top + {home: homeHtml, tt: ttHtml, duty: dutyHtml, msg: msgHtml, cal: calHtml}[t]();
  bind(t);
  if (t === "msg" && D.messages) { ls("gordonSeen", Date.now()); paintBadge(); paintCard(); }
}

const whoCard = () => '<div class="mcard mwho"><span class="mav">' + esc(user.name.charAt(0)) + '</span><div><b>' + esc(fullName(user.name)) +
  '</b><span>' + esc(roleLabel(user)) + '</span></div><button type="button" class="mlink" id="mout">יציאה</button></div>';
const secHead = (title, href, more) => '<div class="msec"><h3>' + title + "</h3>" + (href ? '<a href="' + href + '">' + more + "</a>" : "") + "</div>";
const loading = '<p class="alead">טוען…</p>';
const empty = (b, t) => '<div class="aempty"><b>' + b + "</b>" + (t || "") + "</div>";
const delBtn = (col, id) => isAdmin() ? '<button type="button" class="mdel" data-del="' + col + '" data-id="' + esc(id) + '" aria-label="מחיקה"><i class="fa-solid fa-trash-can"></i></button>' : "";

// ---- היום ----
function homeHtml() {
  const d = todayIdx(), list = T ? slots(user.name, d) : [], busy = list.filter(s => s.ev.length);
  let h = whoCard();
  const nd = D.duties ? myDuties()[0] : null;
  if (nd) h += '<a class="mduty next" href="#me/duty"><div class="mdico"><i class="fa-solid fa-shield-halved"></i></div><div><small>השמירה הבאה שלך</small><b>' +
    esc(nice(nd.date)) + " · " + esc(nd.from) + "–" + esc(nd.to) + "</b><span>" + esc(nd.place) + "</span></div></a>";
  h += secHead("היום במערכת", "#me/tt", "למערכת המלאה");
  if (!T) h += loading;
  else if (d === 6) h += empty("שבת שלום");
  else if (!busy.length) h += empty("אין לך שיעורים היום");
  else h += '<div class="mslots">' + list.map(slotHtml).join("") + "</div>";
  const ms = (D.messages || []).slice().sort((a, b) => b.at - a.at).slice(0, 2);
  h += secHead("הודעות אחרונות", "#me/msg", "לכל ההודעות");
  h += D.messages == null ? loading : ms.length ? ms.map(msgItem).join("") : empty("אין הודעות");
  const ev = upcoming("events").slice(0, 3);
  h += secHead("האירועים הקרובים", "#me/cal", "ללוח המלא");
  h += D.events == null ? loading : ev.length ? '<div class="mlist">' + ev.map(evItem).join("") + "</div>" : empty("אין אירועים קרובים");
  return h;
}

// ---- מערכת ----
const slotHtml = s => s.ev.length
  ? '<div class="mslot"><div class="mhour"><small>שעה</small><b>' + s.h + '</b></div><div class="mwhat">' + s.ev.map(e =>
      '<div><b>' + esc(e[3]) + '</b> <span class="mtag" style="--t:' + (SIDES[e[0]] || "#475569") + '">' + esc(e[0] === "סדירות" ? "פגישה" : e[0]) + "</span></div>").join("") + "</div></div>"
  : '<div class="mslot free"><div class="mhour"><small>שעה</small><b>' + s.h + '</b></div><div class="mwhat"><b>פנוי</b></div></div>';

function ttHtml() {
  if (day == null) day = defaultDay();
  const me = who || user.name, list = T ? slots(me, day) : [];
  if (!T) return '<p class="alead">טוען את המערכת…</p>';
  let h = "";
  if (isAdmin()) {
    const names = Object.keys(T.teachers).sort((a, c) => a.localeCompare(c, "he"));
    h += '<label class="mpick"><span>הצגת המערכת של</span><select id="mwho"><option value="">המערכת שלי</option>' +
      names.map(n => '<option value="' + esc(n) + '"' + (n === who ? " selected" : "") + ">" + esc(fullName(n)) + "</option>").join("") + "</select></label>";
  }
  h += '<div class="mdays" role="group" aria-label="בחירת יום">' + T.days.map((d, i) =>
    '<button type="button" data-d="' + i + '" aria-pressed="' + (i === day) + '"' + (i === todayIdx() ? ' class="today"' : "") + ">" + esc(d) + "</button>").join("") + "</div>";
  if (!list.length) h += empty(T.teachers[me] ? "אין שיעורים ביום " + esc(T.days[day]) : "לא נמצאה מערכת שעות על השם " + esc(me),
    T.teachers[me] ? "" : "אם יש לך שיעורים, כדאי לבדוק מול אסיף איך השם מופיע בלוח המערכות.");
  else h += '<div class="mslots">' + list.map(slotHtml).join("") + "</div>";
  return h + '<p class="mhint">המערכת מעודכנת ל-' + esc(fmtDate(T.g)) + ' · <a href="' + BOARD_URL + '" target="_blank" rel="noopener">ללוח המערכות המלא</a></p>';
}

// ---- שמירות ----
const dutyItem = x => '<div class="mduty' + (x.who === user.name ? " mine" : "") + '"><div class="mdico"><i class="fa-solid fa-shield-halved"></i></div><div><b>' +
  esc(nice(x.date)) + " · " + esc(x.from) + "–" + esc(x.to) + "</b><span>" + esc(x.place) + (allDuties || x.who !== user.name ? " · " + esc(fullName(x.who)) : "") +
  (x.note ? " · " + esc(x.note) : "") + "</span></div>" + delBtn("duties", x.id) + "</div>";

function dutyHtml() {
  if (D.duties == null) return loading;
  const mine = myDuties(), list = allDuties ? upcoming("duties") : mine;
  let h = '<div class="mdays mtoggle" role="group" aria-label="תצוגה"><button type="button" data-all="0" aria-pressed="' + !allDuties + '">השמירות שלי</button>' +
    '<button type="button" data-all="1" aria-pressed="' + allDuties + '">כל השמירות</button></div>';
  h += list.length ? '<div class="mlist">' + list.map(dutyItem).join("") + "</div>" : empty(allDuties ? "לא שובצו שמירות" : "אין לך שמירות קרובות");
  if (mine.length) h += '<button type="button" class="mbtn ghost" id="mics"><i class="fa-solid fa-calendar-plus"></i> הוספת השמירות שלי ליומן הטלפון (עם תזכורת)</button>' +
    '<p class="mhint">היומן של הטלפון יזכיר לך יום לפני ושעה לפני כל שמירה. אחרי שינוי בשיבוץ כדאי להוסיף שוב.</p>';
  if (isAdmin()) {
    const names = T ? Object.keys(T.teachers).sort((a, c) => a.localeCompare(c, "he")) : [];
    h += '<details class="madd"><summary><i class="fa-solid fa-plus"></i> שיבוץ שמירה</summary><form data-add="duties">' +
      field("מי שומר/ת", '<input name="who" list="mnames" required autocomplete="off"><datalist id="mnames">' + names.map(n => '<option value="' + esc(n) + '">' + esc(fullName(n)) + "</option>").join("") + "</datalist>") +
      field("תאריך", '<input name="date" type="date" required min="' + today() + '">') +
      '<div class="mtwo">' + field("משעה", '<input name="from" type="time" required>') + field("עד שעה", '<input name="to" type="time" required>') + "</div>" +
      field("עמדה / מקום", '<input name="place" required maxlength="60">') + field("הערה (לא חובה)", '<input name="note" maxlength="120">') +
      '<p class="mhint">השם צריך להיות כמו בלוח המערכות (שם פרטי), כדי שהשמירה תופיע אצל איש הצוות.</p>' +
      '<button class="mbtn">שמירה</button></form></details>';
  }
  return h;
}

// ---- הודעות ----
const msgItem = m => '<article class="mmsg' + (m.at > (ls("gordonSeen") || 0) ? " new" : "") + '"><div class="mmh"><b>' + esc(m.title) + "</b>" + delBtn("messages", m.id) + "</div>" +
  '<p>' + esc(m.body) + "</p><small>" + esc(m.by || "") + " · " + esc(ago(m.at)) + "</small></article>";

function msgHtml() {
  if (D.messages == null) return loading;
  const list = D.messages.slice().sort((a, b) => b.at - a.at);
  let h = "";
  if (isAdmin()) h += '<details class="madd"><summary><i class="fa-solid fa-pen"></i> הודעה חדשה לכל הצוות</summary><form data-add="messages">' +
    field("כותרת", '<input name="title" required maxlength="80">') + field("תוכן ההודעה", '<textarea name="body" rows="4" required maxlength="2000"></textarea>') +
    '<button class="mbtn">פרסום לכל הצוות</button></form></details>';
  return h + (list.length ? list.map(msgItem).join("") : empty("אין הודעות", "הודעות מההנהלה יופיעו כאן."));
}

// ---- לוח אירועים ----
const evItem = x => { const d = parse(x.date); return '<div class="mev"><div class="mdate"><b>' + d.getDate() + "</b><small>" + MONTHS[d.getMonth()] + '</small></div><div><b>' + esc(x.title) +
  "</b><span>יום " + DAYN[d.getDay()] + (x.time ? " · " + esc(x.time) : "") + (x.place ? " · " + esc(x.place) : "") + (x.note ? " · " + esc(x.note) : "") + "</span></div>" + delBtn("events", x.id) + "</div>"; };

function calHtml() {
  if (D.events == null) return loading;
  const list = upcoming("events");
  let h = "", m = "";
  if (isAdmin()) h += '<details class="madd"><summary><i class="fa-solid fa-plus"></i> אירוע חדש</summary><form data-add="events">' +
    field("שם האירוע", '<input name="title" required maxlength="80">') +
    '<div class="mtwo">' + field("תאריך", '<input name="date" type="date" required min="' + today() + '">') + field("שעה (לא חובה)", '<input name="time" type="time">') + "</div>" +
    field("מקום (לא חובה)", '<input name="place" maxlength="60">') + field("הערה (לא חובה)", '<input name="note" maxlength="120">') +
    '<button class="mbtn">הוספה ללוח</button></form></details>';
  if (!list.length) return h + empty("אין אירועים קרובים");
  for (const x of list) {
    const d = parse(x.date), k = MONTHS[d.getMonth()] + " " + d.getFullYear();
    if (k !== m) { h += (m ? "</div>" : "") + '<h3 class="mmonth">' + k + '</h3><div class="mlist">'; m = k; }
    h += evItem(x);
  }
  return h + "</div>";
}

const field = (label, input) => '<label class="mfield mf2"><span>' + label + "</span>" + input + "</label>";

function bind(t) {
  const b = $("mbody"), out = $("mout");
  if (out) out.onclick = signOut;
  const rs = $("mdemoReset"); if (rs) rs.onclick = () => { ls("gordonDemoData", null); ls("gordonDemoUser", null); ls("gordonSeen", null); location.reload(); };
  for (const btn of b.querySelectorAll(".mdays button[data-d]")) btn.onclick = () => { day = +btn.dataset.d; render(); };
  for (const btn of b.querySelectorAll(".mtoggle button")) btn.onclick = () => { allDuties = btn.dataset.all === "1"; render(); };
  const sel = $("mwho"); if (sel) sel.onchange = () => { who = sel.value || null; render(); };
  const ics = $("mics"); if (ics) ics.onclick = exportIcs;
  for (const btn of b.querySelectorAll("[data-del]")) btn.onclick = async () => {
    if (!confirm("למחוק?")) return;
    try { await store.del(btn.dataset.del, btn.dataset.id); } catch (e) { alert("המחיקה נכשלה. לבדוק את האינטרנט ולנסות שוב."); }
  };
  for (const f of b.querySelectorAll("form[data-add]")) f.onsubmit = async e => {
    e.preventDefault();
    const o = {}; for (const [k, v] of new FormData(f)) o[k] = String(v).trim();
    const col = f.dataset.add, btn = f.querySelector(".mbtn");
    if (col === "duties" && o.to <= o.from) { alert("שעת הסיום צריכה להיות אחרי שעת ההתחלה."); return; }
    if (col === "messages") { o.by = fullName(user.name); o.at = Date.now(); }
    btn.disabled = true;
    try {
      await store.add(col, o);
      flash = {duties: "השמירה שובצה.", messages: "ההודעה פורסמה.", events: "האירוע נוסף ללוח."}[col];
      f.closest("details").open = false; document.activeElement && document.activeElement.blur();
      render(); flash = "";
    } catch (err) { btn.disabled = false; alert("השמירה נכשלה. לבדוק את האינטרנט ולנסות שוב."); }
  };
}

function signOut() {
  if (!confirm("לצאת מהחשבון בטלפון הזה?")) return;
  ls("gordonMe", null); who = null; day = null;
  if (DEMO) { ls("gordonDemoUser", null); location.reload(); return; }
  A.signOut(auth).then(() => location.reload());   // טעינה מחדש מנקה גם את ההאזנות לנתונים
}

// קובץ יומן (ics) עם השמירות שלי: תזכורת יום לפני ושעה לפני. עובד בלי שרת.
function exportIcs() {
  const z = s => s.replace(/[-:]/g, ""), q = s => String(s || "").replace(/[\;,]/g, "\\$&").replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//gordon-staff//shmirot//HE", "CALSCALE:GREGORIAN"];
  for (const x of myDuties()) lines.push("BEGIN:VEVENT", "UID:" + x.id + "@gordon-staff", "DTSTAMP:" + stamp,
    "DTSTART:" + z(x.date) + "T" + z(x.from) + "00", "DTEND:" + z(x.date) + "T" + z(x.to) + "00",
    "SUMMARY:" + q("שמירה: " + x.place), "LOCATION:" + q(x.place), "DESCRIPTION:" + q(x.note || "שמירה - בית חינוך גורדון"),
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + q("שמירה מחר: " + x.place), "TRIGGER:-P1D", "END:VALARM",
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + q("שמירה בעוד שעה: " + x.place), "TRIGGER:-PT1H", "END:VALARM", "END:VEVENT");
  lines.push("END:VCALENDAR");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], {type: "text/calendar;charset=utf-8"}));
  a.download = "shmirot.ics"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- כניסה: שלב 1 ת"ז, שלב 2 הקוד מהמייל ----
function loginHtml() {
  if (DEMO) return '<div class="mcard mform"><div class="mico"><i class="fa-solid fa-flask"></i></div><h2>מצב הדגמה</h2>' +
    "<p>כאן אפשר לראות איך האפליקציה תיראה, עם נתוני דוגמה. הכניסה האמיתית תהיה עם תעודת זהות וקוד במייל.</p>" +
    '<button type="button" class="mbtn" data-demo="teacher">כניסה כאיש/אשת צוות</button><button type="button" class="mbtn ghost" data-demo="admin">כניסה כהנהלה (עם עריכה)</button></div>';
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
  if (DEMO) {
    for (const btn of document.querySelectorAll("[data-demo]")) btn.onclick = () => {
      const names = T ? Object.keys(T.teachers).sort((a, b) => a.localeCompare(b, "he")) : [];
      user = {name: names[0] || "אנה", role: btn.dataset.demo, house: ""};
      ls("gordonDemoUser", user); openData(); paintCard(); render();
    };
    return;
  }
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

const p2 = n => String(n).padStart(2, "0");
const iso = d => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
const parse = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
function nice(s) {
  const d = parse(s), diff = Math.round((d - parse(today())) / 864e5), base = "יום " + DAYN[d.getDay()] + " " + d.getDate() + "." + (d.getMonth() + 1);
  return diff === 0 ? "היום" : diff === 1 ? "מחר, " + base : base;
}
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 6e4);
  if (m < 2) return "עכשיו"; if (m < 60) return "לפני " + m + " דקות";
  if (m < 120) return "לפני שעה"; if (m < 1440) return "לפני " + Math.round(m / 60) + " שעות";
  const d = new Date(ms); return d.getDate() + "." + (d.getMonth() + 1) + "." + d.getFullYear();
}

if (AUTH_API || DEMO) start();   // בסוף הקובץ: כל הפונקציות והקבועים כבר מוגדרים
