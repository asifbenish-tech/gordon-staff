// בדיקה מקומית של server/Code.gs בלי Google: מריץ את הקוד מול חיקויים של שירותי
// Apps Script ובודק את כל מסלול הכניסה, כולל חתימת האסימון.
// הרצה: node server/test_server.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto"), assert = require("assert");

const OWNER_H = "a".repeat(64), OTHER_H = "b".repeat(64), REMOVED_H = "c".repeat(64), LIVE_H = "d".repeat(64);
const ACCESS = {[OWNER_H]: {n: "אסיף", r: "admin", p: 1}, [OTHER_H]: {n: "אנה", r: "teacher"}, [REMOVED_H]: {n: "ארז", r: "teacher"}};
const LIVE = {ok: true, users: {[LIVE_H]: {n: "לייה", r: "coordinator", h: "A"}}, removed: {[REMOVED_H]: "ארז"}};
const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa", {modulusLength: 2048});
const SA = {project_id: "gordon-staff", client_email: "firebase-adminsdk@gordon-staff.iam.gserviceaccount.com",
  private_key: privateKey.export({type: "pkcs8", format: "pem"})};

function makeEnv() {
  const props = {SA_KEY: JSON.stringify(SA)}, cache = {}, mails = [], sheets = {};
  let now = Date.parse("2026-10-25T08:00:00Z");
  const toBytes = b => Array.from(b, x => (x > 127 ? x - 256 : x));   // כמו Java: בתים עם סימן
  const sheet = name => ({
    rows: sheets[name],
    appendRow(r) { this.rows.push(r); },
    setFrozenRows() {},
    getLastRow() { return this.rows.length; },
    getRange(r, c, n) { const rows = this.rows; return {setValues(v) { for (let i = 0; i < n; i++) rows[r - 1 + i] = v[i]; }}; },
    getDataRange() { const rows = this.rows; return {getValues: () => rows.map(x => x.slice())}; },
    setName(n) { sheets[n] = this.rows; return sheet(n); },
  });
  const env = {
    Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(now); } static now() { return now; } },
    Logger: {log() {}},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }})},
    CacheService: {getScriptCache: () => ({
      get: k => (cache[k] && cache[k].exp > now ? cache[k].v : null),
      put: (k, v, ttl) => { cache[k] = {v: String(v), exp: now + ttl * 1000}; },
      remove: k => { delete cache[k]; },
    })},
    LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock() {}})},
    MailApp: {sendEmail(a, b, c) { mails.push(typeof a === "object" ? a : {to: a, subject: b, body: c}); }},
    Session: {getEffectiveUser: () => ({getEmail: () => "adgordon248@gmail.com"})},
    SpreadsheetApp: {
      create() { sheets.Sheet1 = []; return {getSheets: () => [sheet("Sheet1")], insertSheet: n => { sheets[n] = []; return sheet(n); }, getId: () => "SHEET", getUrl: () => "https://sheet"}; },
      openById: () => ({getSheetByName: n => sheet(n), getUrl: () => "https://sheet"}),
    },
    UrlFetchApp: {fetch(url, opt) {
      const res = (code, o) => ({getResponseCode: () => code, getContentText: () => JSON.stringify(o)});
      if (url.includes("access_map.json")) return res(200, ACCESS);
      if (url.includes("script.google.com")) return res(200, LIVE);
      if (url.includes("signInWithCustomToken")) {
        const tok = JSON.parse(opt.payload).token, [h, b, s] = tok.split(".");
        const ok = crypto.verify("RSA-SHA256", Buffer.from(h + "." + b), publicKey, Buffer.from(s, "base64url"));
        return ok ? res(200, {idToken: "x"}) : res(400, {error: {message: "INVALID_CUSTOM_TOKEN"}});
      }
      if (url.includes("accounts:delete")) return res(200, {});
      throw new Error("unexpected fetch " + url);
    }},
    ContentService: {MimeType: {JSON: "json"}, createTextOutput: t => ({text: t, setMimeType() { return this; }})},
    Utilities: {
      Charset: {UTF_8: "utf8"},
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: x => Buffer.from(typeof x === "string" ? Buffer.from(x, "utf8") : Uint8Array.from(x, v => v & 255)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
      computeRsaSha256Signature: (s, pem) => toBytes(crypto.sign("RSA-SHA256", Buffer.from(s, "utf8"), pem)),
      computeHmacSha256Signature: (s, k) => toBytes(crypto.createHmac("sha256", k).update(s).digest()),
      newBlob: s => ({getBytes: () => toBytes(Buffer.from(s, "utf8"))}),
    },
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "Code.gs"), "utf8"), env);
  const post = body => JSON.parse(env.doPost({postData: {contents: JSON.stringify(body)}}).text);
  return {env, post, mails, sheets, props, tick: ms => { now += ms; }};
}

