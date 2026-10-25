// צוות גורדון - שרת הכניסה (Google Apps Script, רץ בחשבון adgordon248@gmail.com)
// כניסה לאזור האישי באפליקציה: ת"ז -> קוד חד-פעמי במייל -> אסימון כניסה של Firebase.
//
// מי רשאי להיכנס ובאיזה תפקיד - לא נקבע כאן. זו אותה רשימה של לוח המערכות:
// access_map.json (בריפו gordon-timetable) + השינויים החיים מעמוד המשתמשים (users_admin).
// הדבר היחיד שנשמר כאן הוא המייל של כל איש צוות (גיליון "מיילים").
//
// פרטיות: תעודות זהות לא מגיעות לכאן. הדפדפן מגבב את הת"ז (PBKDF2, כמו בלוח)
// ושולח רק את הגיבוב. הקוד שנשלח במייל נשמר רק כגיבוב, ל-10 דקות.
// סודות (מאפייני סקריפט, לא בגיט): SA_KEY - מפתח חשבון השירות של Firebase,
// PEPPER - מלח לגיבוב הקודים, נוצר ב-setup.

var PROJECT_ID = "gordon-staff";
var API_KEY = "AIzaSyAXThb9nGkGSKH8ulaznf0ABgzJmlRxYEo";   // מזהה ציבורי (מופיע גם באפליקציה), לא סוד
var ACCESS_URL = "https://raw.githubusercontent.com/asifbenish-tech/gordon-timetable/master/access_map.json";
var USERS_API = "https://script.google.com/macros/s/AKfycbwJyZr8roh7yF0P32iXu2MgMoz95K62urGr_BAVOeAsWhMjqP-J3JQP87XKZanTpxNI/exec";
var APP_NAME = "צוות גורדון";
var CODE_MIN = 10;     // תוקף קוד, בדקות
var MAX_TRIES = 5;     // ניסיונות לכל קוד
var MAX_SENDS = 3;     // קודים לאותו אדם ב-10 דקות
var MAX_HOUR = 40;     // קודים לכל בית הספר בשעה (מכסת המייל של חשבון Gmail: 100 ביום)
var AUD = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";
// מפתח השירות: במאפיין הסקריפט SA_KEY, או מודבק כאן בעותק שבחשבון בלבד. בגיט זה תמיד נשאר ריק.
var SA_KEY_INLINE = null;

// להרצה ידנית: בפעם הראשונה יוצר את הגיליון, ובכל פעם מוסיף לגיליון שמות חדשים
// ובודק שמפתח השירות עובד מול Firebase. התוצאה מגיעה במייל.
function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty("PEPPER")) p.setProperty("PEPPER", Utilities.getUuid() + Utilities.getUuid());
  if (!p.getProperty("SHEET_ID")) {
    var ss = SpreadsheetApp.create("צוות גורדון - מיילים לכניסה");
    var sh = ss.getSheets()[0].setName("מיילים");
    sh.appendRow(["שם", "מייל", "הערה"]);
    sh.setFrozenRows(1);
    ss.insertSheet("log").appendRow(["זמן", "פעולה", "שם", "פרטים"]);
    p.setProperty("SHEET_ID", ss.getId());
  }
  CacheService.getScriptCache().remove("access");
  var added = syncNames_(), test = selfTest_();
  var url = SpreadsheetApp.openById(p.getProperty("SHEET_ID")).getUrl();
  var missing = emails_().filter(function (x) { return !x.email; }).length;
  MailApp.sendEmail(owner_(), APP_NAME + " - שרת הכניסה",
    "גיליון המיילים: " + url + "\n" +
    (added ? "נוספו לגיליון " + added + " שמות חדשים.\n" : "") +
    (missing ? "חסר מייל ל-" + missing + " אנשי צוות - הם לא יוכלו להיכנס עד שימולא.\n" : "לכל אנשי הצוות יש מייל.\n") +
    "\nבדיקת החיבור ל-Firebase: " + test + "\n");
  Logger.log("sheet: " + url + " | added: " + added + " | missing emails: " + missing + " | firebase: " + test);
}

function doGet() {
  return json_({ok: true, app: APP_NAME});
}

// האפליקציה שולחת POST עם גוף טקסט (JSON), כדי שהדפדפן לא יבקש אישור CORS מקדים.
function doPost(e) {
  var out;
  try {
    var r = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (r.a === "code") out = sendCode_(String(r.h || ""));
    else if (r.a === "verify") out = verify_(String(r.h || ""), String(r.c || ""));
    else out = {ok: false, error: "פעולה לא מוכרת."};
  } catch (err) { out = {ok: false, error: "שגיאה בשרת: " + err.message}; }
  return json_(out);
}

function sendCode_(h) {
  if (!/^[0-9a-f]{64}$/.test(h)) return {ok: false, error: "בקשה לא תקינה."};
  var u = access_()[h];
  if (!u) return {ok: false, error: "תעודת הזהות לא מופיעה ברשימת הצוות. אם זו טעות - לפנות לאסיף."};
  var to = emailOf_(u.n);
  if (!to) return {ok: false, error: "עדיין לא רשום מייל עבורך. לבקש מאסיף להוסיף אותו."};
  var c = CacheService.getScriptCache(), lock = LockService.getScriptLock(), code;
  if (!lock.tryLock(10000)) return {ok: false, error: "המערכת עמוסה. לנסות שוב בעוד רגע."};
  try {
    var sends = +(c.get("n_" + h) || 0), hk = "g_" + Math.floor(Date.now() / 3600000), all = +(c.get(hk) || 0);
    if (sends >= MAX_SENDS) return {ok: false, error: "נשלחו כבר " + MAX_SENDS + " קודים. אפשר לבקש שוב בעוד 10 דקות."};
    if (all >= MAX_HOUR) return {ok: false, error: "יש יותר מדי בקשות כניסה כרגע. לנסות שוב בעוד שעה."};
    code = newCode_();
    c.put("c_" + h, JSON.stringify({d: digest_(h + ":" + code), t: 0, exp: Date.now() + CODE_MIN * 60000}), CODE_MIN * 60);
    c.put("n_" + h, String(sends + 1), 600);
    c.put(hk, String(all + 1), 3600);
  } finally { lock.releaseLock(); }
  MailApp.sendEmail({
    to: to, name: APP_NAME, subject: "קוד כניסה: " + code,
    body: "שלום " + u.n + ",\nהקוד שלך לכניסה לאפליקציית " + APP_NAME + ": " + code +
      "\nהקוד בתוקף ל-" + CODE_MIN + " דקות.\nלא ביקשת להיכנס? אפשר להתעלם מהמייל.",
    htmlBody: '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#0f172a">' +
      "שלום " + esc_(u.n) + ",<br>הקוד שלך לכניסה לאפליקציית " + APP_NAME + ":" +
      '<div style="font-size:34px;font-weight:bold;letter-spacing:8px;margin:14px 0;direction:ltr;text-align:right">' + code + "</div>" +
      "הקוד בתוקף ל-" + CODE_MIN + " דקות.<br>" +
      '<span style="color:#64748b">לא ביקשת להיכנס? אפשר להתעלם מהמייל.</span></div>'
  });
  log_("code", u.n, mask_(to));
  return {ok: true, to: mask_(to), name: u.n};
}

function verify_(h, code) {
  if (!/^[0-9a-f]{64}$/.test(h)) return {ok: false, error: "בקשה לא תקינה."};
  if (!/^\d{6}$/.test(code)) return {ok: false, error: "הקוד הוא 6 ספרות."};
  var c = CacheService.getScriptCache(), lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return {ok: false, error: "המערכת עמוסה. לנסות שוב בעוד רגע."};
  try {
    var rec = JSON.parse(c.get("c_" + h) || "null");
    if (!rec || rec.exp < Date.now()) return {ok: false, expired: true, error: "תוקף הקוד פג. לבקש קוד חדש."};
    if (digest_(h + ":" + code) !== rec.d) {
      rec.t++;
      if (rec.t >= MAX_TRIES) { c.remove("c_" + h); return {ok: false, expired: true, error: "יותר מדי ניסיונות. לבקש קוד חדש."}; }
      c.put("c_" + h, JSON.stringify(rec), Math.max(1, Math.ceil((rec.exp - Date.now()) / 1000)));
      return {ok: false, error: "הקוד שגוי. נשארו " + (MAX_TRIES - rec.t) + " ניסיונות."};
    }
    c.remove("c_" + h);
  } finally { lock.releaseLock(); }
  var u = access_()[h];
  if (!u) return {ok: false, error: "תעודת הזהות לא מופיעה ברשימת הצוות."};
  var claims = {n: u.n, r: u.r};
  if (u.h) claims.h = u.h;
  log_("login", u.n, "");
  return {ok: true, token: customToken_(uidOf_(u.n), claims), name: u.n};
}

// רשימת ההרשאות של לוח המערכות, ממוזגת בדיוק כמו בלוח (mergeAccess ב-viewer).
function access_() {
  var c = CacheService.getScriptCache(), hit = c.get("access");
  if (hit) return JSON.parse(hit);
  var m = JSON.parse(UrlFetchApp.fetch(ACCESS_URL).getContentText());
  try {   // אם שרת המשתמשים לא עונה - הרשימה הבסיסית, כמו בלוח
    var live = JSON.parse(UrlFetchApp.fetch(USERS_API, {muteHttpExceptions: true}).getContentText());
    if (live && live.ok) {
      Object.keys(live.removed || {}).forEach(function (h) { delete m[h]; });
      Object.keys(live.users || {}).forEach(function (h) { m[h] = live.users[h]; });
    }
  } catch (err) {}
  c.put("access", JSON.stringify(m), 300);
  return m;
}