const T = makeEnv();
T.env.setup();
assert.strictEqual(T.mails.length, 1, "setup sends one report mail");
assert.match(T.mails[0].body, /Firebase: עובדת ✓/, "self test signs a valid token");
const names = T.sheets["מיילים"].slice(1).map(r => r[0]);
assert.deepStrictEqual(names.sort(), ["אנה", "אסיף", "לייה"].sort(), "names from access map + live users, removed excluded");
T.env.setup();
assert.strictEqual(T.sheets["מיילים"].length, 4, "second setup adds no duplicates");

// אין מייל -> הודעה ברורה
let r = T.post({a: "code", h: OTHER_H});
assert.strictEqual(r.ok, false); assert.match(r.error, /לא רשום מייל/);
T.sheets["מיילים"].forEach(row => { if (row[0] === "אנה") row[1] = "anna@example.com"; if (row[0] === "לייה") row[1] = "leia@example.com"; });

// לא ברשימה / הוסר בעמוד המשתמשים
assert.match(T.post({a: "code", h: "e".repeat(64)}).error, /לא מופיעה/);
assert.match(T.post({a: "code", h: REMOVED_H}).error, /לא מופיעה/);
assert.match(T.post({a: "code", h: "not-a-hash"}).error, /לא תקינה/);

// קוד נשלח, מייל ממוסך
T.mails.length = 0;
r = T.post({a: "code", h: OTHER_H});
assert.deepStrictEqual(r, {ok: true, to: "a•••@example.com", name: "אנה"});
const code = T.mails[0].subject.match(/\d{6}/)[0];
assert.strictEqual(T.mails[0].to, "anna@example.com");
assert.ok(!JSON.stringify(T.env.CacheService.getScriptCache().get("c_" + OTHER_H)).includes(code), "code stored only as digest");

// קוד שגוי מוריד ניסיון; קוד נכון מחזיר אסימון תקין
const wrong = code === "000000" ? "111111" : "000000";
assert.match(T.post({a: "verify", h: OTHER_H, c: wrong}).error, /נשארו 4/);
assert.match(T.post({a: "verify", h: OTHER_H, c: "12a"}).error, /6 ספרות/);
r = T.post({a: "verify", h: OTHER_H, c: code});
assert.strictEqual(r.ok, true);
const [h64, b64, s64] = r.token.split(".");
assert.ok(crypto.verify("RSA-SHA256", Buffer.from(h64 + "." + b64), publicKey, Buffer.from(s64, "base64url")), "signature verifies");
const claims = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
assert.strictEqual(claims.uid, "t_" + Buffer.from("אנה", "utf8").toString("hex"));
assert.deepStrictEqual(claims.claims, {n: "אנה", r: "teacher"});
assert.strictEqual(claims.aud, "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit");
assert.strictEqual(claims.exp - claims.iat, 3600);
assert.match(T.post({a: "verify", h: OTHER_H, c: code}).error, /פג/, "code is single use");

// משתמש שנוסף בעמוד המשתמשים: התפקיד והבית מגיעים לאסימון
T.mails.length = 0;
T.post({a: "code", h: LIVE_H});
r = T.post({a: "verify", h: LIVE_H, c: T.mails[0].subject.match(/\d{6}/)[0]});
assert.deepStrictEqual(JSON.parse(Buffer.from(r.token.split(".")[1], "base64url")).claims, {n: "לייה", r: "coordinator", h: "A"});

// 5 טעויות מבטלות את הקוד
T.tick(11 * 60000);
T.post({a: "code", h: OTHER_H});
for (let i = 0; i < 4; i++) T.post({a: "verify", h: OTHER_H, c: "999999"});
r = T.post({a: "verify", h: OTHER_H, c: "999999"});
assert.strictEqual(r.expired, true); assert.match(r.error, /יותר מדי/);

// תוקף של 10 דקות
T.mails.length = 0;
T.post({a: "code", h: OTHER_H});
const late = T.mails[0].subject.match(/\d{6}/)[0];
T.tick(10 * 60000 + 1000);
assert.match(T.post({a: "verify", h: OTHER_H, c: late}).error, /פג/);

// עד 3 קודים לאדם ב-10 דקות
const U = makeEnv();
U.env.setup();
U.sheets["מיילים"].forEach(row => { row[1] = "x@example.com"; });
for (let i = 0; i < 3; i++) assert.strictEqual(U.post({a: "code", h: OTHER_H}).ok, true);
assert.match(U.post({a: "code", h: OTHER_H}).error, /נשלחו כבר 3/);
U.tick(10 * 60000 + 1000);
assert.strictEqual(U.post({a: "code", h: OTHER_H}).ok, true, "allowed again after 10 minutes");

// מפתח שירות של פרויקט אחר נדחה בבירור
U.props.SA_KEY = JSON.stringify(Object.assign({}, SA, {project_id: "school-gordon"}));
U.tick(10 * 60000 + 1000);
U.post({a: "code", h: OTHER_H});
const c2 = U.mails[U.mails.length - 1].subject.match(/\d{6}/)[0];
assert.match(U.post({a: "verify", h: OTHER_H, c: c2}).error, /שייך לפרויקט school-gordon/);

console.log("server/Code.gs: all checks passed");