function syncNames_() {
  var have = {}, m = access_(), names = [];
  emails_().forEach(function (x) { have[x.name] = 1; });
  Object.keys(m).forEach(function (h) { var n = m[h].n; if (n && !have[n]) { have[n] = 1; names.push(n); } });
  names.sort(function (a, b) { return a.localeCompare(b, "he"); });
  if (names.length) {
    var sh = sheet_("מיילים");
    sh.getRange(sh.getLastRow() + 1, 1, names.length, 3).setValues(names.map(function (n) { return [n, "", ""]; }));
  }
  return names.length;
}

function emails_() {
  var v = sheet_("מיילים").getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var n = String(v[i][0] || "").trim(), e = String(v[i][1] || "").trim();
    if (n) out.push({name: n, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : ""});
  }
  return out;
}

function emailOf_(name) {
  var hit = emails_().filter(function (x) { return x.name === name && x.email; })[0];
  return hit ? hit.email : "";
}

// אסימון כניסה של Firebase (custom token), חתום במפתח חשבון השירות.
function customToken_(uid, claims) {
  var sa = saKey_(), now = Math.floor(Date.now() / 1000);
  var body = {iss: sa.client_email, sub: sa.client_email, aud: AUD, iat: now, exp: now + 3600, uid: uid};
  if (claims) body.claims = claims;
  var input = b64_(JSON.stringify({alg: "RS256", typ: "JWT"})) + "." + b64_(JSON.stringify(body));
  return input + "." + b64_(Utilities.computeRsaSha256Signature(input, sa.private_key));
}

function saKey_() {
  var raw = PropertiesService.getScriptProperties().getProperty("SA_KEY") || (SA_KEY_INLINE && JSON.stringify(SA_KEY_INLINE)), sa;
  if (!raw) throw new Error("חסר מפתח השירות (SA_KEY) - ראו server/README.txt");
  try { sa = JSON.parse(raw); } catch (err) { throw new Error("SA_KEY אינו JSON תקין - להדביק את כל תוכן הקובץ שהורד"); }
  if (!sa.client_email || !sa.private_key) throw new Error("SA_KEY חסר client_email או private_key");
  if (sa.project_id !== PROJECT_ID) throw new Error("SA_KEY שייך לפרויקט " + sa.project_id + " ולא ל-" + PROJECT_ID);
  return sa;
}

// בודק את כל השרשרת: חתימת אסימון -> כניסה ב-Firebase -> מחיקת משתמש הבדיקה.
function selfTest_() {
  try {
    var r = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + API_KEY, {
      method: "post", contentType: "application/json", muteHttpExceptions: true,
      payload: JSON.stringify({token: customToken_("selftest"), returnSecureToken: true})});
    var j = JSON.parse(r.getContentText());
    if (r.getResponseCode() !== 200) return "נכשלה - " + ((j.error && j.error.message) || r.getResponseCode());
    UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:delete?key=" + API_KEY, {
      method: "post", contentType: "application/json", muteHttpExceptions: true, payload: JSON.stringify({idToken: j.idToken})});
    return "עובדת ✓";
  } catch (err) { return "נכשלה - " + err.message; }
}

// מזהה משתמש קבוע לפי השם בלוח: t_ + hex של השם (כמו המזהים במסך אילוצי המורים).
function uidOf_(name) {
  return "t_" + Utilities.newBlob(name).getBytes().map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("");
}

function newCode_() {
  var x = parseInt(Utilities.getUuid().replace(/-/g, "").slice(0, 12), 16);   // 48 ביט אקראיים
  return ("00000" + (x % 1000000)).slice(-6);
}

function digest_(s) {
  return Utilities.computeHmacSha256Signature(s, PropertiesService.getScriptProperties().getProperty("PEPPER"))
    .map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("");
}

function b64_(x) {
  return (typeof x === "string" ? Utilities.base64EncodeWebSafe(x, Utilities.Charset.UTF_8) : Utilities.base64EncodeWebSafe(x)).replace(/=+$/, "");
}

function mask_(e) { var i = e.indexOf("@"); return e.charAt(0) + "•••" + e.slice(i); }
function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]; }); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function log_(a, n, d) { sheet_("log").appendRow([new Date().toISOString(), a, n, d]); }
function sheet_(name) { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID")).getSheetByName(name); }
function owner_() { return Session.getEffectiveUser().getEmail(); }
