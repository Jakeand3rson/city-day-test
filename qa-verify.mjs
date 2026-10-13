import fs from "fs";
import { parseHTML } from "linkedom";
import vm from "vm";
import { createHash } from "crypto";
import Ajv2020 from "ajv/dist/2020.js";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const stopsFile = JSON.parse(fs.readFileSync(new URL("./data/stops.json", import.meta.url), "utf8"));
const kirklandFile = JSON.parse(fs.readFileSync(new URL("./data/kirkland.json", import.meta.url), "utf8"));
const citiesFile = JSON.parse(fs.readFileSync(new URL("./data/cities.json", import.meta.url), "utf8"));
const stopsSchema = JSON.parse(fs.readFileSync(new URL("./data/stops.schema.json", import.meta.url), "utf8"));

// The page asks for data/cities.json, then for each file it lists, by relative paths. These are the
// only addresses that answer.
const LIST_URL = /(^|\/)data\/cities\.json(\?|$)/;
const STOPS_URL = /(^|\/)data\/stops\.json(\?|$)/;
const KIRKLAND_URL = /(^|\/)data\/kirkland\.json(\?|$)/;
const reply = (data) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(data))) });
const served = reply(stopsFile);
const servedList = reply(citiesFile);
const servedKirkland = reply(kirklandFile);
// A page that must be one city is handed a list with St. Pete alone.
const stpeteOnly = reply(["data/stops.json"]);

// One page in its own global. linkedom windows share state with each other, so each page gets a
// plain global that borrows linkedom's pieces. fetchList, fetchStops and fetchKirkland answer the
// page's requests for the list of cities and the two real files (all served by default), and every
// other address, like the weather, stays blocked. asked collects each address the page requested.
function makePage({ fetchList = servedList, fetchStops = served, fetchKirkland = servedKirkland, asked = [], hash = "", store = {}, timers = { setTimeout, clearTimeout } } = {}) {
  const { window: dom, document } = parseHTML(html);
  const window = {};
  const builtins = new Set(vm.runInNewContext("Object.getOwnPropertyNames(globalThis)"));
  for (const k of Object.getOwnPropertyNames(dom)) {
    if (!builtins.has(k)) Object.defineProperty(window, k, Object.getOwnPropertyDescriptor(dom, k));
  }
  // linkedom serves these through its window without listing them.
  for (const k of ["HTMLElement", "Event", "addEventListener", "removeEventListener", "dispatchEvent"]) {
    window[k] = typeof dom[k] === "function" && /^[a-z]/.test(k) ? dom[k].bind(dom) : dom[k];
  }

  // Like a browser, setting location.hash without "#" stores it with one.
  const locationState = {
    _hash: "",
    get hash() { return this._hash; },
    set hash(v) { v = String(v || ""); this._hash = v && v[0] !== "#" ? "#" + v : v; },
    search: "",
    pathname: "/city-day-test/",
    href: "https://jakeand3rson.github.io/city-day-test/",
    origin: "https://jakeand3rson.github.io"
  };
  locationState.hash = hash;
  const writes = { replaceState: 0, reload: 0 };

  function applyUrl(url) {
    if (typeof url !== "string") return;
    const i = url.indexOf("#");
    const before = i >= 0 ? url.slice(0, i) : url;
    locationState.hash = i >= 0 ? url.slice(i) : "";
    if (before) {
      const q = before.indexOf("?");
      locationState.pathname = (q >= 0 ? before.slice(0, q) : before) || locationState.pathname;
      locationState.search = q >= 0 ? before.slice(q) : "";
    }
    locationState.href = locationState.origin + locationState.pathname + locationState.search + locationState.hash;
  }
  locationState.reload = () => { writes.reload++; };

  // Node 21+ has a getter-only global `navigator`, so it is not assigned here.
  Object.assign(window, {
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    },
    history: { replaceState(_a, _b, url) { writes.replaceState++; applyUrl(url); } },
    scrollTo() {},
    location: locationState,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    fetch: async (url, opts) => {
      if (LIST_URL.test(String(url))) { asked.push(String(url)); return fetchList(url, opts); }
      if (STOPS_URL.test(String(url))) { asked.push(String(url)); return fetchStops(url, opts); }
      if (KIRKLAND_URL.test(String(url))) { asked.push(String(url)); return fetchKirkland(url, opts); }
      throw new Error("network blocked in QA");
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    alert() {},
    console,
    URLSearchParams
  });

  window.window = window;
  window.document = document;
  window.self = window;
  window.globalThis = window;

  if (!window.HTMLElement.prototype.closest) {
    window.HTMLElement.prototype.closest = function (sel) {
      let el = this;
      while (el) {
        if (el.matches && el.matches(sel)) return el;
        el = el.parentElement;
      }
      return null;
    };
  }

  const scriptBody = [...document.querySelectorAll("script")].map((s) => s.textContent).filter(Boolean).join("\n;\n");
  vm.createContext(window);
  vm.runInContext(scriptBody, window);
  return { window, document, store, locationState, writes, applyUrl };
}

const { window, document, store, locationState, applyUrl } = makePage();
const g = window;
await g.CATALOG_READY;
const $ = (id) => document.getElementById(id);

// The places City Day shipped with before the catalog moved to data/stops.json. They were written
// as code, so they have no check date. Everything else in the file is an added place.
const LEGACY_IDS = ["parking", "kahwa", "bodega", "stillwaters", "bellabrava", "paciugo", "boyd", "market", "mfa", "morean", "dali", "festival", "pier", "pumpkin", "artpool", "glass", "bench", "palehorse", "folk"];
const ADDED = g.CATALOG.stops.filter((e) => !LEGACY_IDS.includes(e.id));

// Every check runs at a fixed moment before the trip (Wed Oct 7, noon in St. Pete), so the suite
// gives the same answer on Saturday as on any other day. Checks that need the day set their own clock.
const PINNED = new Date("2026-10-07T12:00:00-04:00");
g.clockOverride = PINNED;

// The suite clock is the Wednesday before the default Saturday, so older checks can
// reveal a place without the hours filter. "We're here" and "Not this" only write on
// the plan date (#42). Those older taps are played as if they happened on the plan date.
// A check about the day before sets g.keepEarlyClock.
const rawAct = g.act.bind(g);
g.act = function (name, arg) {
  const early = (name === "here" || name === "skip" || name === "pass") && g.plan && !g.keepEarlyClock && g.cityNow().iso < g.plan.date;
  const prev = g.clockOverride;
  if (early) g.clockOverride = new Date(g.plan.date + "T12:00:00-04:00");
  try { return rawAct(name, arg); }
  finally { if (early) g.clockOverride = prev; }
};

function click(el) {
  assert(el, "nothing to click");
  el.dispatchEvent(new window.Event("click", { bubbles: true }));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makePlan(overrides) {
  return Object.assign({
    id: "qa1",
    you: "A",
    them: "B",
    occasion: "Anniversary",
    kind: "easy",
    custom: "",
    date: "2026-10-10",
    city: stopsFile.cityId,
    drink: "no",
    style: "mystery",
    lean: "must",
    budget: "",
    budgetAmount: "200",
    must: "walking and coffee",
    anchor: null,
    skip: [],
    rebuild: 0,
    surprise: false,
    deck: null
  }, overrides || {});
}

function deckOf(overrides) {
  return g.buildDeck(makePlan(overrides));
}

function allIds(deck) {
  return Object.values(deck.pools).flat();
}

// A stand-in seafood-centric dinner. Pacific Counter is the real one. This copy of BellaBrava
// sorts first, so it would be the celebration dinner unless a note keeps it off.
function withSeafoodPlace(fn) {
  const base = g.STOP_BY_ID["bellabrava"];
  const fake = Object.assign({}, base, { id: "qa-oyster-bar", name: "QA Oyster Bar", feel: "taste", tags: base.tags.concat(["oysters", "raw bar"]), menuFocus: "seafood-centric", order: -1 });
  g.STOPS.push(fake);
  g.STOP_BY_ID[fake.id] = fake;
  try {
    return fn(fake);
  } finally {
    g.STOPS.splice(g.STOPS.indexOf(fake), 1);
    delete g.STOP_BY_ID[fake.id];
  }
}

// The note is read as a no: a seafood-centric place is off the whole deck, and a mixed menu stays allowed.
function keepsSeafoodCentricOff(must, extra) {
  return withSeafoodPlace((fake) => {
    const deck = deckOf(Object.assign({ must, kind: "celebrate", budgetAmount: "300" }, extra || {}));
    return deck.anchor.id !== fake.id && !allIds(deck).includes(fake.id);
  });
}

function sunny(iso) {
  g.weatherByDate[iso] = { status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Sunny", wet: false };
}

function wet(iso) {
  g.weatherByDate[iso] = { status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Showers", wet: true };
}

function resetPhone() {
  Object.keys(store).forEach((k) => delete store[k]);
  locationState.hash = "";
  locationState.search = "";
  g.clockOverride = PINNED;
  g.keepEarlyClock = false;
}

function startPlay(overrides) {
  resetPhone();
  const p = makePlan(overrides);
  sunny(p.date);
  g.openDay(p, { mode: "play" });
  return p;
}

const playText = () => $("play").textContent;
const playHtml = () => $("play").innerHTML;

// Runs fn with a different pool cap on a page, then puts the cap back to 6.
function withPoolMax(n, fn, page) {
  const w = page || g;
  w.POOL_MAX = n;
  try { return fn(); }
  finally { w.POOL_MAX = 6; }
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push("PASS " + name);
    console.log("PASS " + name);
  } catch (e) {
    results.push("FAIL " + name + ": " + e.message);
    console.error("FAIL " + name + ": " + e.message);
  }
}

// --- the deck ---

check("deck: up to 6 per feeling, no repeats, anchor not in pools, all open that date (#62)", () => {
  assert(g.POOL_MAX === 6, "the cap is " + g.POOL_MAX);
  for (const date of ["2026-10-10", "2026-10-13", "2026-10-17", "2027-03-06"]) {
    const deck = deckOf({ date, must: "coffee, tacos, art, walking, music", kind: "celebrate", budgetAmount: "300" });
    const ids = allIds(deck);
    assert(new Set(ids).size === ids.length, date + " repeats: " + ids);
    Object.values(deck.pools).forEach((list) => assert(list.length <= g.POOL_MAX, date + " pool too big"));
    if (deck.anchor.id) assert(!ids.includes(deck.anchor.id), date + " anchor in pools");
    const d = g.parseDate(date);
    ids.forEach((id) => assert(g.STOP_BY_ID[id].isOpen(d, date), date + " closed stop " + id));
    assert(ids.length >= 4, date + " too thin: " + ids);
  }
});

check("deck: a plain Tuesday still offers several feelings", () => {
  const deck = deckOf({ date: "2026-10-13", must: "" });
  const feels = Object.values(deck.pools).filter((l) => l.length).length;
  assert(feels >= 3, "feelings with options: " + feels + " " + JSON.stringify(deck.pools));
});

check("note: 'no seafood' keeps a seafood-centric place off, and a mixed menu on", () => {
  withSeafoodPlace((fake) => {
    assert(deckOf({ must: "pasta, dinner", kind: "celebrate", budgetAmount: "300" }).anchor.id === fake.id, "the stand-in would be the dinner");
    assert(deckOf({ must: "pasta for lunch", budgetAmount: "300" }).pools.taste.includes(fake.id), "the stand-in would be a tasty pick");
    assert(!deckOf({ must: "pasta for lunch, no seafood", budgetAmount: "300" }).pools.taste.includes(fake.id), "kept as a tasty pick");
  });
  assert(keepsSeafoodCentricOff("pasta, no seafood"), "seafood-centric place kept");
  // Stillwaters has schnitzel and jerk chicken next to its seafood, so it can stay.
  assert(!g.avoidsStop(makePlan({ must: "pasta, no seafood" }), g.STOP_BY_ID["stillwaters"]), "mixed menu vetoed");
});

check("note: 'no museums' keeps the Dalí and MFA off, even in the rain", () => {
  wet("2026-10-10");
  const deck = deckOf({ must: "no museums, walking, coffee", budgetAmount: "300" });
  const ids = allIds(deck);
  assert(!ids.includes("dali") && !ids.includes("mfa"), ids.join(","));
  assert(g.noteWants(makePlan({ must: "no museums please" })).art === false, "art should be off");
});

check("note: 'no museums' on Oct 10 drops every museum-tagged stop", () => {
  const deck = deckOf({ date: "2026-10-10", kind: "easy", budgetAmount: "200", must: "easy walking, coffee, tacos, no museums" });
  const ids = allIds(deck);
  const named = ["dali", "mfa", "james-museum", "woodson-museum", "st-pete-museum-of-history", "chihuly-collection", "tbw-discovery-center"];
  named.forEach((id) => {
    assert((g.STOP_BY_ID[id].tags || []).indexOf("museum") !== -1, id + " is not tagged museum");
    assert(ids.indexOf(id) === -1, id + " stayed in " + ids.join(","));
  });
  g.STOPS.filter((s) => (s.tags || []).indexOf("museum") !== -1).forEach((s) => {
    assert(ids.indexOf(s.id) === -1, "museum-tagged " + s.id + " stayed");
  });
  assert(ids.indexOf("bean-wandering-downtown") !== -1, "coffee stop missing: " + ids.join(","));
  assert((g.STOP_BY_ID["bean-wandering-downtown"].tags || []).indexOf("museum") === -1, "coffee stop tagged museum");
  assert(!/\b(?:dali|mfa|james-museum|tbw-discovery-center)\b/.test(g.noteAvoids.toString()), g.noteAvoids.toString());
  assert(!/s\.id === "(?:dali|mfa)"/.test(g.stopAllowed.toString()), "place id still in the veto");
});

check("note: 'not a party' does not knock out art", () => {
  const deck = deckOf({ must: "art and galleries, not a party", budgetAmount: "300" });
  assert(allIds(deck).some((id) => ["mfa", "morean", "dali", "palehorse"].includes(id)), JSON.stringify(deck.pools));
});

check("note: 'nothing but tacos' still wants tacos", () => {
  const deck = deckOf({ must: "nothing but tacos", budgetAmount: "200" });
  assert(deck.anchor.id === "bodega", "anchor " + JSON.stringify(deck.anchor));
});

check("budget: $60 keeps the nice dinner and museum tickets off", () => {
  const deck = deckOf({ must: "dinner and a walk", budgetAmount: "60", kind: "celebrate" });
  const ids = allIds(deck);
  assert(deck.anchor.id !== "bellabrava" && deck.anchor.id !== "stillwaters", "anchor " + deck.anchor.id);
  assert(!ids.includes("dali"), ids.join(","));
});

check("anchor: celebrate with room in the budget picks the nicer dinner", () => {
  const deck = deckOf({ must: "dinner", kind: "celebrate", budgetAmount: "300" });
  assert(deck.anchor.type === "stop" && deck.anchor.id === "bellabrava", JSON.stringify(deck.anchor));
});

check("anchor: no food in the note and an easy day means no fixed point", () => {
  const deck = deckOf({ must: "walking and people watching", kind: "easy" });
  assert(deck.anchor.type === "none", JSON.stringify(deck.anchor));
});

check("anchor: something already set becomes the fixed point with a leave-by", () => {
  const p = makePlan({ anchor: { name: "Dinner reservation", time: "17:45", where: "800 2nd Ave NE" } });
  const deck = g.buildDeck(p);
  assert(deck.anchor.type === "custom" && deck.anchor.time === 17.75 && deck.anchor.leave === 17.25, JSON.stringify(deck.anchor));
  g.plan = p; p.deck = deck;
  const line = g.anchorLine();
  assert(/Dinner reservation at 5:45pm\. Leave by about 5:15pm/.test(line), line);
});

check("sunset: about 7:10pm on October 10", () => {
  const h = g.sunsetHour(g.parseDate("2026-10-10"), g.CITIES.stpete);
  assert(h > 19.0 && h < 19.35, "sunset hour " + h);
});

// --- the link ---

check("link: the deck rides in the link and survives a weather change", () => {
  const p = makePlan({ must: "coffee, art, dinner", kind: "celebrate", budgetAmount: "300" });
  p.deck = g.buildDeck(p);
  // The real share link carries no note, so a rebuild on the recipient's phone would show.
  const back = g.decodePlan(g.encodePlan(g.linkPlan(p)));
  assert(JSON.stringify(back.deck) === JSON.stringify(p.deck), "deck changed in transit");
  wet(p.date);
  g.plan = back;
  assert(JSON.stringify(g.ensureDeck(back)) === JSON.stringify(p.deck), "weather changed the deck");
});

check("link: an older link without a deck still opens", () => {
  resetPhone();
  const old = makePlan({ style: "plan" });
  delete old.deck; delete old.anchor; delete old.surprise;
  const decoded = g.decodePlan(g.encodePlan(old));
  assert(decoded && decoded.deck === null, "decoded");
  g.openDay(decoded, { mode: "play" });
  assert(g.plan.deck && g.plan.deck.pools, "deck built on open");
});

check("link: bare hash and #play/ both open play", () => {
  const enc = g.encodePlan(makePlan());
  locationState.hash = "#" + enc;
  assert(g.parseIncomingHash().mode === "play", "bare");
  locationState.hash = "#play/" + enc;
  const parsed = g.parseIncomingHash();
  assert(parsed.mode === "play" && parsed.encoded === enc, "play/");
});

check("link: junk in the deck is dropped", () => {
  const p = makePlan();
  p.deck = { v: 1, anchor: { type: "stop", id: "pier", time: 18 }, pools: { taste: ["<x>", "kahwa", "dali"], drift: "pier" }, park: 1 };
  const back = g.decodePlan(g.encodePlan(p));
  assert(JSON.stringify(back.deck.pools.taste) === '["kahwa"]', JSON.stringify(back.deck.pools));
  assert(back.deck.anchor.type === "none", "pier is not a dinner anchor");
});

// --- old links ---

// Real share links made by earlier versions of this page, kept as text so no later change can
// quietly re-encode them. Every one must still open and play. When a change touches the play
// flow or the link format, add a link built by the current main here first.
const OLD_LINKS = [
  { built: "8240ac1, before the play loop: a list-style day with no frozen deck", hash: "#play/eyJpZCI6Im9sZGxpbmswIiwieW91IjoiQWxleCIsInRoZW0iOiJSaWxleSIsIm9jY2FzaW9uIjoiQW5uaXZlcnNhcnkiLCJraW5kIjoiZWFzeSIsImN1c3RvbSI6IiIsImRhdGUiOiIyMDI2LTEwLTEwIiwiY2l0eSI6IlN0LiBQZXRlcnNidXJnIiwiZHJpbmsiOiJubyIsInN0eWxlIjoicGxhbiIsImxlYW4iOiJtdXN0IiwiYnVkZ2V0IjoiIiwiYnVkZ2V0QW1vdW50IjoiMTUwIiwibXVzdCI6ImNvZmZlZSwgd2Fsa2luZywgdGFjb3MiLCJza2lwIjpbXX0" },
  { built: "8240ac1, the same day as a bare hash, the oldest link shape", hash: "#eyJpZCI6Im9sZGxpbmswIiwieW91IjoiQWxleCIsInRoZW0iOiJSaWxleSIsIm9jY2FzaW9uIjoiQW5uaXZlcnNhcnkiLCJraW5kIjoiZWFzeSIsImN1c3RvbSI6IiIsImRhdGUiOiIyMDI2LTEwLTEwIiwiY2l0eSI6IlN0LiBQZXRlcnNidXJnIiwiZHJpbmsiOiJubyIsInN0eWxlIjoicGxhbiIsImxlYW4iOiJtdXN0IiwiYnVkZ2V0IjoiIiwiYnVkZ2V0QW1vdW50IjoiMTUwIiwibXVzdCI6ImNvZmZlZSwgd2Fsa2luZywgdGFjb3MiLCJza2lwIjpbXX0" },
  { built: "607190a, a frozen deck with a dinner reservation", hash: "#play/eyJpZCI6Im9sZGxpbmsxIiwieW91IjoiQWxleCIsInRoZW0iOiJSaWxleSIsIm9jY2FzaW9uIjoiRGF0ZSIsImtpbmQiOiJlYXN5IiwiZGF0ZSI6IjIwMjYtMTAtMTAiLCJkcmluayI6Im5vIiwibGVhbiI6Im11c3QiLCJhbmNob3IiOnsibmFtZSI6IkRpbm5lciByZXNlcnZhdGlvbiIsInRpbWUiOiIxODozMCIsIndoZXJlIjoiODAwIDJuZCBBdmUgTkUifSwiZGVjayI6eyJ2IjoxLCJhbmNob3IiOnsidHlwZSI6ImN1c3RvbSIsInRpbWUiOjE4LjUsImxlYXZlIjoxOH0sInBvb2xzIjp7InRhc3RlIjpbIm1hcmtldCIsImthaHdhIiwic3RpbGx3YXRlcnMiXSwiZHJpZnQiOlsiZmVzdGl2YWwiXSwiZGlnIjpbInB1bXBraW4iLCJhcnRwb29sIl0sInNvZnQiOlsicGFsZWhvcnNlIiwiZGFsaSIsIm1mYSJdfSwicGFyayI6ZmFsc2V9fQ" },
  { built: "607190a, a frozen deck with a dinner the page picked", hash: "#play/eyJpZCI6Im9sZGxpbmsxIiwieW91IjoiQWxleCIsInRoZW0iOiJSaWxleSIsIm9jY2FzaW9uIjoiRGF0ZSIsImtpbmQiOiJlYXN5IiwiZGF0ZSI6IjIwMjYtMTAtMTAiLCJkcmluayI6Im5vIiwibGVhbiI6Im11c3QiLCJkZWNrIjp7InYiOjEsImFuY2hvciI6eyJ0eXBlIjoic3RvcCIsImlkIjoic3RpbGx3YXRlcnMiLCJ0aW1lIjoxOCwibGVhdmUiOjE3LjV9LCJwb29scyI6eyJ0YXN0ZSI6WyJtYXJrZXQiLCJrYWh3YSIsImJvZGVnYSJdLCJkcmlmdCI6WyJmZXN0aXZhbCJdLCJkaWciOlsicHVtcGtpbiIsImFydHBvb2wiXSwic29mdCI6WyJwYWxlaG9yc2UiLCJkYWxpIiwibWZhIl19LCJwYXJrIjpmYWxzZX19" },
  { built: "76b45ea, a Saturday with a late-night pizza place open until 3am (#30)", hash: "#play/eyJpZCI6Im9sZGxpbmszMCIsInlvdSI6IkFsZXgiLCJ0aGVtIjoiUmlsZXkiLCJvY2Nhc2lvbiI6IkRhdGUiLCJraW5kIjoiY2VsZWJyYXRlIiwiZGF0ZSI6IjIwMjYtMTAtMTAiLCJkcmluayI6Im5vIiwibGVhbiI6Im11c3QiLCJkZWNrIjp7InYiOjEsImFuY2hvciI6eyJ0eXBlIjoic3RvcCIsImlkIjoiYmVsbGFicmF2YSIsInRpbWUiOjE4LCJsZWF2ZSI6MTcuNX0sInBvb2xzIjp7InRhc3RlIjpbImpvZXktYnJvb2tseW5zLXBpenphIiwiY2Fzc2lzLXBpenphLW1hcmtldCIsIm1hcmtldCJdLCJkcmlmdCI6WyJmZXN0aXZhbCIsInN1bmtlbi1nYXJkZW5zIiwiY3Jlc2NlbnQtbGFrZS1wYXJrIl0sImRpZyI6WyJwdW1wa2luIiwidGhlLW1lcmNoYW50IiwiYXJ0cG9vbCJdLCJzb2Z0IjpbInBhbGVob3JzZSIsInN0LXBldGUtbXVzZXVtLW9mLWhpc3RvcnkiLCJkYWxpIl19LCJwYXJrIjpmYWxzZX19" },
  { built: "9e0a8a4, a frozen deck with a picked dinner, from an allergy note (no dinner alternates, no allergy flag)", hash: "#play/eyJpZCI6Im9sZGxpbmszMSIsInlvdSI6IkFsZXgiLCJ0aGVtIjoiUmlsZXkiLCJvY2Nhc2lvbiI6IkRhdGUiLCJraW5kIjoiY2VsZWJyYXRlIiwiZGF0ZSI6IjIwMjYtMTAtMTAiLCJkcmluayI6Im5vIiwibGVhbiI6Im11c3QiLCJkZWNrIjp7InYiOjEsImFuY2hvciI6eyJ0eXBlIjoic3RvcCIsImlkIjoiYmVsbGFicmF2YSIsInRpbWUiOjE4LCJsZWF2ZSI6MTcuNX0sInBvb2xzIjp7InRhc3RlIjpbIm1hcmtldCIsImNhZmUtY2xlbWVudGluZSIsInBhY2l1Z28iXSwiZHJpZnQiOlsiZmVzdGl2YWwiLCJzdW5rZW4tZ2FyZGVucyIsIm5vcnRoLXN0cmF1Yi1wYXJrIl0sImRpZyI6WyJwdW1wa2luIiwiZmxvcmlkYS1jcmFmdGFydCIsImNvYXN0YWwtaG91c2UtdmludGFnZSJdLCJzb2Z0IjpbInBhbGVob3JzZSIsImphbWVzLW11c2V1bSIsInN0LXBldGUtbXVzZXVtLW9mLWhpc3RvcnkiXX0sInBhcmsiOmZhbHNlfX0" },
  { built: "40a974a, current main before #33: picked dinner, alternates, allergy flag, no city", hash: "#play/eyJpZCI6Im9sZGxpbmszMyIsInlvdSI6IkFsZXgiLCJ0aGVtIjoiUmlsZXkiLCJvY2Nhc2lvbiI6IkRhdGUiLCJraW5kIjoiY2VsZWJyYXRlIiwiZGF0ZSI6IjIwMjYtMTAtMTAiLCJkcmluayI6Im5vIiwibGVhbiI6Im11c3QiLCJkZWNrIjp7InYiOjEsImFuY2hvciI6eyJ0eXBlIjoic3RvcCIsImlkIjoiYmVsbGFicmF2YSIsInRpbWUiOjE4LCJsZWF2ZSI6MTcuNSwiYWx0cyI6WyJsYS12LXZpZXRuYW1lc2UiLCJwaW4td29rLWJvd2wiXX0sInBvb2xzIjp7InRhc3RlIjpbInN0aWxsd2F0ZXJzIiwibWFya2V0IiwiY2Fzc2lzLXBpenphLW1hcmtldCJdLCJkcmlmdCI6WyJmZXN0aXZhbCIsInN1bmtlbi1nYXJkZW5zIiwiZ2l6ZWxsYS1rb3BzaWNrLWFyYm9yZXR1bSJdLCJkaWciOlsicHVtcGtpbiIsInRvbWJvbG8tYm9va3MiLCJmbG9yaWRhLWNyYWZ0YXJ0Il0sInNvZnQiOlsicGFsZWhvcnNlIiwiZGFsaSIsImphbWVzLW11c2V1bSJdfSwicGFyayI6ZmFsc2UsImFsbGVyZ3kiOnRydWV9fQ" }
];

check("standard: old #play/ links still play (open, reveal, We're here)", () => {
  OLD_LINKS.forEach((link) => {
    resetPhone();
    sunny("2026-10-10");
    openLink(link.hash);
    assert(g.mode === "play" && g.plan && g.plan.date === "2026-10-10", link.built + ": didn't open: " + playText().slice(0, 80));
    assert(g.view.panel === "curtain" && /Alex and Riley/.test(playText()), link.built + ": no curtain: " + playText().slice(0, 80));
    g.act("begin");
    const pools = g.plan.deck.pools;
    const feel = Object.keys(pools).find((f) => pools[f].length);
    assert(feel, link.built + ": no places to reveal");
    g.act("feel", feel);
    g.act("reveal");
    const id = g.view.pending;
    assert(id && g.STOP_BY_ID[id], link.built + ": nothing revealed");
    g.act("here", id);
    const trail = g.playState().trail;
    assert(trail.length === 1 && trail[0].id === id, link.built + ": We're here didn't log the stop");
  });
  // The reservation in a frozen deck is still the day's fixed point.
  resetPhone();
  sunny("2026-10-10");
  openLink(OLD_LINKS[2].hash);
  g.act("begin");
  assert(/Dinner reservation/.test(playText()), "the booking was lost");
});

// --- the play loop ---

check("play: curtain, then feelings, then one hidden pick, then one reveal", () => {
  startPlay({ must: "coffee, walking, vintage records", you: "Alex", them: "Riley" });
  assert(/For Alex and Riley\./.test(playText()), "curtain names");
  assert(!/Kahwa|ARTpool|Pier/.test(playText()), "curtain spoils a place");
  g.act("begin");
  assert(/What's calling\?/.test(playText()), "feel screen");
  assert(!/Kahwa|ARTpool/.test(playText()), "feel screen spoils a place");
  g.act("feel", "taste");
  assert(g.view.panel === "commit" && g.plan.deck.pools.taste.includes(g.view.pending), "pending from taste");
  const name = g.STOP_BY_ID[g.view.pending].name;
  assert(!playText().includes(name), "commit spoils the place");
  g.act("reveal");
  assert(playText().includes(name), "reveal shows the place");
  assert($("play").querySelectorAll("article").length === 0, "reveal is one card, not a list");
});

check("play: We're here logs the stop, fills a pip, and asks how it was", () => {
  startPlay({ must: "coffee, walking" });
  g.act("begin");
  g.act("feel", "taste");
  const id = g.view.pending;
  g.act("here", id);
  assert(g.playState().trail.length === 1 && g.playState().trail[0].id === id, "trail");
  assert($("play").querySelectorAll(".pip.done").length === 1, "pip");
  assert(/How was/.test(playText()), "rating prompt");
  g.act("rate", "love");
  assert(g.playState().trail[0].rating === "love", "rating saved");
  assert(!/How was/.test(playText()), "prompt gone");
  assert(!g.offered("taste").includes(id), "visited place not offered again");
});

check("dinner: a morning check-in does not finish a dinner that is not open yet", () => {
  startPlay({ date: "2026-10-10", must: "dinner", budgetAmount: "40", kind: "easy" });
  const id = g.plan.deck.anchor.id;
  const openAt = g.STOP_BY_ID[id].start(g.parseDate("2026-10-10"), "2026-10-10");
  assert(g.STOP_BY_ID[id].costBand === "cheap" && openAt > 9, id + " opens " + openAt);
  g.clockOverride = new Date("2026-10-10T09:00:00-04:00");
  g.act("begin");
  g.act("feel", "anchor");
  g.act("reveal");
  assert(/Opens at /.test(playText()) && !/Dinner: done/.test(playText()), playText().slice(0, 500));
  g.act("here", id);
  assert(g.playState().trail.length === 0 && !/Dinner: done/.test(playText()), "morning check-in: " + playText().slice(0, 300));
  g.clockOverride = new Date("2026-10-10T18:30:00-04:00");
  g.act("back");
  g.act("feel", "anchor");
  g.act("reveal");
  assert(!/Opens at /.test(playText()), "evening still says it has not opened");
  g.act("here", id);
  assert(g.anchorDone() && /Dinner: done\./.test(playText()), playText().slice(0, 300));
  g.clockOverride = PINNED;
});

check("play: a day-early We're here or Not this waits until the plan date", () => {
  try {
    startPlay({ date: "2026-10-10", must: "coffee, walking" });
    g.keepEarlyClock = true;
    g.clockOverride = new Date("2026-10-09T18:00:00-04:00");
    g.act("begin");
    g.act("feel", "taste");
    g.act("reveal");
    const id = g.view.pending;
    assert(id && /This day starts on Saturday, October 10\./.test(playText()), playText().slice(0, 500));
    g.act("here", id);
    assert(g.playState().trail.length === 0 && g.view.panel === "reveal" && g.view.pending === id, "early We're here wrote " + JSON.stringify(g.playState().trail));
    g.act("pass", id);
    assert(g.playState().passed.length === 0 && g.playState().skip.length === 0 && g.view.pending === id, "early Not this wrote " + g.playState().passed + " / " + g.playState().skip);
    g.act("back");
    assert(g.playState().passed.length === 0 && g.playState().skip.length === 0, "early Back to choosing wrote " + g.playState().passed);
    g.act("feel", "taste");
    g.act("reveal");
    g.clockOverride = new Date("2026-10-10T09:00:00-04:00");
    g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
    assert(g.playState().trail.length === 0 && g.playState().skip.length === 0 && g.playState().passed.length === 0, "the early taps carried onto Saturday");
    assert(!/This day starts/.test(playText()), "Saturday still says the day hasn't started");
    g.keepEarlyClock = false;
    g.act("begin");
    g.act("feel", "taste");
    g.act("reveal");
    const onDay = g.view.pending;
    g.act("here", onDay);
    assert(g.playState().trail.length === 1 && g.playState().trail[0].id === onDay, "Saturday We're here");
  } finally {
    g.keepEarlyClock = false;
    g.clockOverride = PINNED;
  }
});

check("play: Not this, try again swaps in another from the same feeling", () => {
  startPlay({ date: "2026-10-10", must: "coffee, gelato, market" });
  g.act("begin");
  g.act("feel", "taste");
  g.act("reveal");
  const first = g.view.pending;
  g.act("pass", first);
  assert(g.playState().passed.includes(first), "pass saved");
  assert(g.view.panel === "commit" && g.view.pending && g.view.pending !== first, "panel " + g.view.panel + " pending " + g.view.pending);
  assert(g.plan.deck.pools.taste.includes(g.view.pending), "replacement from the same feeling");
});

check("play: Not this lines up another place, and the passed place comes back later (#62)", () => {
  startPlay({ date: "2026-10-10", must: "coffee, gelato, market" });
  g.act("begin");
  g.act("feel", "taste");
  g.act("reveal");
  const first = g.view.pending;
  const before = playText();
  g.act("pass", first);
  assert(/Another place is lined up\./.test(playText()), playText().slice(0, 400));
  assert(!/Another place is lined up\./.test(before), "the line was already there");
  assert(g.view.panel === "commit" && g.view.pending !== first, "still veiled, new pending " + g.view.pending);
  const seen = new Set([first]);
  let guard = 0;
  while (g.view.panel === "commit" && g.view.pending && !seen.has(g.view.pending) && guard < 8) {
    const id = g.view.pending;
    seen.add(id);
    g.act("reveal");
    assert(!/Another place is lined up\./.test(playText()), "reveal should name the place");
    g.act("pass", id);
    guard++;
  }
  assert(g.view.panel === "commit" && g.view.pending === first, "the passed place didn't come back once the others were passed too: " + g.view.pending);
  assert(g.playState().passed.includes(first) && !g.playState().skip.includes(first) && g.offered("taste").includes(first), "a passed place left the pool: " + g.offered("taste"));
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  g.act("begin");
  g.act("feel", "taste");
  assert(g.playState().passed.includes(first) && !g.playState().skip.includes(first) && g.offered("taste").includes(first), "passed place gone after reload");
});

// --- #62: Not now and Never are different things ---

// A day played on its plan date at noon, so the hours filter is on and every tap writes.
// The feeling is picked at runtime: the first one with enough places on offer. Nothing is named.
function playOnTheDay(overrides) {
  const p = startPlay(Object.assign({ date: "2026-10-10" }, overrides || {}));
  g.clockOverride = new Date(p.date + "T12:00:00-04:00");
  g.act("begin");
  return p;
}

function moodWith(page, min) {
  const feel = page.FEEL_ORDER.find((f) => page.offered(f).length >= min);
  assert(feel, "no feeling has " + min + " open places to try this with: " + page.FEEL_ORDER.map((f) => page.offered(f).length));
  return feel;
}

// Reveal the lined-up place, then tap Not this. Returns the place that was passed.
function passOnPending(page) {
  page.act("reveal");
  const id = page.view.pending;
  page.act("pass", id);
  return id;
}

// What the next pick should be if the phone has seen the places in `passedOrder`, written without moodQueue.
function expectedQueue(page, feel, passedOrder) {
  const open = page.offered(feel);
  return open.filter((id) => !passedOrder.includes(id)).concat(passedOrder.filter((id) => open.includes(id)));
}

check("play: a place you pass on comes back at the next pick of that feeling (#62)", () => {
  playOnTheDay();
  const feel = moodWith(g, 2);
  const open = g.offered(feel).slice();
  g.act("feel", feel);
  const seen = [];
  for (let i = 0; i < open.length; i++) {
    seen.push(passOnPending(g));
    assert(g.playState().skip.length === 0, "Not this made a permanent no: " + g.playState().skip);
    if (i < open.length - 1) assert(g.view.panel === "commit" && !seen.includes(g.view.pending), "an unseen place should be next: " + g.view.pending);
  }
  assert(g.playState().passed.join() === seen.join(), "passed isn't in the order passed: " + g.playState().passed);
  assert(g.view.panel === "commit" && g.view.pending === seen[0], "the first place passed on should come back first, got " + g.view.pending);
  assert(new Set(seen).size === open.length, "a place showed twice before every place showed once");
  g.act("back");
  g.act("feel", feel);
  assert(g.view.pending === seen[0], "the next pick of the feeling isn't the oldest pass");
});

check("play: the next pick of a feeling shows unseen places before passed ones (#62)", () => {
  playOnTheDay();
  const feel = moodWith(g, 3);
  const open = g.offered(feel).slice();
  const mine = [];
  g.act("feel", feel);
  assert(g.view.pending === open[0], "the first pick isn't the deck's first open place");
  mine.push(passOnPending(g));
  // Different feeling, then the same one again: the unseen place is first, in the deck's order.
  g.act("back");
  g.act("feel", feel);
  assert(g.view.pending === expectedQueue(g, feel, mine)[0] && !mine.includes(g.view.pending), "a passed place came before an unseen one: " + g.view.pending);
  // Back to choosing from a revealed card is a pass too, and the pass goes to the end.
  g.act("reveal");
  const second = g.view.pending;
  g.act("back");
  mine.push(second);
  assert(g.playState().passed.join() === mine.join(), "Back to choosing from a reveal should pass: " + g.playState().passed);
  g.act("feel", feel);
  assert(!mine.includes(g.view.pending), "a passed place came before the last unseen one");
  assert(g.view.pending === expectedQueue(g, feel, mine)[0], "not the deck's next unseen place");
  // Passing again moves the place to the end, and a repeat never doubles it.
  g.act("reveal");
  const third = g.view.pending;
  g.act("back");
  mine.push(third);
  while (mine.length < open.length) {
    g.act("feel", feel);
    g.act("reveal");
    mine.push(g.view.pending);
    g.act("back");
  }
  g.act("feel", feel);
  assert(g.view.pending === mine[0], "after every place was passed on, the oldest pass should be first");
  g.act("reveal");
  g.act("back");
  assert(g.playState().passed.join() === mine.slice(1).concat(mine[0]).join(), "passing again should move it to the end: " + g.playState().passed);
  // Back from a hidden card writes nothing.
  g.act("feel", feel);
  const before = g.playState().passed.join();
  g.act("back");
  assert(g.playState().passed.join() === before && g.playState().skip.length === 0, "Different feeling from a hidden card wrote something");
});

check("play: the same feeling can be picked again while it has open, unvisited places (#62)", () => {
  playOnTheDay();
  const feel = moodWith(g, 1);
  const button = () => playHtml().includes('data-act="feel" data-arg="' + feel + '"');
  g.act("feel", feel);
  const first = passOnPending(g);
  g.act("back");
  assert(button(), "the feeling's button went away after a pass");
  g.act("feel", feel);
  assert(g.view.panel === "commit" && g.offered(feel).includes(g.view.pending), "the feeling couldn't be picked again");
  g.act("reveal");
  g.act("back");
  g.act("feel", feel);
  assert(g.view.panel === "commit", "picked a third time and nothing came");
  assert(g.offered(feel).includes(first), "a passed place isn't on offer");
});

check("play: Shuffle cycles every open, unvisited place in the feeling, passed ones included, then loops (#62)", () => {
  playOnTheDay();
  const feel = moodWith(g, 3);
  const open = g.offered(feel).slice();
  g.act("feel", feel);
  const passedOne = passOnPending(g);
  g.act("back");
  g.act("feel", feel);
  const start = g.view.pending;
  const passedBefore = g.playState().passed.join();
  const order = [start];
  for (let i = 1; i < open.length; i++) {
    g.act("shuffle");
    assert(g.view.panel === "commit", "Shuffle left the hidden card");
    order.push(g.view.pending);
  }
  assert(new Set(order).size === open.length && order.every((id) => open.includes(id)), "Shuffle missed a place or showed one twice: " + order);
  assert(order.includes(passedOne), "the passed place wasn't in the cycle");
  assert(order.join() === expectedQueue(g, feel, [passedOne]).join(), "Shuffle isn't unseen first, then passed: " + order);
  g.act("shuffle");
  assert(g.view.pending === start, "Shuffle didn't loop back to the start");
  assert(g.playState().passed.join() === passedBefore && g.playState().skip.length === 0, "Shuffle wrote something");
  // A card that isn't in the queue any more goes to the front.
  g.view.pending = "";
  g.act("shuffle");
  assert(g.view.pending === order[0], "a card that fell out of the queue should restart at the front");
});

check("play: visited and Not for us places never come back that day, even after a reload (#62)", () => {
  const p = playOnTheDay();
  const feel = moodWith(g, 3);
  const open = g.offered(feel).slice();
  g.act("feel", feel);
  const visited = g.view.pending;
  g.act("here", visited);
  g.act("list");
  const never = g.offered(feel)[0];
  g.act("skip", never);
  g.act("feel", feel);
  const passed = passOnPending(g);
  assert(!g.playState().passed.includes(visited) && !g.playState().passed.includes(never), "a visited or turned-down place was written as passed");
  const check = () => {
    const state = g.playState();
    assert(state.skip.includes(never) && state.passed.includes(passed) && state.trail.some((t) => t.id === visited), "state lost: " + JSON.stringify(state));
    assert(!g.offered(feel).includes(visited) && !g.offered(feel).includes(never) && g.offered(feel).includes(passed), "offered: " + g.offered(feel));
    g.act("back");
    for (let i = 0; i < open.length + 2; i++) {
      g.act("feel", feel);
      assert(g.view.pending !== visited && g.view.pending !== never, "a place we're done with came back: " + g.view.pending);
      g.act("shuffle");
      assert(g.view.pending !== visited && g.view.pending !== never, "Shuffle brought back a place we're done with");
      g.act("back");
    }
  };
  check();
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  g.clockOverride = new Date(p.date + "T12:00:00-04:00");
  g.act("begin");
  check();
});

check("play: a feeling's button hides only when nothing in it is open, unvisited, and not turned down (#62)", () => {
  playOnTheDay();
  const feel = moodWith(g, 3);
  const open = g.offered(feel).slice();
  const button = () => playHtml().includes('data-act="feel" data-arg="' + feel + '"');
  g.act("feel", feel);
  for (let i = 0; i < open.length; i++) {
    passOnPending(g);
    g.act("back");
    assert(button(), "the button hid after passing on place " + (i + 1) + " of " + open.length);
  }
  assert(g.playState().passed.length === open.length && g.playState().skip.length === 0, "setup: every place passed on, none turned down");
  // Visit all but the last, which is turned down from the list.
  g.act("list");
  open.slice(0, -1).forEach((id) => {
    g.act("here", id);
    assert(button(), "the button hid with a place still open");
  });
  assert(g.offered(feel).length === 1 && g.offered(feel)[0] === open[open.length - 1], "setup: one place left");
  g.act("skip", open[open.length - 1]);
  g.act("back");
  assert(g.offered(feel).length === 0 && !button(), "the button should hide when nothing is open, unvisited and not turned down");
});

check("standard: old #play/ links and old phone skips still play after #62", () => {
  OLD_LINKS.forEach((link) => {
    resetPhone();
    sunny("2026-10-10");
    openLink(link.hash);
    assert(g.mode === "play" && g.plan, link.built + ": didn't open");
    assert(Array.isArray(g.playState().passed) && g.playState().passed.length === 0, link.built + ": passed isn't an empty list");
    const feel = g.FEEL_ORDER.find((f) => g.offered(f).length >= 2);
    assert(feel, link.built + ": no feeling with two places");
    const never = g.offered(feel)[0], legacy = g.offered(feel)[1];
    // A phone from before #62: its skips, its legacy skip key, and no passed field at all.
    store["cityday-play-state-" + g.plan.id] = JSON.stringify({ started: true, skip: [never], trail: [] });
    store["cityday-play-skip-" + g.plan.id] = JSON.stringify([legacy]);
    openLink(link.hash);
    const state = g.playState();
    assert(state.passed.length === 0 && state.skip.includes(never) && state.skip.includes(legacy), link.built + ": old phone state: " + JSON.stringify(state));
    assert(!g.offered(feel).includes(never) && !g.offered(feel).includes(legacy), link.built + ": an old skip came back");
    // A link that carries skip still feeds plan.skip, and stays permanent.
    const raw = JSON.parse(Buffer.from(link.hash.replace(/^#play\//, "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    const carried = g.decodePlan(g.encodePlan(Object.assign(raw, { skip: [never] })));
    assert(carried.skip.includes(never), link.built + ": the link's skip was dropped");
    g.act("begin");
    g.act("feel", feel);
    g.act("reveal");
    const id = g.view.pending;
    assert(id && id !== never, link.built + ": revealed a skipped place");
    g.act("here", id);
    assert(g.playState().trail.length === 1 && g.playState().trail[0].id === id, link.built + ": We're here didn't log");
  });
  resetPhone();
  sunny("2026-10-10");
  openLink(OLD_LINKS[0].hash);
  g.plan.skip = [g.offered(g.FEEL_ORDER.find((f) => g.offered(f).length))[0]];
  const carried = g.plan.skip[0];
  g.act("begin");
  g.FEEL_ORDER.forEach((f) => { assert(!g.offered(f).includes(carried), "plan.skip didn't hold"); assert(!g.moodQueue(f).includes(carried), "plan.skip came back in a queue"); });
});

check("play: Chapter 0 parking when the note mentions driving", () => {
  startPlay({ must: "we are driving, need parking, coffee" });
  g.act("begin");
  assert(/park the car/.test(playText()), "chapter 0");
  g.act("parked");
  assert(/What's calling\?/.test(playText()), "then feelings");
});

check("play: on the day, the clock filters what is offered", () => {
  startPlay({ date: "2026-10-10", must: "market, coffee, gelato" });
  assert(g.plan.deck.pools.taste.includes("market"), "market in deck");
  g.clockOverride = new Date("2026-10-10T10:00:00-04:00");
  assert(g.offered("taste").includes("market"), "market offered at 10am");
  g.clockOverride = new Date("2026-10-10T20:00:00-04:00");
  assert(!g.offered("taste").includes("market"), "market not offered at 8pm");
  g.clockOverride = new Date("2026-10-08T20:00:00-04:00");
  assert(g.offered("taste").includes("market"), "before the day, everything stays on offer");
});

check("play: the list gets louder after three stops (mystery goes stale)", () => {
  startPlay({ must: "coffee, walking, art, vintage" });
  g.act("begin");
  assert(!/Mystery getting stale/.test(playText()), "not promoted at the start");
  const ids = g.liveIds().slice(0, 3);
  ids.forEach((id) => g.act("here", id));
  assert(/Mystery getting stale\? Show me the list/.test(playText()), "promoted after 3");
  g.act("list");
  assert($("play").querySelectorAll("article").length >= 1, "list shows cards");
  ids.forEach((id) => assert(!playText().includes(g.STOP_BY_ID[id].name), "visited on list: " + id));
});

check("play: Sky looks iffy offers only indoor places", () => {
  startPlay({ date: "2026-10-10", must: "walking, art, coffee", budgetAmount: "300" });
  wet("2026-10-10");
  g.act("begin");
  g.act("iffy");
  const outdoor = g.liveIds().filter((id) => g.STOP_BY_ID[id].outdoor).map((id) => g.STOP_BY_ID[id].name);
  outdoor.forEach((n) => assert(!playText().includes(n), "outdoor in plan B: " + n));
  assert(/Plan B/.test(playText()), "plan B");
  assert($("play").querySelectorAll("article").length >= 1, "plan B lists indoor places");
});

check("play: wet weather copy never names a place before it is revealed", () => {
  startPlay({ must: "walking, art", budgetAmount: "300" });
  wet(g.plan.date);
  g.render();
  assert(!/Dal[ií]|MFA|Museum/.test(playText()), playText().slice(0, 200));
});

check("play: Vibes are cooling points to the fixed point", () => {
  startPlay({ must: "dinner", kind: "celebrate", budgetAmount: "300" });
  g.act("begin");
  g.act("cool");
  assert(/BellaBrava/.test(playText()), "anchor named in wind-down");
});

check("play: the fixed point reveals through Real dinner and logs", () => {
  startPlay({ must: "dinner", kind: "celebrate", budgetAmount: "300" });
  g.act("begin");
  assert(/Real dinner/.test(playText()), "real dinner option");
  g.act("feel", "anchor");
  g.act("reveal");
  assert(/BellaBrava/.test(playText()) && /Not booked/.test(playText()), "anchor reveal");
  g.clockOverride = new Date("2026-10-10T18:30:00-04:00");
  g.act("here", "bellabrava");
  assert(g.playState().trail.some((t) => t.id === "bellabrava"), "logged after it opened");
  assert(!/Real dinner/.test(playText()), "anchor not offered twice");
  g.clockOverride = PINNED;
});

check("play: We found something goes on the day, with a rating", () => {
  startPlay();
  g.act("begin");
  g.act("found");
  $("found-name").value = "Mural on 10th St";
  $("found-note").value = "Go back at golden hour";
  g.view.found.rating = "love";
  g.saveFound();
  const t = g.playState().trail[0];
  assert(t.found && t.name === "Mural on 10th St" && t.rating === "love", JSON.stringify(t));
  g.act("trail");
  assert(/Mural on 10th St/.test(playText()) && /Found it ourselves/.test(playText()), "trail shows it");
  assert(/Loved it/.test(playText()), "rating shown");
  assert(/loved it/.test(g.trailText()), "copy text includes rating");
});

check("play: a found spot needs a name", () => {
  startPlay();
  g.act("begin");
  g.act("found");
  $("found-name").value = "  ";
  g.saveFound();
  assert(g.playState().trail.length === 0, "nothing saved");
  assert(!$("found-err").classList.contains("hidden"), "error shown");
});

check("play: names are escaped", () => {
  startPlay({ you: "<img src=x onerror=alert(1)>", them: "B" });
  assert(!playHtml().includes("<img"), "raw tag rendered");
});

check("play: the trail survives a reload on the same phone", () => {
  startPlay();
  g.act("begin");
  g.act("here", g.liveIds()[0]);
  const p = g.plan;
  g.openDay(g.decodePlan(g.encodePlan(p)), { mode: "play" });
  assert(g.playState().trail.length === 1 && g.view.panel !== "curtain", "kept trail and skipped the curtain");
});

// --- the creator desk ---

check("desk: share link uses #play/ and the desk lists places by feeling", () => {
  resetPhone();
  const p = makePlan({ must: "coffee, art, walking", budgetAmount: "300" });
  sunny(p.date);
  g.openDay(p, { mode: "create" });
  assert(g.mode === "create" && !$("screen-desk").classList.contains("hidden"), "desk visible");
  assert(/#play\//.test($("share-url").value), "share url");
  const first = g.STOP_BY_ID[g.liveIds()[0]].name;
  assert($("desk-top").textContent.includes(first), "names on desk");
});

check("desk: Surprise us too hides the places from the creator", () => {
  g.plan.surprise = true;
  g.render();
  g.liveIds().forEach((id) => {
    assert(!$("desk-top").textContent.includes(g.STOP_BY_ID[id].name), "desk shows " + id);
    assert(!$("recap").textContent.includes(g.STOP_BY_ID[id].name), "recap shows " + id);
  });
  assert(/What we checked/.test($("desk-top").textContent), "summary");
  g.plan.surprise = false;
});

check("desk: Not for us on the desk swaps the next place in", () => {
  g.plan.surprise = false;
  g.render();
  const target = g.plan.deck.pools.taste[0];
  const eligible = withPoolMax(99, () => g.buildDeck(g.plan).pools.taste.length);
  assert(g.plan.deck.pools.taste.length === g.POOL_MAX, "precondition: a full taste pool");
  click($("desk-top").querySelector('[data-desk-skip="' + target + '"]'));
  assert(!g.liveIds().includes(target), "removed");
  assert(g.plan.deck.pools.taste.length === Math.min(eligible - 1, g.POOL_MAX) && !g.plan.deck.pools.taste.includes(target), "the next place stepped in: " + g.plan.deck.pools.taste);
  const saved = JSON.parse(window.localStorage.getItem("cityday-test-v1")).plans[g.plan.id];
  assert(saved.skip.includes(target), "saved");
  assert(/Copy the link again/.test($("save-note").textContent), "told the copied link is stale");
});

check("desk: wet weather line counts real indoor picks, names none", () => {
  wet(g.plan.date);
  const line = g.weatherLine(g.plan.date);
  assert(/indoor picks are on the day/.test(line) && !/Dal[ií]|MFA/.test(line), line);
});

check("desk: Play it here is a preview, and Back to your desk returns", () => {
  const enc = g.encodePlan(g.linkPlan(g.plan));
  click($("open-guest"));
  assert(locationState.hash === "#preview/" + enc, "button sets the preview hash: " + locationState.hash.slice(0, 20));
  g.boot();
  assert(g.mode === "play" && g.previewing === true, "preview mode");
  assert(/Preview\. Nothing you tap here carries into the real day/.test(playText()), "preview banner");
  locationState.hash = "";
  locationState.search = "?create=" + encodeURIComponent(g.plan.id);
  g.boot();
  assert(g.mode === "create" && g.previewing === false, "desk again");
  assert(locationState.search === "", "?create stripped, so Play it here works next time");
  locationState.hash = "#play/" + enc;
  g.boot();
  assert(g.mode === "play" && g.previewing === false, "the real link is not a preview");
});

check("form: a past date and a half-filled fixed point are refused", () => {
  resetPhone();
  g.setMode("create");
  g.plan = null;
  g.fillForm(null);
  $("you").value = "A"; $("them").value = "B";
  g.applyPills({ occasion: "Date", drink: "no", lean: "gems" });
  g.renderKinds("Date", "easy");
  $("budget-amount").value = "120";
  $("date").value = "2020-01-01";
  assert(g.submitForm() === false && /today or a date ahead/.test($("form-err").textContent), "past date");
  $("date").value = "2026-10-09";
  $("anchor-name").value = "Dinner";
  assert(g.submitForm() === false && /already set/.test($("form-err").textContent), "anchor without time");
  $("anchor-time").value = "18:30";
  assert(g.submitForm() === true, "valid form");
  assert(g.plan.deck.anchor.type === "custom", "anchor saved");
});

// --- fixes from the pre-PR review ---

function creatorDesk(overrides) {
  resetPhone();
  const p = makePlan(overrides);
  sunny(p.date);
  g.previewing = false;
  g.openDay(p, { mode: "create" });
  return g.plan;
}

function openLink(hash) {
  locationState.search = "";
  locationState.hash = hash;
  g.boot();
}

check("review: a preview on the creator's phone never touches the real day", () => {
  const p = creatorDesk({ must: "coffee, gelato, walking, art", budgetAmount: "200" });
  const before = g.liveIds().slice();
  const enc = g.encodePlan(g.linkPlan(p));
  click($("open-guest"));
  g.boot();
  assert(g.previewing === true, "Play it here opened a preview");
  g.act("begin");
  g.act("feel", "taste");
  g.act("reveal");
  g.act("pass", g.view.pending);
  g.act("reveal");
  g.act("here", g.view.pending);
  assert(g.playState().trail.length === 1 && g.playState().passed.length === 1, "preview trail recorded");
  locationState.hash = "";
  locationState.search = "?create=" + encodeURIComponent(p.id);
  g.boot();
  assert(JSON.stringify(g.liveIds()) === JSON.stringify(before), "desk changed after preview: " + g.liveIds());
  openLink("#play/" + enc);
  assert(g.view.panel === "curtain" && g.playState().trail.length === 0 && g.playState().skip.length === 0 && g.playState().passed.length === 0, "real day starts clean");
  // A second Play it here starts a fresh preview.
  openLink("");
  click($("open-guest"));
  assert(window.localStorage.getItem("cityday-play-state-" + p.id + "-preview") === null, "old preview cleared");
});

check("review: the share link carries the day, not the note, budget or vetoes", () => {
  creatorDesk({ must: "I'm proposing at sunset. She hates seafood. Keep it cheap.", budgetAmount: "75" });
  g.plan.skip.push(g.liveIds()[0]);
  const url = g.shareUrl();
  const raw = url.slice(url.indexOf("#play/") + 6);
  const json = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert(!/proposing|seafood|"budgetAmount"|"skip"|"must":|"surprise"|"rebuild"/.test(json), json);
  const back = g.decodePlan(raw);
  assert(back && back.deck && back.you === "A", "still opens");
});

check("review: an older link without a deck keeps its whole note", () => {
  const old = makePlan({ must: "x".repeat(380) + " and coffee. Please, no seafood." });
  delete old.deck;
  const back = g.decodePlan(g.encodePlan(old));
  assert(back.must.endsWith("no seafood."), "note cut: " + back.must.slice(-20));
});

check("review: Back to your desk opens that day, not the newest one", () => {
  const a = creatorDesk({ you: "Alex", them: "Riley" });
  const aEnc = g.encodePlan(g.linkPlan(a));
  g.plan = null;
  const b = makePlan({ id: "planB", you: "Ana", them: "Bo" });
  g.openDay(b, { mode: "create" });
  const store = JSON.parse(window.localStorage.getItem("cityday-test-v1"));
  assert(store.plans[a.id] && store.plans.planB && store.last === "planB", "both days stored, B newest");
  openLink("#play/" + aEnc);
  const link = $("play").querySelector('a[href*="?create="]');
  assert(link, "desk link shown");
  const href = link.getAttribute("href");
  assert(href.endsWith("?create=" + encodeURIComponent(a.id)), href);
  applyUrl(href);
  g.boot();
  assert(g.plan.id === a.id && /Alex and Riley/.test($("desk-top").textContent), "opened " + g.plan.id);
});

check("review: a cut-off link says so and keeps the address", () => {
  const p = creatorDesk();
  const enc = g.encodePlan(g.linkPlan(p));
  openLink("#play/" + enc.slice(0, 60));
  assert(g.mode === "play" && /didn't come through whole/.test(playText()), playText().slice(0, 80));
  assert(locationState.hash.startsWith("#play/"), "hash kept");
});

check("review: leaving a received link does not leak it into the form", () => {
  resetPhone();
  const p = makePlan({ you: "Alex", them: "Riley", must: "secret proposal" });
  p.deck = g.buildDeck(p);
  openLink("#play/" + g.encodePlan(p));
  openLink("");
  assert(g.plan === null, "plan cleared");
  assert($("you").value === "" && $("must").value === "", "form empty");
});

check("review: a new date is a new day with its own id", () => {
  const p = creatorDesk();
  const oldId = p.id;
  g.fillForm(p);
  $("date").value = "2026-10-09";
  assert(g.submitForm() === true, "submitted");
  assert(g.plan.id !== oldId, "same id kept");
});

check("review: a revealed card survives a reload", () => {
  const p = startPlay({ must: "vintage, records, art" });
  g.act("begin");
  g.act("feel", "dig");
  g.act("reveal");
  const card = g.view.pending;
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  assert(g.view.panel === "reveal" && g.view.pending === card, "lost the card: " + g.view.panel);
  g.act("here", card);
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  assert(g.view.panel === "feel", "after We're here, back to choosing");
});

check("review: a feeling tapped after its places closed goes back, not to an empty card", () => {
  startPlay({ date: "2026-10-10", must: "art, vintage", budgetAmount: "300" });
  g.clockOverride = new Date("2026-10-10T15:20:00-04:00");
  g.act("begin");
  const dig = g.plan.deck.pools.dig;
  assert(g.offered("dig").length, "dig offered at 3:20");
  g.clockOverride = new Date("2026-10-10T16:50:00-04:00");
  g.act("feel", "dig");
  assert(g.view.panel === "feel" || dig.includes(g.view.pending), "panel " + g.view.panel + " pending " + g.view.pending);
});

check("review: a place that closed between commit and reveal is not revealed", () => {
  startPlay({ date: "2026-10-10", must: "art, vintage", budgetAmount: "300" });
  g.clockOverride = new Date("2026-10-10T15:20:00-04:00");
  g.act("begin");
  g.act("feel", "dig");
  assert(g.view.panel === "commit" && g.view.pending, "commit at 3:20");
  const committed = g.view.pending;
  g.clockOverride = new Date("2026-10-10T17:40:00-04:00");
  assert(!g.offered("dig").includes(committed), "the committed place should have closed by 5:40");
  g.act("reveal");
  assert(g.view.pending !== committed, "revealed a place that had closed: " + g.view.pending);
  assert(g.view.panel === "feel" ? !g.view.pending : g.offered("dig").includes(g.view.pending), "panel " + g.view.panel + " pending " + g.view.pending);
});

check("review: a second tab does not wipe the first tab's stops", () => {
  const p = startPlay();
  g.act("begin");
  const ids = g.liveIds();
  g.act("here", ids[0]);
  const key = "cityday-play-state-" + p.id;
  const other = JSON.parse(window.localStorage.getItem(key));
  other.trail.push({ id: ids[1], name: "x", at: new Date().toISOString(), rating: "", found: false });
  window.localStorage.setItem(key, JSON.stringify(other));
  g.act("here", ids[2]);
  const trail = JSON.parse(window.localStorage.getItem(key)).trail.map((t) => t.id);
  assert(trail.includes(ids[0]) && trail.includes(ids[1]) && trail.includes(ids[2]), trail.join(","));
});

check("review: hates, doesn't eat, allergic to and can't stand all count as no", () => {
  for (const must of ["he doesn't eat seafood. dinner somewhere nice", "she hates seafood but loves pasta", "allergic to seafood. pasta, art", "can't stand seafood. dinner"]) {
    assert(keepsSeafoodCentricOff(must, { budgetAmount: "250" }), must);
  }
  const deck = deckOf({ must: "she hates museums. walking", date: "2026-10-13", budgetAmount: "300" });
  assert(!allIds(deck).includes("dali") && !allIds(deck).includes("mfa"), JSON.stringify(deck.pools));
  assert(deckOf({ must: "we don't want to deal with parking, coffee" }).park === false, "parking veto");
  assert(deckOf({ must: "walk over to the water, coffee", date: "2026-10-13" }).pools.drift.includes("pier"), "'over' is not a no");
});

check("review: lunch in the note does not invent a 6pm dinner", () => {
  const deck = deckOf({ must: "Tacos for lunch, then the pier. Home by 4 for the babysitter.", kind: "easy", budgetAmount: "120" });
  assert(deck.anchor.type === "none", JSON.stringify(deck.anchor));
  assert(deck.pools.taste.includes("bodega"), "tacos stay a daytime option: " + deck.pools.taste);
});

check("review: a place sent away on the desk never comes back as dinner", () => {
  const p = creatorDesk({ date: "2026-10-13", must: "lunch by the water, walking", kind: "celebrate", budgetAmount: "100" });
  p.skip.push("stillwaters");
  p.must = "dinner, walking";
  p.deck = g.buildDeck(p);
  assert(p.deck.anchor.id !== "stillwaters", JSON.stringify(p.deck.anchor));
});

check("review: an easy Oct 17 skips the reservation-only volunteer shift and leads with free things", () => {
  const easy = deckOf({ date: "2026-10-17", must: "easy walking, people watching, coffee", budgetAmount: "120" });
  assert(!allIds(easy).includes("boyd"), JSON.stringify(easy.pools));
  const vol = deckOf({ date: "2026-10-17", must: "volunteering outdoors, coffee" });
  assert(allIds(vol).includes("boyd"), "asked for volunteering");
  const music = deckOf({ date: "2026-10-17", must: "sleep in, brunch, gelato, a slow stroll", budgetAmount: "250" });
  assert(music.pools.drift[0] !== "folk", "ticketed show first without asking: " + music.pools.drift);
  assert(deckOf({ date: "2026-10-17", must: "live music, tacos", budgetAmount: "250" }).pools.drift[0] === "folk", "asked for music");
});

check("review: the weather after 6pm and on past days tells the truth", () => {
  g.weatherByDate = {};
  g.applyForecast("2026-10-10", { properties: { periods: [
    { name: "Tonight", isDaytime: false, startTime: "2026-10-10T19:00:00-04:00", temperature: 72, temperatureUnit: "F", windSpeed: "5 mph", windDirection: "E", shortForecast: "Chance Showers And Thunderstorms" },
    { name: "Sunday", isDaytime: true, startTime: "2026-10-11T06:00:00-04:00", temperature: 84, temperatureUnit: "F", shortForecast: "Sunny" }
  ] } });
  assert(g.weatherByDate["2026-10-10"].status === "ready" && g.weatherByDate["2026-10-10"].name === "Tonight" && g.weatherByDate["2026-10-10"].wet, JSON.stringify(g.weatherByDate["2026-10-10"]));
  g.clockOverride = new Date("2026-10-20T10:00:00-04:00");
  g.loadWeather("2026-10-12");
  assert(g.weatherLine("2026-10-12") === "This day has passed.", g.weatherLine("2026-10-12"));
  g.clockOverride = PINNED;
});

check("review: after dinner, the wind-down and the strip both know it's done", () => {
  startPlay({ must: "dinner", kind: "celebrate", budgetAmount: "300" });
  g.act("begin");
  g.clockOverride = new Date("2026-10-10T18:30:00-04:00");
  g.act("here", "bellabrava");
  g.act("cool");
  assert(/Dinner's done/.test(playText()) && !/No fixed point/.test(playText()), playText().slice(0, 200));
  g.act("back");
  assert(/Dinner: done\./.test(playText()) && !/Leave by/.test(playText()), "strip");
  g.clockOverride = PINNED;
});

check("review: Plan B lists only what is open right now on the day", () => {
  startPlay({ date: "2026-10-13", must: "art, coffee", budgetAmount: "300" });
  wet("2026-10-13");
  g.clockOverride = new Date("2026-10-13T09:05:00-04:00");
  g.act("begin");
  g.act("iffy");
  const listed = () => Array.from($("play").querySelectorAll("h2")).map((h) => h.textContent);
  assert(!listed().some((n) => /Museum of Fine Arts|The Dalí Museum/.test(n)), "lists places that open at 10");
  g.clockOverride = new Date("2026-10-13T10:30:00-04:00");
  g.act("back");
  g.act("iffy");
  assert(listed().some((n) => /Museum of Fine Arts|The Dalí Museum/.test(n)), "at 10:30 the museums are open");
  g.clockOverride = PINNED;
});

check("review: Surprise us too hides a dinner the engine picked, but not one you booked", () => {
  creatorDesk({ must: "pasta dinner, coffee, walking", kind: "celebrate", budgetAmount: "300" });
  g.plan.surprise = true;
  g.render();
  assert(!/BellaBrava/.test($("desk-top").textContent + $("recap").textContent), "dinner named");
  assert(/Dinner, hidden/.test($("desk-top").textContent), "hidden label");
  creatorDesk({ anchor: { name: "Dinner reservation", time: "17:45", where: "800 2nd Ave NE" } });
  g.plan.surprise = true;
  g.render();
  assert(/Dinner reservation/.test($("desk-top").textContent), "your own booking stays visible");
});

check("review: the desk says why there is no dinner, even after a reload", () => {
  creatorDesk({ must: "dinner, no tacos, no poke, no pizza", kind: "celebrate", budgetAmount: "20" });
  assert(/No dinner here fit your note and budget/.test($("desk-top").textContent), $("desk-top").textContent.slice(0, 300));
  locationState.hash = "";
  locationState.search = "";
  g.boot();
  assert(/No dinner here fit your note and budget/.test($("desk-top").textContent), "after reload");
});

check("review: the festival is labelled this weekend only, and counts read right", () => {
  creatorDesk({ date: "2026-10-11", must: "festival, music, walking" });
  assert(/St\. Pete Fall Festival · this weekend only/.test($("desk-top").textContent), "label");
  g.plan.surprise = true;
  g.render();
  assert(/1 is a dated event\./.test($("desk-top").textContent), $("desk-top").textContent.slice(0, 400));
});

check("review: Copy our day falls back to a selectable box without a clipboard", () => {
  startPlay();
  g.act("begin");
  g.act("here", g.liveIds()[0]);
  g.act("trail");
  g.act("copy-trail");
  assert($("trail-text") && /A day in St\. Pete|An anniversary/.test($("trail-text").value), "fallback box");
  assert(/copy it by hand/.test($("trail-copied").textContent), "told what to do");
});

check("review: a link with a prototype id does not claim to be yours", () => {
  creatorDesk();
  const p = makePlan({ id: "__proto__" });
  p.deck = g.buildDeck(p);
  openLink("#play/" + g.encodePlan(p));
  assert(!/Back to your desk/.test(playText()), "desk link shown");
});

check("review: the budget help says the note can override it", () => {
  assert(/unless your note asks for them/.test(document.querySelector("#budget-amount").parentNode.textContent), "copy");
});

// --- fixes from the verification pass ---

check("verify: wishes are not vetoes; vetoes stop at the next idea", () => {
  const dali = deckOf({ must: "She's never been to the Dali, so that's a must. Nice dinner after.", kind: "celebrate", budgetAmount: "250" });
  assert(dali.pools.soft.includes("dali"), "never been: " + dali.pools.soft);
  assert(deckOf({ must: "never tried gelato from Paciugo, walking" }).pools.taste.includes("paciugo"), "never tried");
  assert(deckOf({ must: "she doesn't want to miss the festival" }).pools.drift.includes("festival"), "doesn't want to miss");
  assert(deckOf({ must: "He doesn't eat seafood so let's do tacos", date: "2026-10-13", budgetAmount: "120" }).anchor.id === "bodega", "so let's do tacos");
  assert(deckOf({ must: "she can't stand seafood so maybe italian", date: "2026-10-13", kind: "celebrate", budgetAmount: "250" }).anchor.id === "bellabrava", "so maybe italian");
  assert(deckOf({ must: "he doesn't drink so coffee and gelato instead", date: "2026-10-13" }).pools.taste.includes("kahwa"), "so coffee");
});

check("verify: turning down one museum keeps the other; post-noun and accented vetoes work", () => {
  const one = deckOf({ must: "he didn't like the MFA but loves the Dali", date: "2026-10-13" });
  assert(one.pools.soft.includes("dali") && !one.pools.soft.includes("mfa"), JSON.stringify(one.pools.soft));
  const thing = deckOf({ must: "museums are not our thing, coffee and records", date: "2026-10-13" });
  assert(!thing.pools.soft.includes("dali") && !thing.pools.soft.includes("mfa"), JSON.stringify(thing.pools.soft));
  const accent = deckOf({ must: "no Dalí please, walking", date: "2026-10-13" });
  assert(!accent.pools.soft.includes("dali"), JSON.stringify(accent.pools.soft));
  assert(!allIds(deckOf({ date: "2026-10-17", drink: "yes", must: "beer garden, walking, tacos" })).includes("boyd"), "beer garden");
});

check("verify: with storage blocked, the loop still plays", () => {
  startPlay({ must: "coffee, walking" });
  const real = window.localStorage;
  const blocked = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); }, removeItem() {} };
  window.localStorage = blocked;
  g.storageOK = false;
  try {
    g.playCache = null;
    g.act("begin");
    g.act("feel", "taste");
    assert(g.view.panel === "commit", "panel " + g.view.panel);
    g.act("reveal");
    g.act("here", g.view.pending);
    assert(g.view.panel === "feel" && g.playState().trail.length === 1, "trail in memory");
  } finally {
    window.localStorage = real;
    g.storageOK = true;
  }
});

check("verify: what you typed in We found something survives a redraw", () => {
  startPlay();
  g.act("begin");
  g.act("found");
  const name = $("found-name");
  name.value = "Taco truck on 10th";
  name.dispatchEvent(new window.Event("input", { bubbles: true }));
  const note = $("found-note");
  note.value = "get two";
  note.dispatchEvent(new window.Event("input", { bubbles: true }));
  g.render();
  assert($("found-name").value === "Taco truck on 10th" && $("found-note").value === "get two", "wiped");
  g.saveFound();
  assert(g.playState().trail[0].name === "Taco truck on 10th", "saved");
});

check("verify: a card held during an early peek is not the first screen of the day", () => {
  startPlay({ date: "2026-10-10", must: "dinner", kind: "celebrate", budgetAmount: "300" });
  g.clockOverride = new Date("2026-10-08T20:00:00-04:00");
  g.act("begin");
  g.act("feel", "anchor");
  g.act("reveal");
  g.clockOverride = new Date("2026-10-10T09:00:00-04:00");
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  assert(g.view.panel === "feel", "panel " + g.view.panel);
});

check("verify: a forwarded preview link plays as the real day on someone else's phone", () => {
  resetPhone();
  const p = makePlan({ id: "fromSomeoneElse" });
  p.deck = g.buildDeck(p);
  openLink("#preview/" + g.encodePlan(p));
  assert(g.previewing === false && !/Preview\./.test(playText()), "shown as a preview");
  assert(locationState.hash.startsWith("#play/"), "hash rewritten to the real link");
});

check("verify: an old link settles on 'This day has passed' without a tap", () => {
  resetPhone();
  g.weatherByDate = {};
  g.clockOverride = new Date("2026-10-12T10:00:00-04:00");
  const p = makePlan({ date: "2026-10-10" });
  p.deck = g.buildDeck(p);
  openLink("#play/" + g.encodePlan(p));
  assert(/This day has passed\./.test(playText()) && !/Checking/.test(playText()), playText().slice(0, 200));
});

check("verify: a failed forecast is retried, and a fresh one is not refetched", () => {
  let calls = 0;
  const realFetch = g.fetch;
  g.fetch = async () => { calls++; throw new Error("offline"); };
  try {
    g.clockOverride = PINNED;
    g.weatherByDate = { "2026-10-10": { status: "error", fetchedAt: Date.now() - 5 * 60000 } };
    g.loadWeather("2026-10-10");
    assert(calls === 1, "stale error retried: " + calls);
    g.weatherByDate = { "2026-10-10": { status: "error", fetchedAt: Date.now() } };
    g.loadWeather("2026-10-10");
    g.weatherByDate = { "2026-10-10": { status: "ready", name: "Sat", temp: "80°F", wind: "5", short: "Sunny", wet: false, fetchedAt: Date.now() } };
    g.loadWeather("2026-10-10");
    assert(calls === 1, "fresh entries refetched: " + calls);
  } finally {
    g.fetch = realFetch;
  }
});

check("verify: Vibes are cooling after your own booking reads cleanly", () => {
  startPlay({ anchor: { name: "Dinner reservation", time: "17:45", where: "800 2nd Ave NE" } });
  g.act("begin");
  g.act("here", "anchor");
  g.act("cool");
  assert(/Dinner reservation: done\./.test(playText()) && !/reservation's/.test(playText()), playText().slice(0, 200));
});

check("verify: a note being edited on the desk is not reverted by Not for us or Surprise", () => {
  creatorDesk({ must: "coffee, art, walking", budgetAmount: "300" });
  $("note-edit").value = "coffee, art, walking, tacos for lunch";
  click($("desk-top").querySelector("[data-desk-skip]"));
  assert($("note-edit").value === "coffee, art, walking, tacos for lunch", "reverted by Not for us");
  const box = $("surprise");
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert($("note-edit").value === "coffee, art, walking, tacos for lunch", "reverted by Surprise");
  click($("rebuild"));
  assert(g.plan.must === "coffee, art, walking, tacos for lunch", "rebuilt from the edited note");
});

check("verify: a second desk tab's vetoes survive a rebuild here", () => {
  const p = creatorDesk({ must: "coffee, gelato, walking", budgetAmount: "200" });
  const target = g.liveIds()[0];
  const saved = JSON.parse(window.localStorage.getItem("cityday-test-v1"));
  saved.plans[p.id].skip = [target];
  window.localStorage.setItem("cityday-test-v1", JSON.stringify(saved));
  click($("rebuild"));
  assert(g.plan.skip.includes(target) && !g.liveIds().includes(target), "other tab's veto lost");
});

check("verify: the form says exactly what is missing, takes cents, and keeps the kind on a re-tap", () => {
  resetPhone();
  g.setMode("create");
  g.plan = null;
  g.fillForm(null);
  $("you").value = "A"; $("them").value = "B";
  click(document.querySelector('[data-group=occasion] [data-value="Anniversary"]'));
  click($("kinds").querySelector('[data-value="celebrate"]'));
  click(document.querySelector('[data-group=occasion] [data-value="Anniversary"]'));
  assert($("kinds").querySelector('[aria-pressed="true"]'), "re-tap cleared the kind");
  click(document.querySelector('[data-group=occasion] [data-value="Date"]'));
  assert(($("kinds").querySelector('[aria-pressed="true"]') || {}).getAttribute("data-value") === "celebrate", "switching occasion kept the kind");
  $("date").value = "2026-10-09";
  assert(g.submitForm() === false && /Still needed: drinking, must-sees or hidden gems, and a budget\./.test($("form-err").textContent), $("form-err").textContent);
  g.applyPills({ occasion: "Date", drink: "no", lean: "gems" });
  g.renderKinds("Date", "celebrate");
  $("budget-amount").value = "150.50";
  assert(g.submitForm() === true && g.plan.budgetAmount === "151", "cents: " + (g.plan && g.plan.budgetAmount));
});

check("verify: resubmitting the same date keeps the day's id and its desk vetoes", () => {
  const p = creatorDesk({ must: "coffee, gelato, walking", budgetAmount: "200" });
  const id = p.id;
  const target = g.liveIds()[0];
  click($("desk-top").querySelector('[data-desk-skip="' + target + '"]'));
  click($("edit"));
  assert(g.submitForm() === true, "resubmitted");
  assert(g.plan.id === id, "id changed on the same date");
  assert(g.plan.skip.includes(target) && !g.liveIds().includes(target), "desk veto lost");
});

check("verify: Copy link without a clipboard selects the link to copy by hand", () => {
  creatorDesk();
  const box = $("share-url");
  let focused = false, selected = false;
  box.focus = () => { focused = true; };
  box.select = () => { selected = true; };
  click($("copy"));
  assert(box.value.includes("#play/"), "link in the box");
  assert(focused && selected, "not selected for copying by hand");
});

async function checkAsync(name, fn) {
  try {
    await fn();
    results.push("PASS " + name);
    console.log("PASS " + name);
  } catch (e) {
    results.push("FAIL " + name + ": " + e.message);
    console.error("FAIL " + name + ": " + e.message);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

await checkAsync("verify: when the clipboard refuses, both copy buttons fall back to copy-by-hand", async () => {
  const real = g.clipboardApi;
  g.clipboardApi = () => ({ writeText: () => Promise.reject(new Error("NotAllowedError")) });
  try {
    creatorDesk();
    const box = $("share-url");
    let selected = false;
    box.select = () => { selected = true; };
    click($("copy"));
    await tick();
    assert(selected, "desk link not selected");
    g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
    g.act("begin");
    g.act("here", g.liveIds()[0]);
    g.act("trail");
    g.act("copy-trail");
    await tick();
    assert($("trail-text") && /copy it by hand/.test($("trail-copied").textContent), "trail fallback missing");
  } finally {
    g.clipboardApi = real;
  }
});

// --- friend-test fixes ---

check("friends: the feedback message carries the trail and three prompts", () => {
  startPlay({ must: "coffee, walking" });
  g.act("begin");
  const id = g.liveIds()[0];
  g.act("here", id);
  g.act("rate", "love");
  g.act("found");
  $("found-name").value = "Mural on 10th St";
  g.view.found.rating = "no";
  g.saveFound();
  const text = g.feedbackText();
  assert(text.includes(g.STOP_BY_ID[id].name + " (loved it)"), text);
  assert(/Mural on 10th St \(not for us\), found it ourselves/.test(text), text);
  assert(/Best moment:/.test(text) && /What felt off or broken:/.test(text) && /Would you use it again\?/.test(text), "prompts");
  assert(!/\d{3}[-. ]\d{3}[-. ]\d{4}|@/.test(text), "no phone number or email");
});

check("friends: Tell Jake how it went is on Our day so far and at the end of the day", () => {
  startPlay();
  g.act("begin");
  g.act("trail");
  assert(/Tell Jake how it went/.test(playText()), "trail");
  g.act("back");
  g.act("cool");
  assert(/Tell Jake how it went/.test(playText()), "wind-down");
  const page = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert(!/(?:tel|sms|mailto):/i.test(page) && !/\d/.test(g.FEEDBACK_TO), "a way to reach Jake directly in the page");
  assert(!/\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/.test(page), "a phone number in the page");
});

await checkAsync("friends: Tell Jake how it went shares, copies, or falls back to copy-by-hand", async () => {
  const realShare = g.shareApi;
  const realClip = g.clipboardApi;
  const status = () => { const d = $("feedback-done"); return d && !d.classList.contains("hidden") ? d.textContent : ""; };
  const send = () => click($("play").querySelector('[data-act="feedback"]'));
  let shared, copied;
  function onTrail() {
    startPlay({ must: "coffee" });
    g.act("begin");
    g.act("here", g.liveIds()[0]);
    g.act("trail");
    shared = null;
    copied = null;
  }
  const failWith = (name) => () => Promise.reject(Object.assign(new Error(name), { name }));
  const clipOk = () => ({ writeText: (t) => { copied = t; return Promise.resolve(); } });
  try {
    // The share sheet sends it.
    onTrail();
    g.shareApi = () => (data) => { shared = data; return Promise.resolve(); };
    g.clipboardApi = clipOk;
    send();
    await tick();
    assert(shared && shared.text === g.feedbackText(), "share got the message");
    assert(status() === "Thanks for sending it." && copied === null, "after a share: " + status());
    // Closing the share sheet is quiet: no copy, no message, no box.
    onTrail();
    g.shareApi = () => failWith("AbortError");
    send();
    await tick();
    assert(copied === null && status() === "" && !$("feedback-text"), "after closing the sheet: " + status());
    // Any other share failure copies instead.
    onTrail();
    g.shareApi = () => failWith("NotAllowedError");
    send();
    await tick();
    assert(copied === g.feedbackText() && status() === "Copied. Text it to Jake.", "after a share error: " + status());
    // No share sheet, and the clipboard works.
    onTrail();
    g.shareApi = () => null;
    send();
    await tick();
    assert(copied === g.feedbackText() && status() === "Copied. Text it to Jake.", "no share sheet: " + status());
    // No share sheet, and the clipboard refuses: the message appears to copy by hand.
    onTrail();
    g.clipboardApi = () => ({ writeText: failWith("NotAllowedError") });
    send();
    await tick();
    assert($("feedback-text") && $("feedback-text").value === g.feedbackText(), "copy-by-hand box");
    assert(status() === "Select this, copy it, and text it to Jake.", "clipboard refused: " + status());
    // No share sheet and no clipboard at all.
    onTrail();
    g.clipboardApi = () => null;
    send();
    await tick();
    assert($("feedback-text") && $("feedback-text").value === g.feedbackText(), "no clipboard: copy-by-hand box");
  } finally {
    g.shareApi = realShare;
    g.clipboardApi = realClip;
  }
});

check("friends: the feedback message names the day", () => {
  const p = startPlay({ date: "2026-10-10", must: "coffee" });
  const text = g.feedbackText();
  assert(text.includes(g.formatWhen(g.parseDate(p.date))) && /October 10/.test(text), text.split("\n").slice(0, 3).join(" / "));
});

check("friends: the intro says it's an early test, and play shows the tag", () => {
  assert(/early test with friends/.test($("screen-about").textContent), "intro");
  startPlay();
  assert(/Early test/.test(playText()), "curtain tag");
  g.act("begin");
  assert(/Early test/.test(playText()), "loop tag");
});

check("friends: plan today through 3 days out; further out gets a friendly no", () => {
  resetPhone();
  g.setMode("create");
  g.plan = null;
  g.fillForm(null);
  assert($("date").getAttribute("max") === "2026-10-10", "max " + $("date").getAttribute("max"));
  $("you").value = "A"; $("them").value = "B";
  g.applyPills({ occasion: "Date", drink: "no", lean: "gems" });
  g.renderKinds("Date", "easy");
  $("budget-amount").value = "120";
  $("date").value = "2026-10-11";
  assert(g.submitForm() === false && /pick today or one of the next 3 days/.test($("form-err").textContent), $("form-err").textContent);
  $("date").value = "2028-03-04";
  assert(g.submitForm() === false, "2028 accepted");
  $("date").value = "2026-10-10";
  assert(g.submitForm() === true, "3 days out refused");
  $("date").value = "2026-10-06";
  g.plan = null;
  assert(g.submitForm() === false, "past date accepted");
});

// Built by main at 607190a, before the 3-day window, for Saturday, March 6, 2027: Alex and Riley,
// with a dinner reservation at 6:30pm. Kept as text so a later change can't quietly re-encode it.
const OLD_FAR_LINK = "eyJpZCI6Im9sZGxpbmsxIiwieW91IjoiQWxleCIsInRoZW0iOiJSaWxleSIsIm9jY2FzaW9uIjoiRGF0ZSIsImtpbmQiOiJlYXN5IiwiZGF0ZSI6IjIwMjctMDMtMDYiLCJkcmluayI6Im5vIiwibGVhbiI6Im11c3QiLCJhbmNob3IiOnsibmFtZSI6IkRpbm5lciByZXNlcnZhdGlvbiIsInRpbWUiOiIxODozMCIsIndoZXJlIjoiODAwIDJuZCBBdmUgTkUifSwiZGVjayI6eyJ2IjoxLCJhbmNob3IiOnsidHlwZSI6ImN1c3RvbSIsInRpbWUiOjE4LjUsImxlYXZlIjoxOH0sInBvb2xzIjp7InRhc3RlIjpbIm1hcmtldCIsImthaHdhIiwic3RpbGx3YXRlcnMiXSwiZHJpZnQiOlsicGllciJdLCJkaWciOlsiZ2xhc3MiLCJhcnRwb29sIl0sInNvZnQiOlsibWZhIiwiZGFsaSIsIm1vcmVhbiJdfSwicGFyayI6ZmFsc2V9fQ";

check("friends: an old link dated past the 3-day window still opens and plays", () => {
  resetPhone();
  sunny("2027-03-06");
  openLink("#play/" + OLD_FAR_LINK);
  assert(g.mode === "play" && g.plan && g.plan.date === "2027-03-06", "didn't open: " + playText().slice(0, 80));
  assert(g.view.panel === "curtain" && /Alex and Riley/.test(playText()), playText().slice(0, 80));
  g.act("begin");
  g.act("feel", "taste");
  g.act("reveal");
  const id = g.view.pending;
  assert(["market", "kahwa", "stillwaters"].includes(id), "revealed " + id);
  g.act("here", id);
  const trail = g.playState().trail;
  assert(trail.length === 1 && trail[0].id === id, "We're here didn't log the stop");
});

check("friends: cards say today only on the day, and the weekday otherwise", () => {
  startPlay({ date: "2026-10-10", must: "coffee" });
  const why = g.stopView("kahwa").why;
  assert(/on Saturday at 204/.test(why) && !/\btoday\b/.test(why), why);
  g.clockOverride = new Date("2026-10-10T09:00:00-04:00");
  assert(/today at 204/.test(g.stopView("kahwa").why), "on the day");
  g.clockOverride = new Date("2026-09-20T09:00:00-04:00");
  assert(/on Saturday, October 10/.test(g.stopView("kahwa").why), "far out");
  g.clockOverride = PINNED;
});

check("friends: allergies and 'no fish' keep seafood off", () => {
  for (const must of ["dinner, allergic to shellfish", "dinner, no fish", "dinner. shrimp allergy", "dinner, he can't eat crab or lobster", "dinner, no sushi"]) {
    assert(keepsSeafoodCentricOff(must), must);
  }
  // A dish is still a dish: "no sushi" keeps the sushi-and-Thai place off.
  assert(g.avoidsStop(makePlan({ must: "dinner, no sushi" }), g.STOP_BY_ID["pin-wok-bowl"]), "no sushi");
  const terms = g.avoidTerms(makePlan({ must: "nut allergy, she's gluten-free, no dairy" }));
  assert(terms.includes("nuts") && terms.includes("gluten") && terms.includes("dairy"), JSON.stringify(terms));
  // Still the same as before:
  assert(!allIds(deckOf({ must: "she hates museums. walking", date: "2026-10-13" })).includes("dali"), "hates museums");
  assert(deckOf({ must: "She's never been to the Dali, so that's a must.", kind: "celebrate", budgetAmount: "250" }).pools.soft.includes("dali"), "never been");
  assert(deckOf({ must: "He doesn't eat seafood so let's do tacos", date: "2026-10-13", budgetAmount: "120" }).anchor.id === "bodega", "so tacos");
  assert(keepsSeafoodCentricOff("no seafood, dinner"), "no seafood");
});

check("friends: a note that says no drinking beats Drinking: yes", () => {
  for (const must of ["we don't drink, no bars", "no breweries please, coffee", "sober, walking", "skip the bars, tacos"]) {
    const deck = deckOf({ must, drink: "yes" });
    assert(!allIds(deck).includes("bench"), must + ": " + JSON.stringify(deck.pools.taste));
  }
  assert(allIds(deckOf({ must: "beer, walking", drink: "yes" })).includes("bench"), "drinking still works");
  assert(!allIds(deckOf({ must: "beer, walking", drink: "no" })).includes("bench"), "Drinking: no still works");
});

check("friends: no anniversary leftovers in the page or the checks", () => {
  const page = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const checks = fs.readFileSync(new URL("./qa-verify.mjs", import.meta.url), "utf8");
  for (const word of ["Be" + "so", "Away from the " + "kids", "Sara" + "sota"]) {
    assert(!page.includes(word) && !checks.includes(word), "found " + word);
  }
});

check("friends: link preview tags and icons are in place", () => {
  const head = document.head.innerHTML;
  for (const tag of ['property="og:title"', 'property="og:description"', 'property="og:image"', 'property="og:url"', 'name="twitter:card"', 'rel="icon"', 'rel="apple-touch-icon"']) {
    assert(head.includes(tag), "missing " + tag);
  }
  for (const f of ["og-image.png", "favicon.ico", "favicon-32.png", "apple-touch-icon.png"]) {
    assert(fs.existsSync(new URL("./" + f, import.meta.url)), "missing file " + f);
  }
  const png = fs.readFileSync(new URL("./og-image.png", import.meta.url));
  assert(png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, "og image is not 1200x630");
});

check("friends: escape routes are at least 44px tall and use the escape style", () => {
  const css = [...document.querySelectorAll("style")].map((x) => x.textContent).join("\n");
  const rule = /\.escape\s*\{([^}]*)\}/.exec(css);
  assert(rule && /min-height:\s*44px/.test(rule[1]), "no 44px min-height");
  startPlay();
  g.act("begin");
  for (const act of ["list", "iffy", "cool", "trail"]) {
    const el = $("play").querySelector('[data-act="' + act + '"]');
    assert(el && el.classList.contains("escape"), act + " is not an escape button");
  }
});

// --- fixes from the PR 1 review ---

check("review: a second veto in the same clause still counts ('can't have dairy so no gelato')", () => {
  assert(!allIds(deckOf({ must: "can't have dairy so no gelato", kind: "celebrate", budgetAmount: "300" })).includes("paciugo"), "gelato");
  assert(deckOf({ must: "we can't eat gluten so no pizza, dinner", kind: "celebrate", budgetAmount: "300" }).anchor.id !== "bellabrava", "pizza");
  const caffeine = deckOf({ must: "she can't have caffeine so no coffee, gelato instead", budgetAmount: "300" });
  assert(!allIds(caffeine).includes("kahwa") && allIds(caffeine).includes("paciugo"), JSON.stringify(caffeine.pools.taste));
  assert(!allIds(deckOf({ must: "can't eat shellfish and no museums", budgetAmount: "300" })).includes("dali"), "museums");
});

check("review: allergy lists block every allergen, written any common way", () => {
  for (const must of ["dinner, she's allergic to nuts and shellfish", "dinner, allergic to peanuts, shellfish", "dinner, shellfish and peanut allergies",
    "dinner, she has an allergy to shellfish", "dinner. Allergies: shellfish", "dinner, she has food allergies (shellfish)", "dinner, no nuts and no shellfish"]) {
    assert(keepsSeafoodCentricOff(must), must);
  }
  const both = g.avoidTerms(makePlan({ must: "allergic to nuts and dairy" }));
  assert(both.includes("nuts") && both.includes("dairy"), JSON.stringify(both));
  assert(deckOf({ must: "allergic to shellfish and we want tacos, dinner", kind: "celebrate", budgetAmount: "300" }).anchor.id === "bodega", "the list stops at the first non-food");
});

check("review: long phrases don't veto everything tagged food or dinner", () => {
  assert(allIds(deckOf({ must: "dinner, she can't eat spicy food", budgetAmount: "300" })).includes("market"), "market kept");
  assert(deckOf({ must: "we can't have a late dinner, babysitter", kind: "celebrate", budgetAmount: "300" }).anchor.type === "stop", "dinner kept");
});

check("review: 'not picky' and 'no preference' aren't vetoes", () => {
  for (const must of ["not picky about tacos or pizza, dinner", "no strong preference between tacos or italian, dinner"]) {
    assert(g.avoidTerms(makePlan({ must })).length === 0, must);
  }
  assert(g.negatedPhrases("no crab or lobster").join() === "crab or lobster", "or still carries a real veto");
});

check("review: drinking turns off only when the note is about alcohol", () => {
  for (const must of ["Neither of us drinks. walking and coffee", "nobody drinks, tacos", "non-drinkers, walking", "we don't drink, no bars", "skip the breweries", "no alcohol please"]) {
    assert(g.effectiveDrink(makePlan({ must, drink: "yes" })) === "no", must);
  }
  for (const must of ["I don't drink coffee, but a brewery sounds fun", "not into wine, love a good brewery", "no wine bars, a brewery is great"]) {
    assert(g.effectiveDrink(makePlan({ must, drink: "yes" })) === "yes", must);
  }
});

check("review: once dinner is checked in, the screen you land on offers the feedback", () => {
  startPlay({ must: "dinner", kind: "celebrate", budgetAmount: "300" });
  g.act("begin");
  assert(!/Tell Jake how it went/.test(playText()), "too early");
  g.clockOverride = new Date("2026-10-10T18:30:00-04:00");
  g.act("here", "bellabrava");
  assert(/Tell Jake how it went/.test(playText()), "missing after dinner");
  click($("play").querySelector('.btn[data-act="trail"]'));
  assert(g.view.panel === "trail" && $("play").querySelector('[data-act="feedback"]'), "goes to the feedback");
  g.clockOverride = PINNED;
});

// --- the catalog ---

check("catalog: park hours come from the sun, not a guess", () => {
  const park = g.STOP_BY_ID["albert-whitted-park"];
  const oct = g.parseDate("2026-10-10"), jan = g.parseDate("2027-01-10");
  assert(Math.abs(park.start(oct) - (g.sunriseHour(oct, g.CITIES.stpete) - 0.5)) < 0.1, "opens 30 min before sunrise: " + park.start(oct));
  assert(Math.abs(park.end(oct) - (g.sunsetHour(oct, g.CITIES.stpete) + 0.5)) < 0.1, "closes 30 min after sunset: " + park.end(oct));
  assert(park.end(jan) < park.end(oct), "closes earlier in winter");
  assert(/opens 30 min before sunrise, closes 30 min after sunset/.test(park.hours(oct)), park.hours(oct));
  // Published times for St. Pete (sunrise-sunset.org), including both DST switch days.
  const published = [["2026-10-10", "07:26", "19:08"], ["2026-11-01", "06:40", "17:47"], ["2026-12-21", "07:15", "17:41"],
    ["2027-03-14", "07:39", "19:39"], ["2027-06-21", "06:34", "20:30"]];
  const hrs = (t) => Number(t.slice(0, 2)) + Number(t.slice(3)) / 60;
  for (const [iso, rise, set] of published) {
    const d = g.parseDate(iso);
    assert(Math.abs(g.sunriseHour(d, g.CITIES.stpete) - hrs(rise)) <= 3 / 60, iso + " sunrise " + g.fmtHour(g.sunriseHour(d, g.CITIES.stpete)) + ", published " + rise);
    assert(Math.abs(g.sunsetHour(d, g.CITIES.stpete) - hrs(set)) <= 3 / 60, iso + " sunset " + g.fmtHour(g.sunsetHour(d, g.CITIES.stpete)) + ", published " + set);
  }
  assert(g.STOP_BY_ID["crescent-lake-park"].end(oct) === 23, "an exact close stays exact");
});

check("catalog: a lunch break and a past-midnight close read correctly", () => {
  const tue = g.parseDate("2026-10-13"), sat = g.parseDate("2026-10-10");
  assert(g.STOP_BY_ID["pin-wok-bowl"].hours(tue) === "11:30am–3pm, 4pm–9pm", g.STOP_BY_ID["pin-wok-bowl"].hours(tue));
  assert(g.STOP_BY_ID["pin-wok-bowl"].hours(sat) === "12pm–10pm", g.STOP_BY_ID["pin-wok-bowl"].hours(sat));
  assert(g.STOP_BY_ID["joey-brooklyns-pizza"].hours(sat) === "11am–3am", g.STOP_BY_ID["joey-brooklyns-pizza"].hours(sat));
  assert(!g.STOP_BY_ID["joey-brooklyns-pizza"].dinner, "a takeout slice shop is not a dinner anchor");
});

check("catalog: a place isn't offered on days its source lists shorter hours or an event", () => {
  const open = (id, iso) => g.STOP_BY_ID[id].isOpen(g.parseDate(iso), iso);
  assert(!open("chihuly-collection", "2026-12-24") && open("chihuly-collection", "2026-12-23"), "Chihuly closes at 3pm on Christmas Eve");
  assert(!open("tbw-discovery-center", "2026-12-15") && open("tbw-discovery-center", "2026-12-16"), "TBW's short day");
  assert(!open("st-pete-shuffleboard-club", "2026-11-05") && open("st-pete-shuffleboard-club", "2026-11-12"), "Shuffleboard's fundraiser night");
  assert(!open("st-pete-shuffleboard-club", "2026-12-24"), "Shuffleboard's Christmas Eve closure");
  for (const e of ADDED) {
    for (const iso of (e.closedDates || []).concat(e.skipDates || [])) assert(g.parseDate(iso), e.id + " has a bad date " + iso);
  }
});

check("catalog: a note about kids, rain or walking doesn't lift the budget limit; naming the place does", () => {
  const ticketed = (must) => {
    const d = deckOf({ date: "2026-10-13", budgetAmount: "20", must });
    return [d.anchor.id, ...Object.values(d.pools).flat()].filter((id) => id && g.pricey(g.STOP_BY_ID[id], "2026-10-13"));
  };
  for (const must of ["walking and coffee", "we have kids", "we love the pier", "rainy day", "indoor stuff"]) {
    assert(ticketed(must).length === 0, must + ": " + ticketed(must));
  }
  assert(ticketed("sunken gardens and coffee").includes("sunken-gardens"), "named Sunken Gardens");
  assert(ticketed("the chihuly").includes("chihuly-collection"), "named the Chihuly");
});

check("catalog: 'no kids' says who's coming; it doesn't veto places that welcome kids", () => {
  const p = makePlan({ must: "no kids, just the two of us" });
  const vetoed = g.STOPS.filter((s) => g.avoidsStop(p, s)).map((s) => s.id);
  assert(vetoed.length === 0, "vetoed: " + vetoed);
  assert(g.avoidsStop(makePlan({ must: "no museums" }), g.STOP_BY_ID["james-museum"]), "a real veto still works");
});

check("catalog: meal words count once, so a named cuisine still wins", () => {
  const anchor = (must) => deckOf({ date: "2026-10-13", budgetAmount: "100", must }).anchor.id;
  assert(anchor("lunch, then dinner. thai please") === "pin-wok-bowl", "thai: " + anchor("lunch, then dinner. thai please"));
  assert(anchor("a dinner and a lunch spot, falafel") === "baba-on-central", "falafel: " + anchor("a dinner and a lunch spot, falafel"));
  assert(anchor("vietnamese dinner") === "la-v-vietnamese", "vietnamese");
});

check("catalog: a midday break counts as closed", () => {
  startPlay({ date: "2026-10-13", must: "thai, indoor" });
  const v = g.stopView("pin-wok-bowl");
  const at = (t) => { g.clockOverride = new Date("2026-10-13T" + t + ":00-04:00"); return g.openNow(v); };
  assert(at("13:00") && !at("14:45") && at("15:30") && at("16:30"), "open, closing for the break, reopening soon, open");
  g.clockOverride = new Date("2026-10-13T15:30:00-04:00");
  g.act("begin");
  g.act("iffy");
  assert(!/Pin Wok/.test(playText()), "listed as open now during its break");
  g.clockOverride = new Date("2026-10-13T16:30:00-04:00");
  g.act("back");
  g.act("iffy");
  assert(/Pin Wok/.test(playText()), "not listed once it reopens");
  g.clockOverride = PINNED;
});

check("catalog: a $40 day still gets a cheap dinner and cheap food to pick from", () => {
  const d = deckOf({ date: "2026-10-13", budgetAmount: "40", must: "dinner" });
  const a = g.STOP_BY_ID[d.anchor.id];
  assert(a && a.costBand === "cheap", "dinner: " + (d.anchor.id || d.anchor.reason));
  const food = d.pools.taste.filter((id) => g.STOP_BY_ID[id].meal && g.STOP_BY_ID[id].meal !== "coffee");
  assert(food.every((id) => g.STOP_BY_ID[id].costBand === "cheap"), "taste: " + d.pools.taste);
});

check("catalog: city park sources say the city lists the hours", () => {
  startPlay({ date: "2026-10-13", must: "" });
  assert(/The city's parks page lists/.test(g.stopView("north-straub-park").why), g.stopView("north-straub-park").why);
  assert(/Its own site lists .* on Tuesday\./.test(g.stopView("tombolo-books").why), g.stopView("tombolo-books").why);
});

check("catalog: at least 35 places, each with a source and hours", () => {
  const places = g.STOPS.filter((s) => !s.parking);
  assert(places.length >= 35, "only " + places.length + " places");
  const d = g.parseDate("2026-10-10");
  for (const s of g.STOPS) {
    assert(/^https:\/\//.test(s.source || ""), s.id + " has no source URL");
    assert(typeof s.hours === "function" && typeof s.isOpen === "function", s.id + " has no hours");
    const days = [0, 1, 2, 3, 4, 5, 6].map((k) => { const x = new Date(2026, 9, 11 + k); return s.isOpen(x, g.isoDate(x)) ? s.hours(x, g.isoDate(x)) : ""; });
    if (!s.dated) assert(days.some(Boolean), s.id + " is never open in a normal week");
  }
  for (const e of ADDED) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(e.hoursChecked || ""), e.id + " has no hoursChecked date");
    for (let k = 0; k < 7; k++) {
      const w = e.week[String(k)];
      assert(w === null || (Array.isArray(w) && w.length === 2 && w[0] < w[1] && w[0] >= 0 && w[1] <= 28), e.id + " bad hours on day " + k);
    }
  }
});

check("catalog: the new places cover drift, cheap meals, coffee and dessert, kids, and rainy days", () => {
  const added = ADDED;
  const count = (f) => added.filter(f).length;
  assert(count((e) => e.feel === "drift") >= 3, "drift places added");
  assert(count((e) => (e.meal === "lunch" || e.meal === "dinner") && (e.costBand === "cheap" || e.costBand === "mid")) >= 4, "$ or $$ meals added");
  assert(count((e) => e.meal === "coffee") >= 1 && count((e) => e.meal === "dessert") >= 1, "coffee and dessert stops added");
  assert(count((e) => e.kids) >= 5, "kid-friendly places added");
  assert(count((e) => e.tags.includes("indoor") && !e.outdoor) >= 5, "indoor places added");
  for (const e of added) assert(e.address && e.query, e.id + " has no address or maps query");
});

check("catalog: ids are unique, no bars or breweries added, every feel and meal is valid", () => {
  const ids = g.STOPS.map((s) => s.id);
  assert(new Set(ids).size === ids.length, "duplicate ids");
  for (const e of ADDED) {
    assert(!e.bar && !/\b(?:bar|brewery|brewing|taproom|pub)\b/i.test(e.name), e.id + " looks like a bar");
    assert(["taste", "drift", "dig", "soft"].includes(e.feel), e.id + " feel " + e.feel);
    assert(!e.meal || ["coffee", "lunch", "dinner", "dessert", "snack"].includes(e.meal), e.id + " meal " + e.meal);
    assert(!e.meal || ["cheap", "mid", "nice"].includes(e.costBand), e.id + " food without a price band");
  }
});

check("catalog: a small budget still has real food choices, and Shuffle shows up on a plain weekday", () => {
  const cheap = g.STOPS.filter((s) => s.meal && s.meal !== "coffee" && s.costBand === "cheap" && s.isOpen(g.parseDate("2026-10-13"), "2026-10-13"));
  assert(cheap.length >= 4, "cheap food open on a Tuesday: " + cheap.map((s) => s.id));
  const deck = deckOf({ date: "2026-10-13", must: "" });
  const multi = Object.values(deck.pools).filter((l) => l.length > 1).length;
  assert(multi >= 3, "feelings with more than one option: " + JSON.stringify(deck.pools));
  assert(deck.pools.drift.length >= 2, "drift: " + deck.pools.drift);
});

// --- #29: last entry and closing buffer ---

function dayWith(date, pools, anchor) {
  return startPlay({ date, deck: { v: 1, anchor: anchor || { type: "none" }, pools: Object.assign({ taste: [], drift: [], dig: [], soft: [] }, pools), park: false } });
}
const at = (iso, t) => { g.clockOverride = new Date(iso + "T" + t + ":00-04:00"); };

check("closing: last entries come from each place's own page", () => {
  const sat = g.parseDate("2026-10-10"), tue = g.parseDate("2026-10-13");
  const sg = g.STOP_BY_ID["sunken-gardens"], james = g.STOP_BY_ID["james-museum"], rama = g.STOP_BY_ID["floridarama"];
  assert(g.lastEntryOn(sg, sat, "2026-10-10") === 16 && /last admission is sold at 4 p\.m\. daily/i.test(sg.hoursText), "Sunken Gardens");
  assert(g.lastEntryOn(james, sat, "2026-10-10") === 16.5 && g.lastEntryOn(james, tue, "2026-10-13") === 19.5, "James");
  assert(/Last admission ticket sold at 4:30 PM Wednesday-Monday and 7:30 PM on Tuesday/.test(james.hoursText), "James quote");
  assert(g.lastEntryOn(rama, sat, "2026-10-10") === 18.5 && /Last entry occurs 1\.5 hours prior to closing/.test(rama.lastEntryText), "FloridaRAMA");
  for (const s of g.STOPS) {
    if (s.lastEntry == null) continue;
    assert(/last (admission|entry|ticket|seating)|prior to closing/i.test(s.lastEntryText || s.hoursText || ""), s.id + " has no quote");
    for (let i = 0; i < 14; i++) {
      const iso = g.addDays("2026-10-10", i), d = g.parseDate(iso);
      if (!s.isOpen(d, iso) || s.lastEntry == null) continue;
      const last = g.lastEntryOn(s, d, iso);
      assert(last != null && last > s.start(d, iso) && last < s.end(d, iso), s.id + " last entry " + last + " on " + iso);
    }
  }
});

check("closing: a museum near its last entry", () => {
  dayWith("2026-10-10", { drift: ["sunken-gardens"], soft: ["james-museum"] });
  at("2026-10-10", "15:30");
  g.act("begin");
  assert(g.offered("drift").includes("sunken-gardens"), "Sunken Gardens at 3:30");
  g.act("feel", "drift"); g.act("reveal");
  assert(g.view.pending === "sunken-gardens" && /Last entry 4pm, go soon\./.test(playText()), playText().slice(0, 300));
  at("2026-10-10", "15:50");
  assert(!g.offered("drift").includes("sunken-gardens"), "Sunken Gardens offered at 3:50 (last entry 4)");
  g.act("back");
  assert(!/Drift around/.test(playText()), "Drift still on offer");
  g.act("list");
  assert(/Not right now/.test(playText()) && /Last entry 4pm\. Not much time left\./.test(playText()), "list before the last entry");
  at("2026-10-10", "16:05");
  g.act("back");
  g.act("list");
  assert(/Last entry 4pm\. Too late now\./.test(playText()), "list after the last entry");
  at("2026-10-10", "16:10");
  assert(g.offered("soft").includes("james-museum") && /go soon/.test(g.closingLine(g.stopView("james-museum"))), "James at 4:10");
  at("2026-10-10", "16:20");
  assert(!g.offered("soft").includes("james-museum"), "James at 4:20 (last entry 4:30)");
  dayWith("2026-10-13", { soft: ["james-museum", "chihuly-collection"] });
  at("2026-10-13", "19:10");
  assert(g.offered("soft").includes("james-museum"), "James Tuesday 7:10");
  at("2026-10-13", "19:20");
  assert(!g.offered("soft").includes("james-museum"), "James Tuesday 7:20");
  at("2026-10-13", "15:40");
  assert(g.offered("soft").includes("chihuly-collection") && g.closingLine(g.stopView("chihuly-collection")) === "Closes at 5pm, go soon.", "Chihuly 3:40 " + g.closingLine(g.stopView("chihuly-collection")));
  at("2026-10-13", "15:50");
  assert(!g.offered("soft").includes("chihuly-collection"), "Chihuly 3:50: under an hour after the walk");
  g.clockOverride = PINNED;
});

check("closing: a restaurant near close, and the dinner it picked", () => {
  dayWith("2026-10-10", { taste: ["la-v-vietnamese"] });
  at("2026-10-10", "20:45");
  g.act("begin"); g.act("feel", "taste"); g.act("reveal");
  assert(g.view.pending === "la-v-vietnamese" && /Closes at 10pm, go soon\./.test(playText()), playText().slice(0, 300));
  at("2026-10-10", "21:05");
  assert(!g.offered("taste").includes("la-v-vietnamese"), "La V at 9:05");
  dayWith("2026-10-13", { drift: ["north-straub-park"] }, { type: "stop", id: "bellabrava", time: 18, leave: 17.5 });
  at("2026-10-13", "20:55");
  g.act("begin");
  assert(/Real dinner/.test(playText()), "dinner still on at 8:55");
  at("2026-10-13", "21:05");
  g.act("back");
  assert(!/Real dinner/.test(playText()) && /Too late for the dinner spot now\./.test(playText()) && !/Dinner: done/.test(playText()), playText().slice(0, 300));
  g.act("feel", "anchor");
  assert(g.view.panel === "feel", "dinner revealed after its cutoff");
  g.act("cool");
  assert(/Too late for the dinner spot now\./.test(playText()) && !/Dinner's done/.test(playText()), "cool");
  g.clockOverride = PINNED;
});

check("closing: a coffee shop near close", () => {
  dayWith("2026-10-10", { taste: ["bandit-coffee"] });
  at("2026-10-10", "14:15");
  g.act("begin"); g.act("feel", "taste"); g.act("reveal");
  assert(g.view.pending === "bandit-coffee" && /Closes at 3pm, go soon\./.test(playText()), playText().slice(0, 300));
  at("2026-10-10", "14:30");
  assert(!g.offered("taste").includes("bandit-coffee"), "Bandit at 2:30");
  g.clockOverride = PINNED;
  // Not revealed inside the buffer either: picked at 2:15pm, revealed or reloaded at 2:30pm.
  dayWith("2026-10-10", { taste: ["bandit-coffee"] });
  at("2026-10-10", "14:15"); g.act("begin"); g.act("feel", "taste");
  at("2026-10-10", "14:30"); g.act("reveal");
  assert(g.view.panel === "feel" && !g.view.pending, "revealed inside the coffee buffer: " + g.view.panel);
  dayWith("2026-10-10", { taste: ["bandit-coffee"] });
  at("2026-10-10", "14:15"); g.act("begin"); g.act("feel", "taste");
  at("2026-10-10", "14:30");
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  assert(g.view.panel === "feel" && !g.view.pending, "a held commit screen survived the buffer: " + g.view.panel);
  g.clockOverride = PINNED;
});

check("closing: a revealed card survives a reload on the way, until the place closes", () => {
  dayWith("2026-10-10", { taste: ["bandit-coffee"] });
  at("2026-10-10", "14:20");
  g.act("begin"); g.act("feel", "taste"); g.act("reveal");
  at("2026-10-10", "14:35");
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  assert(g.view.panel === "reveal" && g.view.pending === "bandit-coffee" && /Closes at 3pm\. Not much time left\./.test(playText()) && !/Too late/.test(playText()), "lost on the way: " + g.view.panel);
  at("2026-10-10", "15:05");
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  assert(g.view.panel === "feel", "kept after close");
  g.clockOverride = PINNED;
});

check("closing: Plan B uses the same cutoffs", () => {
  dayWith("2026-10-10", { soft: ["james-museum", "chihuly-collection"] });
  wet("2026-10-10");
  at("2026-10-10", "16:10");
  g.act("begin"); g.act("iffy");
  assert(/James Museum/.test(playText()) && /Last entry 4:30pm, go soon/.test(playText()) && !/Chihuly/.test(playText()), playText().slice(0, 400));
  g.clockOverride = PINNED;
});

check("closing: copy never says a place is open later than its hours", () => {
  const ids = g.STOPS.filter((s) => s.feel || s.dinner).map((s) => s.id);
  for (let i = 0; i < 7; i++) {
    const iso = g.addDays("2026-10-10", i), d = g.parseDate(iso);
    dayWith(iso, {});
    for (const id of ids) {
      const s = g.STOP_BY_ID[id];
      if (!s.isOpen(d, iso)) continue;
      const v = g.stopView(id);
      for (let t = 7; t < 24; t += 0.25) {
        g.clockOverride = new Date(iso + "T" + String(Math.floor(t)).padStart(2, "0") + ":" + String((t % 1) * 60).padStart(2, "0") + ":00-04:00");
        const line = g.closingLine(v);
        if (!line) continue;
        const m = /^(Closes at|Last entry) ([^,.]+)/.exec(line);
        assert(m, id + " " + line);
        const h = g.cityNow().hour;
        if (m[1] === "Closes at") assert(m[2] === g.fmtHour(v.gap && h < v.gap[0] ? v.gap[0] : v.end), id + " " + iso + " " + line);
        else assert(v.last != null && m[2] === g.fmtHour(v.last) && v.last < v.end, id + " " + line);
        // "Too late now" only once the place's own last entry has passed.
        if (/Too late now/.test(line)) assert(v.last != null && h >= v.last, id + " " + iso + " " + line);
        assert(v.hours.includes(m[1] === "Closes at" ? m[2] : g.fmtHour(v.end)), id + " hours " + v.hours + " vs " + line);
      }
    }
  }
  g.clockOverride = PINNED;
});

check("closing: a lunch break isn't a closing, and a picked dinner there stays on", () => {
  // Pin Wok & Bowl: 11:30am-3pm and 4pm-9pm on Tuesdays.
  dayWith("2026-10-13", { taste: ["la-v-vietnamese", "pin-wok-bowl"] }, { type: "stop", id: "pin-wok-bowl", time: 18, leave: 17.5 });
  at("2026-10-13", "13:45");
  assert(g.closingLine(g.stopView("pin-wok-bowl")) === "Closes at 3pm, go soon.", g.closingLine(g.stopView("pin-wok-bowl")));
  at("2026-10-13", "14:40");
  assert(g.closingLine(g.stopView("pin-wok-bowl")) === "Closes at 3pm. Back at 4pm.", g.closingLine(g.stopView("pin-wok-bowl")));
  g.act("begin");
  assert(g.anchorOffered() && /Real dinner/.test(playText()), "dinner offered at 2:40pm");
  assert(!/Too late for the dinner spot/.test(playText()) && !/How did it go/.test(playText()), "dinner called too late at lunch");
  assert(g.closingLine(g.anchorView()) === "", "the dinner card mentions the lunch break");
  g.act("list");
  assert(/Closes at 3pm\. Back at 4pm\./.test(playText()), "list in the break");
  // A card revealed in the break, an hour before it reopens, survives a reload.
  dayWith("2026-10-13", { taste: ["pin-wok-bowl"] });
  at("2026-10-13", "15:10");
  g.act("begin"); g.act("feel", "taste"); g.act("reveal");
  assert(g.view.pending === "pin-wok-bowl", "revealed in the break");
  at("2026-10-13", "15:30");
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  assert(g.view.panel === "reveal" && g.view.pending === "pin-wok-bowl", "lost on reload: " + g.view.panel);
  g.clockOverride = PINNED;
});

check("closing: a revealed dinner survives a reload until the restaurant closes", () => {
  dayWith("2026-10-13", { taste: [] }, { type: "stop", id: "bellabrava", time: 18, leave: 17.5 });
  const end = g.anchorView().end;
  at("2026-10-13", "19:00");
  g.act("begin"); g.act("feel", "anchor"); g.act("reveal");
  assert(g.view.pending === "anchor", "dinner revealed: " + g.view.pending);
  g.clockOverride = new Date(new Date("2026-10-13T00:00:00-04:00").getTime() + (end - 0.25) * 3600000);
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  assert(g.view.panel === "reveal" && g.view.pending === "anchor", "lost before close: " + g.view.panel);
  g.clockOverride = new Date(new Date("2026-10-13T00:00:00-04:00").getTime() + (end + 0.25) * 3600000);
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  assert(g.view.panel !== "reveal", "kept after the restaurant closed");
  g.clockOverride = PINNED;
});

check("closing: the default buffers by type, and a dinner that's done or closed that day", () => {
  // Shops, parks and galleries: 30 minutes from arrival. Tombolo closes 5:30pm on Saturdays.
  dayWith("2026-10-10", { dig: ["tombolo-books"] });
  at("2026-10-10", "16:40");
  assert(g.offered("dig").includes("tombolo-books"), "Tombolo at 4:40pm");
  at("2026-10-10", "16:50");
  assert(!g.offered("dig").includes("tombolo-books"), "Tombolo at 4:50pm");
  // A small fee counts as an attraction: 60 minutes. Shuffleboard closes 10pm on Fridays.
  dayWith("2026-10-16", { drift: ["st-pete-shuffleboard-club"] });
  at("2026-10-16", "20:40");
  assert(g.offered("drift").includes("st-pete-shuffleboard-club"), "Shuffleboard at 8:40pm");
  at("2026-10-16", "20:50");
  assert(!g.offered("drift").includes("st-pete-shuffleboard-club"), "Shuffleboard at 8:50pm");
  // Dinner they already had reads done, not too late.
  dayWith("2026-10-13", { taste: [] }, { type: "stop", id: "bellabrava", time: 18, leave: 17.5 });
  at("2026-10-13", "18:30");
  g.act("begin"); g.act("feel", "anchor"); g.act("reveal"); g.act("here", "bellabrava");
  at("2026-10-13", "23:00");
  g.act("back");
  assert(/Dinner: done\./.test(playText()) && !/Too late for the dinner spot/.test(playText()), "dinner done: " + playText().slice(0, 200));
  // A frozen dinner that's closed that day says so instead of "too late". Pin Wok is closed Mondays.
  dayWith("2026-10-12", { drift: ["north-straub-park"] }, { type: "stop", id: "pin-wok-bowl", time: 18, leave: 17.5 });
  at("2026-10-12", "10:00");
  g.act("begin");
  assert(/The dinner spot is closed today\./.test(playText()) && !/Too late for the dinner spot/.test(playText()), "closed dinner: " + playText().slice(0, 200));
  g.clockOverride = PINNED;
});

check("hours: after midnight still belongs to the night before", () => {
  const id = "qa-late-night";
  const base = {
    id: id,
    name: "Friday Late Window",
    feel: "taste",
    meal: "snack",
    costBand: "cheap",
    tags: ["late night"],
    address: "1 Central Ave, St. Petersburg, FL",
    query: "1 Central Ave, St. Petersburg, FL",
    source: "https://example.invalid/not-a-place",
    week: { 0: null, 1: null, 2: null, 3: null, 4: null, 5: [17, 25], 6: [11, 22] },
    hoursText: "Fri 5pm–1am",
    hoursChecked: "2026-10-09",
    hint: "Test stand-in. Not a real place.",
    why: "Listed open Friday 5pm to 1am."
  };
  function bind(closedDates) {
    const stop = g.weekStop(Object.assign({}, base, { closedDates: closedDates }), g.CITIES.stpete);
    const atStop = g.STOPS.findIndex((s) => s.id === id);
    if (atStop >= 0) g.STOPS[atStop] = stop;
    else g.STOPS.push(stop);
    g.STOP_BY_ID[id] = stop;
    return stop;
  }
  function nightOpen() {
    const v = g.stopView(id);
    const h = g.viewHour(v);
    return h != null && v.end > h && v.end > 24 && h >= v.start;
  }
  const fri = "2026-10-09", sat = "2026-10-10";
  try {
    const stop = bind([]);
    assert(stop.hours(g.parseDate(fri)) === "5pm–1am", stop.hours(g.parseDate(fri)));

    dayWith(fri, { taste: [id, "la-v-vietnamese"] });
    at(fri, "23:30");
    assert(nightOpen(), "Fri 11:30pm should be inside Fri 5pm–1am");
    assert(g.offered("taste").includes(id), "not offered Fri 11:30pm");
    g.act("begin"); g.act("feel", "taste"); g.act("reveal");
    assert(g.view.pending === id && /open until 1am/i.test(playText()), playText().slice(0, 500));

    at(sat, "00:30");
    const late = g.stopView(id);
    assert(nightOpen() && late.hours === "5pm–1am" && late.end === 25, "Sat 12:30am used Saturday hours: " + late.hours + " end " + late.end);
    assert(/open until 1am/i.test(g.untilLine(late)), g.untilLine(late) || "(no until line)");
    assert(!g.openNow(g.stopView("la-v-vietnamese"), "held"), "a 10pm close stayed open at 12:30am");
    g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
    assert(g.view.panel === "reveal" && g.view.pending === id, "held card dropped at 12:30am: " + g.view.panel);

    at(sat, "01:15");
    assert(!nightOpen(), "Sat 1:15am still counted as open");
    g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
    assert(g.view.panel !== "reveal", "kept the card after 1am");

    // A Saturday holiday closes Saturday, not Friday night's tail.
    bind(["2026-10-10"]);
    dayWith(fri, { taste: [id] });
    at(fri, "23:30");
    assert(nightOpen(), "Friday night closed because Saturday is the holiday");
    at(sat, "00:30");
    assert(nightOpen() && g.stopView(id).end === 25, "Saturday holiday ate Friday's 12:30am tail");
    dayWith(sat, { taste: [id] });
    at(sat, "00:30");
    assert(nightOpen() && g.stopView(id).hours === "5pm–1am", "Saturday 12:30am read as Saturday's 11am open");
    at(sat, "11:30");
    assert(!nightOpen() && g.stopView(id).end === 0, "Saturday holiday daytime still offered");

    // A Friday holiday closes Friday night, including the hours after midnight.
    bind(["2026-10-09"]);
    dayWith(fri, { taste: [id] });
    at(fri, "23:30");
    assert(!nightOpen() && !g.offered("taste").includes(id), "Friday holiday still offered at 11:30pm");
    at(sat, "00:30");
    assert(!nightOpen(), "Friday holiday reopened at Sat 12:30am");

    // Joey's own Sunday hours are 11am–1am. The same rule, on a real place.
    dayWith("2026-10-11", { taste: ["joey-brooklyns-pizza"] });
    at("2026-10-11", "23:30");
    g.act("begin"); g.act("feel", "taste"); g.act("reveal");
    assert(/open until 1am/i.test(playText()), playText().slice(0, 500));
    at("2026-10-12", "00:30");
    const joey = g.stopView("joey-brooklyns-pizza");
    assert(g.viewHour(joey) < joey.end && /open until 1am/i.test(g.untilLine(joey)), g.untilLine(joey) + " end " + joey.end);
    at("2026-10-12", "01:15");
    const closed = g.stopView("joey-brooklyns-pizza");
    assert(!(g.viewHour(closed) < closed.end), "Joey still open Monday 1:15am");
  } finally {
    const atStop = g.STOPS.findIndex((s) => s.id === id);
    if (atStop >= 0) g.STOPS.splice(atStop, 1);
    delete g.STOP_BY_ID[id];
    g.clockOverride = PINNED;
  }
});

check("closing: old #play/ links still play on the day", () => {
  OLD_LINKS.forEach((link) => {
    resetPhone();
    sunny("2026-10-10");
    at("2026-10-10", "15:30");
    openLink(link.hash);
    g.act("begin");
    const feel = ["taste", "drift", "dig", "soft"].find((f) => g.offered(f).length);
    assert(feel, link.built + ": nothing on offer at 3:30");
    g.act("feel", feel); g.act("reveal");
    const id = g.view.pending;
    assert(id && g.STOP_BY_ID[id], link.built + ": nothing revealed");
    g.act("here", id);
    assert(g.playState().trail.length === 1, link.built + ": We're here");
  });
  g.clockOverride = PINNED;
});

// --- #31: food stops leave room to choose ---

check("food: every food place has a menu focus from its own menu", () => {
  const food = g.STOPS.filter((s) => s.meal);
  assert(food.length >= 16, "food places: " + food.length);
  for (const s of food) {
    assert(["seafood-centric", "mixed"].includes(s.menuFocus), s.id + " menuFocus " + s.menuFocus);
    assert(/^https:\/\//.test(s.menuSource || "") && /^2026-\d\d-\d\d$/.test(s.menuChecked || ""), s.id + " menu source or date");
  }
});

function deckPlaceIds(deck) {
  const ids = allIds(deck);
  if (deck.anchor && deck.anchor.type === "stop") ids.push(deck.anchor.id, ...(deck.anchor.alts || []));
  return ids;
}

check("food: 'no seafood', 'no fish' and shellfish allergies keep a seafood-centric place off but allow mixed menus", () => {
  const pc = g.STOP_BY_ID["pacific-counter-downtown"];
  assert(pc.menuFocus === "seafood-centric" && pc.menuSource === "https://pacificcounter.com/build-your-own/", "Pacific Counter menu focus");
  for (const must of ["no seafood, dinner", "dinner, no fish", "dinner, allergic to shellfish", "Allergies: shellfish. Dinner somewhere nice."]) {
    assert(keepsSeafoodCentricOff(must), must);
    const p = makePlan({ must });
    assert(g.avoidsStop(p, pc), must + " left Pacific Counter on");
    for (const id of ["stillwaters", "perrys-porch", "pin-wok-bowl"]) assert(!g.avoidsStop(p, g.STOP_BY_ID[id]), must + " vetoed the mixed menu at " + id);
  }
  // Real catalog, including Shuffle alternates. The reported day is easy, $40, Tuesday 2026-10-13.
  for (const must of ["no seafood. lunch and dinner", "no fish. lunch and dinner", "allergic to shellfish. lunch and dinner"]) {
    const deck = deckOf({ must, kind: "easy", budgetAmount: "40", date: "2026-10-13" });
    const ids = deckPlaceIds(deck);
    assert(!ids.includes("pacific-counter-downtown"), must + " offered Pacific Counter in " + ids.join(","));
    const p = makePlan({ must, kind: "easy", budgetAmount: "40", date: "2026-10-13" });
    for (const id of ["stillwaters", "perrys-porch", "pin-wok-bowl"]) assert(!g.avoidsStop(p, g.STOP_BY_ID[id]), must + " vetoed the mixed menu at " + id);
  }
  assert(deckOf({ date: "2026-10-13", must: "dinner, no seafood, thai please", budgetAmount: "100" }).anchor.id === "pin-wok-bowl", "a mixed sushi-and-Thai place can still be dinner");
});

check("food: naming an allergen doesn't count as asking for it", () => {
  for (const must of ["she has a seafood allergy. dinner", "Allergies: shellfish, seafood. Dinner", "seafood allergy, pasta"]) {
    const text = g.positiveText(makePlan({ must }));
    assert(!/seafood|shellfish/.test(text), must + " -> " + text);
    const s = g.STOP_BY_ID["stillwaters"];
    assert(g.tagScore(s, text) === g.tagScore(s, g.positiveText(makePlan({ must: must.replace(/[a-z]*\s*(seafood|shellfish)[a-z,]*/g, "") })) ), must);
  }
  assert(/tacos/.test(g.positiveText(makePlan({ must: "He doesn't eat seafood so let's do tacos" }))), "a wish after the no stays");
});

function fillEasyDay(note) {
  resetPhone();
  g.clockOverride = PINNED;
  g.setMode("create");
  g.plan = null;
  g.fillForm(null);
  $("you").value = "Alex";
  $("them").value = "Riley";
  g.applyPills({ occasion: "Date", drink: "no", lean: "must" });
  g.renderKinds("Date", "easy");
  $("budget-amount").value = "120";
  $("date").value = "2026-10-10";
  $("must").value = note;
}

check("food: checking the allergy box puts the flag in the link and the line on every food card", () => {
  const notes = ["she's allergic to shellfish, coffee", "nut allergy, coffee", "Allergies: shellfish. coffee", "he's celiac, coffee", "allergen: peanuts, coffee", "no seafood, coffee"];
  for (const must of notes) assert(!("allergy" in deckOf({ must })), "the note still guessed an allergy: " + must);
  fillEasyDay("she's allergic to shellfish. coffee and art");
  assert($("food-allergy").checked === false, "checkbox should start unchecked");
  assert(g.submitForm() === true, "unchecked form");
  assert(g.plan.allergy !== true && !("allergy" in g.plan.deck), "unchecked day still flagged the link");
  click($("edit"));
  assert($("food-allergy").checked === false, "Change the day should keep the box unchecked");
  $("food-allergy").checked = true;
  assert(g.submitForm() === true, "checked form");
  assert(g.plan.allergy === true && g.plan.deck.allergy === true, "checkbox did not flag the day");
  const carried = g.linkPlan(g.plan);
  assert(carried.deck.allergy === true && !("must" in carried) && !("allergy" in carried), "the link should carry the yes/no on the deck only");
  const linked = g.decodePlan(g.encodePlan(carried));
  assert(linked.deck.allergy === true && !/shellfish/.test(JSON.stringify(linked)), "the link carried the note");
  // Play that link: every food card has one line, and a museum card has none.
  resetPhone();
  sunny("2026-10-10");
  at("2026-10-10", "12:00");
  openLink("#play/" + g.encodePlan(carried));
  g.act("begin");
  g.act("list");
  const cards = [...$("play").querySelectorAll("article.stop")];
  let food = 0;
  cards.forEach((card) => {
    const name = card.querySelector("h2").textContent;
    const stop = g.STOPS.find((s) => s.name === name);
    assert(stop, "unknown card " + name);
    if (!(stop.feel === "taste" || stop.dinner)) {
      assert(!/allerg/i.test(card.textContent), name + " is not a food card");
      return;
    }
    food++;
    const line = stop.meal ? "Check the menu for allergies." : "Ask about allergies before you order.";
    assert(card.textContent.includes(line), name + " missing the allergy line");
    assert(!/allergy-safe|safe for allerg/i.test(card.textContent), name + " claims to be safe");
  });
  assert(food >= 2, "expected several food cards, saw " + food);
  const page = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert(!/allerg\w*[- ](?:safe|friendly)|safe for (?:allerg|celiac)|nut[- ]free (?:kitchen|facility)/i.test(page), "something claims to be allergy-safe");
  g.clockOverride = PINNED;
});

check("food: an old link without the allergy flag still plays, with no allergy line", () => {
  const p = makePlan({ must: "she's allergic to shellfish. coffee, art", date: "2026-10-10" });
  p.deck = { v: 1, anchor: { type: "stop", id: "bellabrava", time: 18, leave: 17.5 }, pools: { taste: ["kahwa", "market"], drift: [], dig: [], soft: ["mfa"] }, park: false };
  resetPhone();
  sunny(p.date);
  at(p.date, "15:30");
  openLink("#play/" + g.encodePlan(g.linkPlan(p)));
  assert(!("allergy" in g.ensureDeck(g.plan)), "old link grew an allergy flag");
  g.act("begin");
  const feel = ["taste", "drift", "dig", "soft"].find((f) => g.offered(f).length);
  g.act("feel", feel);
  g.act("reveal");
  const id = g.view.pending;
  assert(id && g.STOP_BY_ID[id], "nothing revealed");
  assert(!/allerg/i.test(playText()), "allergy line on an old link");
  g.act("here", id);
  assert(g.playState().trail.length === 1, "We're here");
  g.clockOverride = PINNED;
});

check("food: at a food stop, Shuffle shows when another place fits, and a plain line when none does", () => {
  const briefs = [
    { must: "cheap eats, coffee", budgetAmount: "40" },
    { must: "coffee, gelato, walking", budgetAmount: "120" },
    { must: "brunch, pastries, art", budgetAmount: "300", kind: "celebrate" },
  ];
  let shown = 0;
  for (const b of briefs) {
    for (const t of ["10:00", "13:00"]) {
      const p = startPlay(Object.assign({ date: "2026-10-10" }, b));
      at("2026-10-10", t);
      const n = g.offered("taste").length;
      g.act("begin");
      if (!n) continue;
      g.act("feel", "taste");
      const btn = $("play").querySelector('[data-act="shuffle"]');
      if (n > 1) { assert(btn, JSON.stringify(b) + " " + t + ": no Shuffle with " + n + " options"); shown++; }
      else assert(!btn && /nothing to shuffle/.test(playText()), JSON.stringify(b) + " " + t + ": no plain line");
    }
  }
  assert(shown >= 4, "Shuffle shown on " + shown + " food stops");
  dayWith("2026-10-10", { taste: ["kahwa"] });
  at("2026-10-10", "10:00");
  g.act("begin"); g.act("feel", "taste");
  assert(!$("play").querySelector('[data-act="shuffle"]') && /Only one tasty stop fits right now, so there's nothing to shuffle\./.test(playText()), "one tasty place");
  g.clockOverride = PINNED;
});

check("food: the dinner the page picks comes with up to two alternates, never one of the day's picks", () => {
  let withAlts = 0;
  for (const b of [{ must: "dinner somewhere nice", kind: "celebrate", budgetAmount: "300" }, { must: "dinner, art", budgetAmount: "120" },
    { must: "pho for lunch, dinner later", budgetAmount: "120", date: "2026-10-13" }, { must: "cheap eats, dinner", budgetAmount: "40" }]) {
    const deck = deckOf(b);
    if (deck.anchor.type !== "stop") continue;
    const alts = deck.anchor.alts || [];
    if (alts.length) withAlts++;
    assert(alts.length <= 2 && !alts.includes(deck.anchor.id), JSON.stringify(deck.anchor));
    for (const id of alts) {
      assert(g.STOP_BY_ID[id].dinner && !allIds(deck).includes(id), id + " in the pools or not a dinner");
      const rank = { cheap: 0, mid: 1, nice: 2 }, step = rank[g.STOP_BY_ID[deck.anchor.id].costBand] - rank[g.STOP_BY_ID[id].costBand];
      assert(step === 0 || step === 1, id + " isn't the same band or one down from " + deck.anchor.id);
    }
    // The link keeps them exactly.
    const back = g.decodePlan(g.encodePlan(g.linkPlan(Object.assign(makePlan(b), { deck }))));
    assert(JSON.stringify(back.deck) === JSON.stringify(deck), "round trip");
  }
  assert(withAlts >= 2, "alternates on " + withAlts + " briefs");
  // A celebration's one nice dinner can swap to a mid one, never down to a cheap one.
  const celebrate = deckOf({ must: "dinner somewhere nice", kind: "celebrate", budgetAmount: "300" }).anchor;
  assert(celebrate.id === "bellabrava" && (celebrate.alts || []).length && celebrate.alts.every((id) => g.STOP_BY_ID[id].costBand === "mid"), JSON.stringify(celebrate));
  // cleanDeck drops anything that isn't a fitting dinner outside the pools.
  const raw = { v: 1, anchor: { type: "stop", id: "bellabrava", time: 18, leave: 17.5, alts: ["bellabrava", "nope", "mfa", "kahwa", "stillwaters", "stillwaters", "baba-on-central", "la-v-vietnamese"] },
    pools: { taste: ["kahwa", "stillwaters"], drift: [], dig: [], soft: [] }, park: false };
  assert(JSON.stringify(g.cleanDeck(raw, "stpete").anchor.alts) === JSON.stringify(["baba-on-central", "la-v-vietnamese"]), JSON.stringify(g.cleanDeck(raw, "stpete").anchor));
});

check("food: on the day, Shuffle swaps the dinner and the choice survives a reload", () => {
  dayWith("2026-10-13", { taste: [] }, { type: "stop", id: "bellabrava", time: 18, leave: 17.5, alts: ["stillwaters", "baba-on-central"] });
  at("2026-10-13", "17:00");
  g.act("begin"); g.act("feel", "anchor");
  assert(/Shuffle another dinner/.test(playText()), "no dinner Shuffle");
  const first = g.anchorView().id;
  g.act("shuffle");
  const second = g.anchorView().id;
  assert(first === "bellabrava" && ["stillwaters", "baba-on-central"].includes(second), first + " -> " + second);
  g.act("reveal");
  assert(new RegExp(g.STOP_BY_ID[second].name).test(playText()), "reveal shows the shuffled dinner");
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  assert(g.anchorView().id === second && g.view.pending === "anchor", "lost the shuffled dinner on reload");
  g.act("here", second);
  assert(g.anchorDone() && g.visitedIds().includes(second), "We're here logged " + g.visitedIds());
  // Too late for an alternate: it isn't swapped in. On Tuesdays Pin Wok closes at 9pm, Stillwaters at 10pm.
  dayWith("2026-10-13", { taste: [] }, { type: "stop", id: "stillwaters", time: 18, leave: 17.5, alts: ["pin-wok-bowl"] });
  at("2026-10-13", "17:00");
  g.act("begin"); g.act("feel", "anchor");
  assert(/Shuffle another dinner/.test(playText()), "Pin Wok offered at 5pm");
  at("2026-10-13", "20:30");
  assert(!g.anchorLate(), "Stillwaters still fits at 8:30pm");
  g.act("back"); g.act("feel", "anchor");
  assert(!/Shuffle another dinner/.test(playText()) && /No other dinner fits right now/.test(playText()), "late alternate offered at 8:30pm");
  // An old link without alternates: no Shuffle, one plain line.
  dayWith("2026-10-13", { taste: [] }, { type: "stop", id: "bellabrava", time: 18, leave: 17.5 });
  at("2026-10-13", "17:00");
  g.act("begin"); g.act("feel", "anchor");
  assert(!/Shuffle another dinner/.test(playText()) && /Only one dinner was lined up for today, so there's nothing to shuffle\./.test(playText()), "old link");
  g.clockOverride = PINNED;
});

check("food: the desk names the dinner alternates, and Surprise us too hides them", () => {
  const p = creatorDesk({ must: "dinner, art", budgetAmount: "120" });
  const alts = g.ensureDeck(p).anchor.alts || [];
  assert(alts.length, "no alternates to show");
  for (const id of alts) assert(new RegExp("On the day, Shuffle can swap in " + g.STOP_BY_ID[id].name).test($("desk-top").textContent), id);
  p.surprise = true;
  g.renderDesk();
  assert(!/swap in/.test($("desk-top").textContent), "alternates shown under Surprise us too");
});

check("food: a 'no' or an allergy only drops what it names; the rest of the note still counts", () => {
  assert(g.noteWants(makePlan({ must: "no dairy but we love ice cream" })).dessert, "ice cream after 'no dairy'");
  assert(/ice cream/.test(g.positiveText(makePlan({ must: "no dairy but we love ice cream" }))), "ice cream dropped");
  assert(/seafood/.test(g.positiveText(makePlan({ must: "no sushi, but we love seafood" }))), "seafood after 'no sushi' dropped");
  assert(/tacos/.test(g.positiveText(makePlan({ must: "we want tacos with a seafood allergy" }))), "tacos dropped");
  assert(/sushi/.test(g.positiveText(makePlan({ must: "shellfish allergy but she loves sushi" }))), "sushi dropped");
  for (const must of ["no constructor", "avoid __proto__", "skip constructor, coffee"]) deckOf({ must });
});

check("food: a dinner that's too late hands over to an alternate that still fits", () => {
  // Tuesday: Pin Wok closes at 9pm, Stillwaters at 10pm.
  dayWith("2026-10-13", { taste: [] }, { type: "stop", id: "pin-wok-bowl", time: 18, leave: 17.5, alts: ["stillwaters"] });
  at("2026-10-13", "20:30");
  g.act("begin");
  assert(g.anchorOffered() && /Real dinner/.test(playText()) && !/Too late for the dinner spot/.test(playText()), "dinner hidden while an alternate fits");
  assert(g.anchorView().id === "stillwaters", "handed to " + g.anchorView().id);
  // Shuffled early to the place that closes first, then back later.
  dayWith("2026-10-13", { taste: [] }, { type: "stop", id: "stillwaters", time: 18, leave: 17.5, alts: ["pin-wok-bowl", "baba-on-central"] });
  g.playState().dinner = "pin-wok-bowl";
  at("2026-10-13", "20:30");
  g.act("begin");
  assert(g.anchorOffered() && g.anchorView().id !== "pin-wok-bowl", "stuck on the late pick: " + g.anchorView().id);
  // A dinner already revealed stays put after a reload, even once it's tight.
  dayWith("2026-10-13", { taste: [] }, { type: "stop", id: "pin-wok-bowl", time: 18, leave: 17.5, alts: ["stillwaters"] });
  at("2026-10-13", "20:00");
  g.act("begin"); g.act("feel", "anchor"); g.act("reveal");
  at("2026-10-13", "20:30");
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  assert(g.view.pending === "anchor" && g.anchorView().id === "pin-wok-bowl", "the revealed dinner changed: " + g.anchorView().id);
  // The creator's desk always shows the dinner the page picked.
  const p = g.plan;
  g.playState().dinner = "stillwaters";
  g.savePlay();
  g.openDay(p, { mode: "create" });
  assert(g.anchorView().id === "pin-wok-bowl", "desk shows " + g.anchorView().id);
  g.clockOverride = PINNED;
});


// --- #13: the places live in data/stops.json ---

// The same probes that captured qa-fixtures/before-the-catalog-move.json from 40a974a, the last
// commit where the places were code. Replaying them proves the move changed nothing.
function catalogProbes(g, makePlan, createHash) {
  const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

  const BRIEF_DATES = ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-13", "2026-10-17", "2026-10-22", "2026-10-24", "2026-11-26", "2026-12-24", "2027-03-06", "2027-03-28", "2027-07-04"];
  const BRIEF_NOTES = ["", "walking and coffee", "coffee, tacos, art, walking, music", "a nice dinner", "no seafood", "no museums", "art and glass", "drinks and beer", "we will drive, kids and a playground", "books and vintage shopping"];
  const OCCASIONS = ["Anniversary", "Date", "Birthday", "Just because"];

  function briefs() {
    const out = [];
    let n = 0;
    for (const date of BRIEF_DATES) for (const must of BRIEF_NOTES) for (const kind of ["away", "celebrate", "easy"]) {
      out.push({ date, must, kind, lean: n % 2 ? "gems" : "must", budgetAmount: ["", "40", "100", "200", "400"][n % 5], drink: n % 3 === 0 ? "yes" : "no", occasion: OCCASIONS[n % 4], rebuild: n % 3, allergy: n % 7 === 0 });
      n++;
    }
    return out;
  }

  const decks = () => briefs().map((b) => g.buildDeck(makePlan(b)));

  const DAYS = [];
  for (let t = Date.UTC(2026, 9, 1); t <= Date.UTC(2027, 11, 31); t += 86400000) DAYS.push(new Date(t).toISOString().slice(0, 10));
  const KEY_DAYS = ["2026-10-10", "2026-10-11", "2026-10-17", "2026-10-22", "2026-10-24", "2026-11-26", "2026-12-24", "2026-12-25", "2026-12-31", "2027-02-07", "2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11", "2027-02-12", "2027-02-13"];

  // What a place says on one date, or null when it is closed. The line is read as a date for two people.
  function read(s, iso) {
    const d = g.parseDate(iso);
    if (!s.isOpen(d, iso)) return null;
    const hours = s.hours(d, iso);
    const line = s.why({ iso, day: d.getDay(), when: g.formatWhen(d), hours, occ: "a date", on: "on " + d.toLocaleDateString("en-US", { weekday: "long" }) });
    return { hours, start: s.start(d, iso), end: s.end(d, iso), gap: s.gap ? s.gap(d) : null, last: g.lastEntryOn(s, d, iso), stay: g.stayFor(s), why: line };
  }

  function hours(ids) {
    const out = {};
    for (const id of ids) out[id] = Object.fromEntries(KEY_DAYS.map((iso) => [iso, read(g.STOP_BY_ID[id], iso)]));
    return out;
  }

  function hoursDigests() {
    return Object.fromEntries(g.STOPS.map((s) => [s.id, sha(DAYS.map((iso) => read(s, iso)))]));
  }

  return { briefs, decks, hours, hoursDigests, sha, KEY_DAYS };
}

const beforeMove = JSON.parse(fs.readFileSync(new URL("./qa-fixtures/before-the-catalog-move.json", import.meta.url), "utf8"));
const probes = catalogProbes(g, makePlan, createHash);

// A page that has finished asking for the places, however that went.
async function settled(options) {
  const page = makePage(options);
  await page.window.CATALOG_READY;
  return page;
}

// The schema's two extra rules, which patterns can't hold: a date has to be a real day, and a
// window's first hour has to come before its second. The page checks the same two things itself.
function catalogValidator() {
  const ajv = new Ajv2020({ allErrors: true });
  ajv.addKeyword({
    keyword: "calendarDate",
    type: "string",
    validate: (_on, text) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (!m) return false;
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
    }
  });
  ajv.addKeyword({
    keyword: "startBeforeEnd",
    type: ["array", "object"],
    validate: (_on, win) => {
      const [start, end] = Array.isArray(win) ? win : [win.start, win.end];
      return typeof start === "number" && typeof end === "number" && start < end;
    }
  });
  return ajv.compile(stopsSchema);
}

const offline = () => Promise.reject(new Error("offline"));
const replies = (res) => () => Promise.resolve(res);
const withBadStop = () => {
  const bad = JSON.parse(JSON.stringify(stopsFile));
  delete bad.stops[5].week;
  return { ok: true, status: 200, json: () => Promise.resolve(bad) };
};
const withEdit = (edit) => () => {
  const bad = JSON.parse(JSON.stringify(stopsFile));
  edit(bad.stops);
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(bad) });
};
const withTop = (edit) => () => {
  const bad = JSON.parse(JSON.stringify(stopsFile));
  edit(bad);
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(bad) });
};
const catalogDown = {
  "the request fails": offline,
  "the file is missing": replies({ ok: false, status: 404, json: () => Promise.resolve({}) }),
  "the file isn't JSON": replies({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("Unexpected token <")) }),
  "the file has no places": replies({ ok: true, status: 200, json: () => Promise.resolve({ city: "St. Petersburg", stops: [] }) }),
  "the file doesn't say which city it is": withTop((file) => { delete file.cityId; }),
  "the file has no time zone": withTop((file) => { delete file.timeZone; }),
  "its time zone isn't a real one": withTop((file) => { file.timeZone = "Mars/Olympus_Mons"; }),
  "one place can't be read": withBadStop,
  "a check date isn't a real day": withEdit((stops) => { stops[20].hoursChecked = "2026-02-31"; }),
  "a closed date isn't a real day": withEdit((stops) => { stops[20].closedDates = ["2026-11-31"]; }),
  "a day's hours end before they start": withEdit((stops) => { stops[20].week["2"] = [18, 9]; }),
  "a date's hours end where they start": withEdit((stops) => { stops[10].dateHours["2026-10-22"].end = 10; })
};

const linkOnPhone = OLD_LINKS[2].hash;
const savedDay = () => {
  const phone = {};
  phone["cityday-test-v1"] = JSON.stringify({ last: "keep1", plans: { keep1: makePlan({ id: "keep1", city: "St. Petersburg" }) } });
  return phone;
};

const downPages = {};
for (const [why, fetchStops] of Object.entries(catalogDown)) {
  const phone = savedDay();
  const before = JSON.stringify(phone);
  downPages[why] = { page: await settled({ fetchStops, hash: linkOnPhone, store: phone }), before, phone };
}
const noLinkDown = await settled({ fetchStops: offline, store: savedDay() });

// The same link, first while the file is down and then when it is back, on the same phone.
const phoneAfterDown = savedDay();
const phoneBeforeDown = JSON.stringify(phoneAfterDown);
const downLink = await settled({ fetchStops: offline, hash: linkOnPhone, store: phoneAfterDown });
const recovered = await settled({ hash: downLink.locationState.hash, store: phoneAfterDown });
const control = await settled({ hash: linkOnPhone });

// A request that never answers, with a timer the check can fire by hand.
let fireTimer = null;
let answerLate = null;
const hung = makePage({
  hash: linkOnPhone,
  fetchStops: () => new Promise((resolve) => { answerLate = () => resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(stopsFile))) }); }),
  timers: { setTimeout: (fn, ms) => { fireTimer = { fn, ms }; return 1; }, clearTimeout() { fireTimer = null; } }
});
// The list answers at once, so the page is waiting on the first city's file.
await new Promise((resolve) => setTimeout(resolve, 20));
const hungWhileWaiting = { plan: hung.window.plan, stops: hung.window.STOPS.length, loading: !!hung.document.getElementById("loading"), aboutHidden: hung.document.getElementById("screen-about").classList.contains("hidden"), hash: hung.locationState.hash, replaceState: hung.writes.replaceState };
const timerMs = fireTimer && fireTimer.ms;
fireTimer.fn();
await hung.window.CATALOG_READY;
answerLate();
await new Promise((resolve) => setTimeout(resolve, 20));

check("catalog file: every entry in data/stops.json passes data/stops.schema.json", () => {
  const validate = catalogValidator();
  const ok = validate(stopsFile);
  assert(ok, JSON.stringify((validate.errors || []).slice(0, 3)));
  assert(stopsFile.stops.length >= 49, "only " + stopsFile.stops.length + " places in the file");
});

check("catalog file: the schema rejects a missing required field and an unknown key", () => {
  const validate = catalogValidator();
  const fresh = () => JSON.parse(JSON.stringify(stopsFile));
  const required = stopsSchema.$defs.stop.required;
  for (const key of required) {
    const file = fresh();
    delete file.stops[3][key];
    assert(!validate(file), "a place without " + key + " passed");
  }
  let file = fresh();
  file.stops[3].sparkle = true;
  assert(!validate(file), "an unknown key on a place passed");
  file = fresh();
  file.mood = "calm";
  assert(!validate(file), "an unknown key at the top passed");
  file = fresh();
  file.stops[0].why = "Both lines.";
  assert(!validate(file), "a place with both why and whyText passed");
  file = fresh();
  delete file.stops[0].whyText;
  assert(!validate(file), "a place with no line about it passed");
  file = fresh();
  file.stops[1].costBand = "pricey";
  assert(!validate(file), "a made-up price band passed");
  file = fresh();
  file.stops[1].week["7"] = [9, 17];
  assert(!validate(file), "a seven-day-plus week passed");
  file = fresh();
  file.stops = [];
  assert(!validate(file), "an empty list of places passed");
  // Patterns can't know February has no 31st or that a window can't run backwards.
  const dali = (f) => f.stops.find((e) => e.id === "dali");
  file = fresh();
  file.stops[20].hoursChecked = "2026-02-31";
  assert(!validate(file), "hoursChecked 2026-02-31 passed");
  file = fresh();
  file.stops[20].closedDates = ["2026-04-31"];
  assert(!validate(file), "a closed date that isn't a day passed");
  file = fresh();
  dali(file).dateHours["2026-02-30"] = dali(file).dateHours["2026-10-22"];
  assert(!validate(file), "a dateHours key that isn't a day passed");
  file = fresh();
  file.stops[2].whyByDate = { "2026-13-01": "No such month." };
  assert(!validate(file), "a whyByDate key that isn't a day passed");
  file = fresh();
  file.stops[20].week["2"] = [18, 9];
  assert(!validate(file), "a week window of [18, 9] passed");
  file = fresh();
  file.stops[20].week["2"] = [9, 9];
  assert(!validate(file), "a week window that starts where it ends passed");
  file = fresh();
  dali(file).dateHours["2026-10-22"].start = 19;
  assert(!validate(file), "dateHours with start >= end passed");
  file = fresh();
  assert(validate(file), "the real file stopped passing");
});

check("catalog file: ids are unique across both files, and the page loaded every entry in list order", () => {
  const ids = stopsFile.stops.map((e) => e.id);
  const all = ids.concat(kirklandFile.stops.map((e) => e.id));
  assert(new Set(ids).size === ids.length && new Set(all).size === all.length, "duplicate ids");
  assert(JSON.stringify(g.STOPS.map((s) => s.id)) === JSON.stringify(all), "the page's places aren't the files', in list order");
  assert(g.CATALOG.stops.length === ids.length && g.CATALOG.city === "St. Petersburg", "the loaded catalog isn't the file");
  ids.forEach((id) => assert(g.STOP_BY_ID[id] && g.STOP_BY_ID[id].id === id, id + " isn't looked up by id"));
  // The loaded JSON stays plain data: the page converts a copy.
  g.CATALOG.stops.forEach((e) => assert(typeof e.isOpen === "undefined" && typeof e.why !== "function" && typeof e.hours === "undefined", e.id + " was changed in place"));
  assert(!$("loading"), "the loading line is still there");
});

check("catalog file: no catalog is left in index.html", () => {
  for (const text of ["var PLACES", "CLOSED_DALI", "CLOSED_MFA", "CLOSED_MOREAN", "CLOSED_GLASS", "GLASS_EARLY", "daliHours", "daliEnd", "benchHours", "inList"]) {
    assert(!html.includes(text), "index.html still has " + text);
  }
  for (const e of stopsFile.stops.concat(kirklandFile.stops)) {
    assert(!html.includes(e.address) && !html.includes(e.query), e.id + " is still written into index.html");
  }
  assert(/fetch\(url, \{ cache: "no-cache" \}\)/.test(html) && /var CATALOG_URL = "data\/cities\.json";/.test(html), "the page doesn't ask for data/cities.json by a relative path");
  assert(/<section id="screen-about" class="hidden">/.test(html) && /Loading the places…/.test(html), "the page doesn't hold the first screen until the places load");
});

// The page shipped with 19 hand-written places (LEGACY_IDS). They never had a check date.
check("catalog file: every whyText uses only {hours} {on} {occ} {when}, and hoursChecked is null only for the 19 entries that never had one", () => {
  for (const e of stopsFile.stops) {
    for (const line of [e.whyText].concat(Object.values(e.whyByDate || {})).filter(Boolean)) {
      const left = line.replace(/\{(?:hours|on|occ|when)\}/g, "");
      assert(!/[{}]/.test(left), e.id + " has a placeholder the page doesn't fill: " + line);
    }
    if (LEGACY_IDS.includes(e.id)) assert(e.hoursChecked === null, e.id + " was never checked, so hoursChecked must be null");
    else assert(/^\d{4}-\d{2}-\d{2}$/.test(e.hoursChecked || ""), e.id + " needs the day its hours were checked");
  }
  assert(LEGACY_IDS.length === 19 && LEGACY_IDS.every((id) => g.STOP_BY_ID[id]), "the shipped-with list is off");
  // A $ in a line is read as text.
  const stop = g.weekStop({ id: "qa-dollar", week: { 0: [9, 17], 1: [9, 17], 2: [9, 17], 3: [9, 17], 4: [9, 17], 5: [9, 17], 6: [9, 17] }, whyText: "Costs $& and $1, open {hours} {on}." }, g.CITIES.stpete);
  assert(stop.why({ iso: "2026-10-13", hours: "9am–5pm", on: "today" }) === "Costs $& and $1, open 9am–5pm today.", stop.why({ iso: "2026-10-13", hours: "9am–5pm", on: "today" }));
});

check("catalog file: with the old cap of 3, the same decks for the same brief and date as before the move", () => {
  assert(probes.briefs().length === beforeMove.deckCount, "the brief list changed");
  const now = withPoolMax(3, () => probes.decks());
  beforeMove.decks.forEach((x) => {
    const at = probes.briefs().findIndex((b) => JSON.stringify(b) === JSON.stringify(x.brief));
    assert(at >= 0, "a saved brief is gone: " + JSON.stringify(x.brief));
    assert(JSON.stringify(now[at]) === JSON.stringify(x.deck), "a deck changed for " + JSON.stringify(x.brief) + ": " + JSON.stringify(now[at]));
  });
  assert(probes.sha(now) === beforeMove.deckDigest, "some of the " + beforeMove.deckCount + " decks changed");
});

// The full list for each probe brief, from a cap so high it never cuts. This is the app's own filter and sort.
const fullDecks = () => withPoolMax(99, () => probes.decks());

check("deck: a feeling with 6 or more fitting places gets 6 (#62)", () => {
  const full = fullDecks();
  const now = probes.decks();
  let big = 0;
  now.forEach((deck, i) => g.FEEL_ORDER.forEach((f) => {
    const all = full[i].pools[f];
    if (all.length < 6) return;
    big++;
    assert(deck.pools[f].length === 6, "a pool with " + all.length + " fitting got " + deck.pools[f].length);
    assert(JSON.stringify(deck.pools[f]) === JSON.stringify(all.slice(0, 6)), "not the first six of the full list: " + deck.pools[f]);
  }));
  assert(big > 0, "no probe brief had a pool with six or more fitting places");
});

check("catalog file: new decks keep the old three picks first in each feeling (#62)", () => {
  const old = withPoolMax(3, () => probes.decks());
  const now = probes.decks();
  now.forEach((deck, i) => g.FEEL_ORDER.forEach((f) => {
    assert(JSON.stringify(deck.pools[f].slice(0, 3)) === JSON.stringify(old[i].pools[f]), "the first three changed in " + f + ": " + deck.pools[f] + " vs " + old[i].pools[f]);
  }));
});

check("catalog file: hand-written stops read the same hours and lines as before", () => {
  const now = probes.hours(LEGACY_IDS);
  for (const id of LEGACY_IDS) {
    for (const iso of probes.KEY_DAYS) {
      assert(JSON.stringify(now[id][iso]) === JSON.stringify(beforeMove.hours[id][iso]), id + " on " + iso + " is now " + JSON.stringify(now[id][iso]) + ", it was " + JSON.stringify(beforeMove.hours[id][iso]));
    }
  }
  // Every place, every open day from 2026-10-01 through 2027-12-31: hours, start, end, gap, last entry, stay, line.
  const digests = probes.hoursDigests();
  for (const id of beforeMove.ids) assert(digests[id] === beforeMove.hoursDigest[id], id + " reads differently on some open day");
  const g2 = g.STOP_BY_ID;
  assert(g2.bench.bar === true && g2.parking.order === 0 && g2.mfa.cost === "ticket" && g2.kahwa.cost === null, "a plain field changed");
  // A weekday a hand-written place is closed now says so, where it used to show its usual hours.
  assert(g2.mfa.hours(g.parseDate("2026-10-12"), "2026-10-12") === "Closed", "closed Monday");
});

check("catalog file: every id the page shipped with on 40a974a is still in the file", () => {
  const inFile = stopsFile.stops.map((e) => e.id);
  assert(beforeMove.ids.length === 49, "the saved list of ids is off");
  beforeMove.ids.forEach((id) => assert(inFile.includes(id), id + " is gone: sent links refer to it"));
  assert(JSON.stringify(inFile) === JSON.stringify(beforeMove.ids), "the file's ids aren't the shipped ones, in the same order, with nothing extra: " + JSON.stringify(inFile.filter((id) => !beforeMove.ids.includes(id))));
  OLD_LINKS.forEach((link) => {
    const plan = g.decodePlan(link.hash.replace(/^#(?:play\/)?/, ""));
    if (!plan.deck) return;
    const ids = [plan.deck.anchor && plan.deck.anchor.id].concat(Object.values(plan.deck.pools).flat()).filter(Boolean);
    ids.forEach((id) => assert(g.STOP_BY_ID[id], link.built + " names " + id + ", which isn't in the file"));
  });
});

check("catalog file: if the file fails to load, the page says so and builds no day", () => {
  for (const [why, { page, before, phone }] of Object.entries(downPages)) {
    const w = page.window, doc = page.document;
    const hidden = (id) => doc.getElementById(id).classList.contains("hidden");
    assert(w.STOPS.length === 0 && Object.keys(w.STOP_BY_ID).length === 0 && w.CATALOG === null, why + ": some places loaded anyway");
    assert(w.plan === null && w.mode === "play", why + ": a day was built");
    const text = doc.getElementById("play").textContent;
    assert(/Hmm/.test(text) && /The places didn't load\./.test(text), why + ": " + text);
    assert(/City Day couldn't get its list of places, so it hasn't made a day\. Check your connection, then try again\./.test(text), why + ": no plain reason");
    assert(/Your link is fine\. Nothing in it has changed\./.test(text), why + ": no word about the link");
    assert(doc.querySelector('#play [role="alert"]'), why + ": not announced");
    assert(!hidden("screen-play") && hidden("screen-about") && hidden("screen-form") && hidden("screen-desk"), why + ": the wrong screen is showing");
    assert(!doc.getElementById("loading"), why + ": still says loading");
    assert(!/btn-primary|class="err/.test(doc.getElementById("play").innerHTML), why + ": uses the red");
    assert(page.writes.replaceState === 0, why + ": rewrote the address");
    assert(page.locationState.hash === linkOnPhone, why + ": changed the hash");
    assert(JSON.stringify(phone) === before, why + ": wrote to the phone's storage");
    assert(w.parseIncomingHash().encoded === linkOnPhone.slice(6), why + ": the link isn't the one that was sent");
    const retry = doc.getElementById("catalog-retry");
    assert(retry && retry.textContent === "Try again", why + ": no way to try again");
    retry.dispatchEvent(new w.Event("click", { bubbles: true }));
    assert(page.writes.reload === 1, why + ": Try again didn't reload");
  }
  const bare = noLinkDown;
  assert(/The places didn't load\./.test(bare.document.getElementById("play").textContent) && !/Your link is fine/.test(bare.document.getElementById("play").textContent), "no link: said something about a link");
  assert(bare.document.getElementById("screen-form").classList.contains("hidden") && bare.window.plan === null, "no link: the form or a saved day opened");
  assert(JSON.stringify(bare.store) === JSON.stringify(savedDay()), "no link: wrote to the phone's storage");
  // It waits 15 seconds, then gives up. An answer after that is ignored.
  const w = hung.window, doc = hung.document;
  assert(timerMs === 15000, "waits " + timerMs + "ms");
  assert(w.STOPS.length === 0 && w.plan === null && /The places didn't load\./.test(doc.getElementById("play").textContent), "no failure screen after the wait");
  assert(hung.writes.replaceState === 0 && hung.locationState.hash === linkOnPhone, "the late answer touched the link");
});

check("catalog file: a #play/ link opened while the file is down keeps its hash and storage, then plays the same deck once it loads", () => {
  assert(downLink.locationState.hash === linkOnPhone && downLink.writes.replaceState === 0, "the hash changed while the file was down");
  assert(JSON.stringify(phoneAfterDown) === phoneBeforeDown && phoneBeforeDown === JSON.stringify(savedDay()), "storage changed while the file was down");
  const back = recovered.window;
  assert(back.mode === "play" && back.plan && back.plan.date === "2026-10-10", "the link didn't open once the file loaded");
  assert(JSON.stringify(back.plan.deck) === JSON.stringify(control.window.plan.deck), "a different deck after the file loaded");
  assert(recovered.locationState.hash === control.locationState.hash && /^#play\//.test(recovered.locationState.hash), "a different link after the file loaded");
  assert(JSON.parse(phoneAfterDown["cityday-test-v1"]).plans.keep1, "the saved day is gone");
  assert(!recovered.document.getElementById("screen-play").classList.contains("hidden") && /Alex and Riley/.test(recovered.document.getElementById("play").textContent), "no curtain");
});

check("catalog file: nothing opens a link or a saved day until the places have loaded", () => {
  assert(hungWhileWaiting.plan === null && hungWhileWaiting.stops === 0, "a day opened before the places came");
  assert(hungWhileWaiting.loading && hungWhileWaiting.aboutHidden, "the page didn't wait out loud");
  assert(hungWhileWaiting.hash === linkOnPhone && hungWhileWaiting.replaceState === 0, "the link was touched while waiting");
});

// --- #33: any city, not just St. Pete ---

// A made-up city on the Pacific coast, for tests only. Nothing in index.html points at it: the
// checks hand it to a fresh page with addCity(), and the suite's main page g never loads it.
const fixtureFile = JSON.parse(fs.readFileSync(new URL("./qa-fixtures/pacific-test-city.json", import.meta.url), "utf8"));
const cityDoc = fs.readFileSync(new URL("./docs/adding-a-city.md", import.meta.url), "utf8");
const clone = (o) => JSON.parse(JSON.stringify(o));
const throwsError = (fn) => { try { fn(); } catch (e) { return true; } return false; };
const blocked = (urls) => async (url) => { urls.push(String(url)); throw new Error("network blocked in QA"); };
const decodeLink = (link) => JSON.parse(Buffer.from(link.replace(/^[^#]*#/, "").replace(/^play\//, "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
const clickOn = (page, el) => el.dispatchEvent(new page.Event("click", { bubbles: true }));

// The page with the fixture added, on a Pacific clock. fxUrls is every address it asked for.
const fxUrls = [];
const fx = (await settled({ fetchList: stpeteOnly })).window;
fx.fetch = blocked(fxUrls);
fx.addCity(clone(fixtureFile));
const fxNoon = new Date("2026-10-07T12:00:00-07:00");
fx.clockOverride = fxNoon;
const fxPlan = (overrides) => makePlan(Object.assign({ id: "fx1", city: "qa-pacific", occasion: "Date", must: "coffee, walking, dinner" }, overrides || {}));
const fxDeck = (pools) => ({ v: 1, anchor: { type: "none" }, pools: Object.assign({ taste: [], drift: [], dig: [], soft: [] }, pools), park: false });

// A page that loads only what the list says, and asks for nothing else but those files.
const askedFor = [];
const plainPage = makePage({ asked: askedFor });
await plainPage.window.CATALOG_READY;

// One real city, for the picker. The second is a test-only clone, loaded inside its check.
const duo = (await settled({ fetchList: stpeteOnly })).window;
duo.fetch = blocked([]);

check("deck: a feeling with fewer than 6 fitting places gets all of them, in any city (#62)", () => {
  const full = fullDecks();
  const now = probes.decks();
  let small = 0;
  now.forEach((deck, i) => g.FEEL_ORDER.forEach((f) => {
    const all = full[i].pools[f];
    if (all.length >= 6) return;
    small++;
    assert(JSON.stringify(deck.pools[f]) === JSON.stringify(all), "a small pool lost places: " + deck.pools[f] + " of " + all);
  }));
  assert(small > 0, "no St. Pete probe brief had a pool with fewer than six fitting places");
  // The Pacific fixture page: its pools are small.
  fx.clockOverride = fxNoon;
  const briefs = [];
  for (const date of ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-13", "2026-10-17"]) {
    for (const must of ["", "coffee, walking, dinner", "coffee", "walking"]) for (const kind of ["away", "celebrate", "easy"]) briefs.push({ date, must, kind });
  }
  let fxSmall = 0;
  briefs.forEach((b) => {
    const all = withPoolMax(99, () => fx.buildDeck(fxPlan(b)), fx);
    const deck = fx.buildDeck(fxPlan(b));
    fx.FEEL_ORDER.forEach((f) => {
      if (all.pools[f].length >= 6) return;
      if (all.pools[f].length) fxSmall++;
      assert(JSON.stringify(deck.pools[f]) === JSON.stringify(all.pools[f]), "a small pool lost places: " + deck.pools[f]);
    });
  });
  assert(fxSmall > 0, "the fixture page never had a filled pool under six");
  assert(fx.POOL_MAX === 6 && g.POOL_MAX === 6, "the cap wasn't put back");
});

check("link: decks saved before #62 stay frozen at their size when opened (#62)", () => {
  const realBuild = g.buildDeck;
  let built = 0;
  g.buildDeck = function () { built++; return realBuild.apply(this, arguments); };
  try {
    // The wrapper has to be what the page calls, or the count below means nothing.
    g.ensureDeck(makePlan({ id: "probe" }));
    assert(built === 1, "the page doesn't call the wrapped buildDeck");
    built = 0;
    beforeMove.decks.forEach((x) => {
      const p = makePlan(x.brief);
      p.deck = x.deck;
      const opened = g.decodePlan(g.encodePlan(g.linkPlan(p)));
      assert(JSON.stringify(opened.deck) === JSON.stringify(x.deck), "a saved deck changed when opened: " + JSON.stringify(x.brief));
    });
    for (const x of beforeMove.decks.filter((_, i) => i % 45 === 0)) {
      const p = makePlan(x.brief);
      p.deck = x.deck;
      sunny(p.date);
      built = 0;
      openLink("#play/" + g.encodePlan(g.linkPlan(p)));
      assert(built === 0, "a link with a deck called buildDeck");
      assert(g.mode === "play" && JSON.stringify(g.plan.deck) === JSON.stringify(x.deck), "an opened link played a different deck");
    }
    OLD_LINKS.forEach((link) => {
      const raw = decodeLink(link.hash);
      resetPhone();
      sunny("2026-10-10");
      built = 0;
      openLink(link.hash);
      assert(g.mode === "play" && g.plan, link.built + ": didn't open");
      if (!raw.deck) return;
      assert(built === 0, link.built + ": a link with a deck called buildDeck");
      Object.keys(raw.deck.pools).forEach((f) => {
        assert(g.plan.deck.pools[f].length === raw.deck.pools[f].length, link.built + ": the " + f + " pool went from " + raw.deck.pools[f].length + " to " + g.plan.deck.pools[f].length);
      });
    });
  } finally {
    g.buildDeck = realBuild;
  }
});

check("link: a 6-place pool rides in the link whole (#62)", () => {
  const probe = probes.briefs().map((b) => makePlan(b)).map((p) => { p.deck = g.buildDeck(p); return p; })
    .find((p) => g.FEEL_ORDER.some((f) => p.deck.pools[f].length === 6));
  assert(probe, "no probe brief made a six-place pool");
  const feel = g.FEEL_ORDER.find((f) => probe.deck.pools[f].length === 6);
  const back = g.decodePlan(g.encodePlan(g.linkPlan(probe)));
  assert(JSON.stringify(back.deck) === JSON.stringify(probe.deck), "the deck changed on the way: " + JSON.stringify(back.deck.pools[feel]));
  const used = Object.values(probe.deck.pools).flat();
  const extra = g.STOPS.find((s) => s.feel === feel && s.city === probe.city && !used.includes(s.id) && (!probe.deck.anchor.id || s.id !== probe.deck.anchor.id));
  assert(extra, "no seventh place of the same feeling to add");
  const seven = JSON.parse(JSON.stringify(probe));
  seven.deck.pools[feel].push(extra.id);
  const cut = g.decodePlan(g.encodePlan(g.linkPlan(seven)));
  assert(JSON.stringify(cut.deck.pools[feel]) === JSON.stringify(probe.deck.pools[feel]), "a seventh place was kept: " + cut.deck.pools[feel]);
});

// What St. Pete read like before #33. These strings are typed out, not built from the config.
const STPETE_BEFORE = {
  titles: {
    "Just because": "Just because, in St. Pete for A and B",
    Anniversary: "An anniversary in St. Pete for A and B",
    Date: "A date in St. Pete for A and B",
    Birthday: "A birthday in St. Pete for A and B",
    other: "A day in St. Pete for A and B"
  },
  formLabel: "St. Petersburg",
  metaLine: "Saturday, October 10, 2026 · St. Petersburg",
  weatherUrl: "https://api.weather.gov/points/27.770,-82.640",
  stormLine: "Saturday, 78°F, wind 10 mph E. Sunny. Florida storms usually pass. Duck inside, then pick up where you left off.",
  directions: {
    typed: "800 2nd Ave NE, FL",
    withFl: "800 2nd Ave NE, FL",
    withFlorida: "800 2nd Ave NE, Florida",
    withLowerFl: "800 2nd Ave NE, fl",
    none: "Dinner reservation, St. Petersburg, FL"
  }
};

check("city: index.html names no city, region, coordinates or time zone, and never points at qa-fixtures", () => {
  const found = (html.match(/Petersburg|St\. Pete|\bFL\b|27\.77|82\.64|America\/New_York|America\/Los_Angeles|nyParts|nowNY|qa-fixtures|qa-pacific|pacific-test-city/g) || []).concat(html.match(/florida|stpete/gi) || []);
  assert(!found.length, "index.html still says: " + [...new Set(found)].join(", "));
  assert((html.match(/var CATALOG_URL = "data\/cities\.json";/g) || []).length === 1, "CATALOG_URL isn't the list of cities");
  assert((html.match(/getJSON\(CATALOG_URL\)/g) || []).length === 1, "the list of cities isn't read exactly once");
  assert((html.match(/fetch\(url, \{ cache: "no-cache" \}\)/g) || []).length === 1 && (html.match(/\bfetch\(/g) || []).length === 2, "the files aren't fetched in one place");
  const named = (html.match(/kirkland|Washington/gi) || []).concat(html.match(/\bWA\b/g) || [], html.includes(String(kirklandFile.weather.lat)) ? ["the Kirkland latitude"] : [], html.includes(String(kirklandFile.weather.lon)) ? ["the Kirkland longitude"] : []);
  assert(!named.length, "index.html still says: " + [...new Set(named)].join(", "));
  assert(!/<meta[^>]*(?:description)[^>]*(?:Pete|Florida)/i.test(html), "a meta description names a city");
});

check("city: St. Pete reads exactly as before (all five titles, form label, meta line, weather address 27.770,-82.640, storm line, anchor directions)", () => {
  const sp = makePlan({ you: "A", them: "B" });
  Object.entries(STPETE_BEFORE.titles).forEach(([occasion, title]) => {
    assert(g.welcomeLine(Object.assign({}, sp, { occasion: occasion === "other" ? "" : occasion })) === title, occasion + ": " + g.welcomeLine(Object.assign({}, sp, { occasion })));
  });
  // The form's label.
  resetPhone();
  g.setMode("create");
  g.plan = null;
  g.fillForm(null);
  const pick = [...document.querySelectorAll("#city-pick button")];
  assert($("city-fixed").classList.contains("hidden") && !$("city-pick").classList.contains("hidden"), "the picker isn't showing for two cities");
  assert(pick.length === 2 && pick[0].textContent === STPETE_BEFORE.formLabel && pick[0].getAttribute("aria-pressed") === "true" && g.pickedCityId() === "stpete", "form label " + pick.map((b) => b.textContent + "=" + b.getAttribute("aria-pressed")));
  // The meta line on the desk and on the first screen of the day.
  creatorDesk({});
  assert($("desk-top").textContent.includes(STPETE_BEFORE.metaLine), "desk: " + $("desk-top").textContent.slice(0, 160));
  startPlay({});
  assert(playText().includes(STPETE_BEFORE.metaLine), "curtain: " + playText().slice(0, 160));
  assert(/An anniversary in St\. Pete\. One day\./.test(playText()), "curtain title: " + playText().slice(0, 160));
  // The weather address.
  const urls = [];
  const realFetch = g.fetch;
  g.fetch = blocked(urls);
  try {
    resetPhone();
    g.weatherByDate = {};
    g.openDay(makePlan({}), { mode: "play" });
    assert(urls[0] === STPETE_BEFORE.weatherUrl, "weather address " + urls[0]);
  } finally {
    g.fetch = realFetch;
  }
  // The storm line on the plan B screen.
  startPlay({});
  g.act("begin");
  g.act("iffy");
  assert(playText().includes(STPETE_BEFORE.stormLine), "storm line: " + playText().slice(0, 300));
  // Directions for a place the creator typed in.
  const where = (typed) => { startPlay({ anchor: { name: "Dinner reservation", time: "18:30", where: typed } }); return g.anchorView().query; };
  const asked = { typed: where("800 2nd Ave NE"), withFl: where("800 2nd Ave NE, FL"), withFlorida: where("800 2nd Ave NE, Florida"), withLowerFl: where("800 2nd Ave NE, fl"), none: where("") };
  Object.keys(STPETE_BEFORE.directions).forEach((k) => assert(asked[k] === STPETE_BEFORE.directions[k], k + ": " + asked[k]));
});

check("city: the St. Pete config passes the schema, its time zone is real, and links with no city fall back to it", () => {
  const validate = catalogValidator();
  assert(validate(stopsFile), JSON.stringify(validate.errors && validate.errors.slice(0, 3)));
  const noRain = clone(stopsFile);
  delete noRain.rainLine;
  assert(validate(noRain), "rainLine should be optional");
  ["cityId", "short", "region", "regionNames", "timeZone", "weather", "sun"].forEach((key) => {
    const bad = clone(stopsFile);
    delete bad[key];
    assert(!validate(bad), "the schema accepted a file with no " + key);
  });
  assert(!validate(Object.assign(clone(stopsFile), { surprise: true })), "the schema accepted an unknown top-level key");
  new Intl.DateTimeFormat("en-US", { timeZone: stopsFile.timeZone });
  const city = g.CITIES[stopsFile.cityId];
  assert(city && g.DEFAULT_CITY === stopsFile.cityId && Object.keys(g.CITIES).join() === stopsFile.cityId + "," + kirklandFile.cityId, "St. Pete isn't the first of the loaded cities: " + Object.keys(g.CITIES));
  assert(city.name === stopsFile.city && city.short === stopsFile.short && city.timeZone === stopsFile.timeZone && city.rainLine === stopsFile.rainLine, "the page changed the config");
  assert(city.weather.lat === 27.770 && city.weather.lon === -82.640 && city.sun.lat === 27.7706 && city.sun.lon === -82.6403, "weather and sun are not their own points");
  assert(g.cityIdFor("") === "stpete" && g.cityIdFor(undefined) === "stpete" && g.cityIdFor("stpete") === "stpete" && g.cityIdFor("St. Petersburg") === "stpete", "id lookup");
  assert(g.cityIdFor("nowhere") === null && g.cityIdFor("constructor") === null && g.cityIdFor("__proto__") === null && g.cityIdFor(7) === null, "an unknown city got an id");
  const stpeteIds = stopsFile.stops.map((e) => e.id);
  g.STOPS.filter((s) => stpeteIds.includes(s.id)).forEach((s) => assert(s.city === "stpete", s.id + " has no city"));
  g.CATALOG.stops.forEach((e) => assert(e.city === undefined, e.id + " was changed in place"));
  OLD_LINKS.forEach((link) => {
    const plan = g.decodePlan(link.hash.replace(/^#(?:play\/)?/, ""));
    assert(plan && plan.city === "stpete", link.built + ": opens in " + (plan && plan.city));
  });
  // A bad config fails the load. Reading changes nothing, so these can run on the suite's page.
  const before = g.STOPS.length + "|" + Object.keys(g.CITIES) + "|" + Object.keys(g.STOP_BY_ID).length;
  const asked = (edit) => { const f = clone(fixtureFile); edit(f); return throwsError(() => g.readCity(f)); };
  assert(!throwsError(() => g.readCity(clone(fixtureFile))), "the fixture should read");
  assert(asked((f) => { f.timeZone = "Mars/Olympus_Mons"; }), "a made-up time zone was accepted");
  assert(asked((f) => { delete f.timeZone; }) && asked((f) => { f.timeZone = ""; }), "a missing time zone was accepted");
  assert(!throwsError(() => { const f = clone(stopsFile); f.cityId = "stpete-copy"; f.city = "Copy (QA only)"; f.stops.forEach((s) => { s.id = "copy-" + s.id; }); g.readCity(f); }), "a file with a time zone should read");
  assert(asked((f) => { delete f.cityId; }) && asked((f) => { f.cityId = "Not An Id"; }), "a missing or bad cityId was accepted");
  assert(asked((f) => { f.cityId = "stpete"; }), "a city id that is already loaded was accepted");
  assert(asked((f) => { f.city = "St. Petersburg"; }), "a city name that is already loaded was accepted");
  assert(asked((f) => { delete f.short; }) && asked((f) => { delete f.region; }) && asked((f) => { f.regionNames = []; }), "a missing name or region was accepted");
  assert(asked((f) => { delete f.weather; }) && asked((f) => { f.sun = { lat: 200, lon: 0 }; }), "a missing or impossible point was accepted");
  assert(asked((f) => { f.stops[0].id = "kahwa"; }), "a stop id that another city already has was accepted");
  assert(asked((f) => { f.stops[1].id = f.stops[0].id; }), "a stop id twice in one city was accepted");
  assert(asked((f) => { delete f.stops[0].week; }), "a place with no week was accepted");
  assert(before === g.STOPS.length + "|" + Object.keys(g.CITIES) + "|" + Object.keys(g.STOP_BY_ID).length, "reading a city changed the page");
  // A city that fails halfway adds none of its places.
  const half = clone(fixtureFile);
  half.stops[2].week = null;
  const nStops = fx.STOPS.length;
  assert(throwsError(() => fx.addCity(Object.assign(half, { cityId: "qa-half", city: "Half City (QA only)" }))), "a bad place was accepted");
  assert(fx.STOPS.length === nStops && !fx.CITIES["qa-half"], "a city that failed was partly kept");
});

check("city: a Pacific fixture city builds a day with its own title, label, weather address, directions and hours", () => {
  fx.clockOverride = fxNoon;
  fxUrls.length = 0;
  fx.weatherByDate = {};
  const p = fxPlan({ must: "coffee, walking, driving, dinner", anchor: { name: "Dinner reservation", time: "18:30", where: "9 Test Way" } });
  const deck = fx.buildDeck(p);
  const ids = Object.values(deck.pools).flat();
  assert(ids.includes("qa-pacific-cafe") && ids.includes("qa-pacific-park"), "the fixture's places didn't come up: " + ids);
  ids.forEach((id) => assert(/^qa-pacific-/.test(id), id + " is another city's place"));
  assert(deck.park === false, "parking offered in a city with none");
  // The same brief in St. Pete still builds the same deck, with the fixture loaded beside it.
  const sp = fx.buildDeck(makePlan({ id: "sp1" }));
  assert(JSON.stringify(sp) === JSON.stringify(deckOf({ id: "sp1" })), "the fixture changed a St. Pete deck");
  assert(!deckPlaceIds(sp).some((id) => /^qa-pacific-/.test(id)), "a fixture place came up in St. Pete");
  // The title and the city line.
  fx.openDay(p, { mode: "create" });
  const desk = fx.document.getElementById("desk-top").textContent;
  assert(desk.includes("A date in Fixture City for A and B") && desk.includes("Saturday, October 10, 2026 · Fixture City (QA only)"), "desk: " + desk.slice(0, 200));
  assert(!/St\. Pete|Petersburg/.test(desk), "desk still names St. Pete");
  fx.openDay(p, { mode: "play" });
  const curtain = fx.document.getElementById("play").textContent;
  assert(/A date in Fixture City\. One day\./.test(curtain) && curtain.includes("· Fixture City (QA only)") && !/St\. Pete|Petersburg/.test(curtain), "curtain: " + curtain.slice(0, 200));
  // The weather address, and a forecast that belongs to it.
  assert(fxUrls[0] === "https://api.weather.gov/points/44.000,-124.500", "weather address " + fxUrls[0]);
  assert(fx.weatherByDate["2026-10-10"].point === "44.000,-124.500", "forecast not tied to its point");
  // Plan B has no storm line unless the city has one.
  fx.act("begin");
  fx.act("iffy");
  const iffy = fx.document.getElementById("play").textContent;
  assert(/ Duck inside, then pick up where you left off\./.test(iffy) && !/storms usually pass|Florida/.test(iffy), "iffy: " + iffy.slice(0, 200));
  // Directions use the city's own region.
  const query = (where) => { fx.plan.anchor.where = where; return fx.anchorView().query; };
  assert(query("9 Test Way") === "9 Test Way, ZZ", "typed: " + query("9 Test Way"));
  assert(query("9 Test Way, zz") === "9 Test Way, zz", "region already typed");
  assert(query("9 Test Way, FL") === "9 Test Way, FL, ZZ", "another city's region isn't this one's");
  assert(query("") === "Dinner reservation, Fixture City (QA only), ZZ", "no address: " + query(""));
  // Hours: its own, with sunrise and sunset worked out at its own point.
  const cafe = fx.stopView("qa-pacific-cafe"), late = fx.stopView("qa-pacific-late"), park = fx.stopView("qa-pacific-park");
  assert(cafe.hours === "7am–5pm" && late.hours === "5pm–1am", cafe.hours + " / " + late.hours);
  assert(/Closed/.test(fx.STOP_BY_ID["qa-pacific-late"].hours(fx.parseDate("2026-10-13"), "2026-10-13")), "the late counter is open on a Tuesday");
  const day = fx.parseDate("2026-10-10"), here = fx.CITIES["qa-pacific"], sunrise = fx.sunriseHour(day, here), sunset = fx.sunsetHour(day, here);
  assert(sunrise > 6.5 && sunrise < 8.5 && sunset > 17.5 && sunset < 19.5, "sunrise " + sunrise + ", sunset " + sunset);
  assert(Math.abs(park.start - (sunrise - 0.5)) < 0.1 && Math.abs(park.end - (sunset + 0.5)) < 0.1, "park " + park.start + "–" + park.end);
  assert(/opens 30 min before sunrise, closes 30 min after sunset/.test(park.hours), park.hours);
  assert(Math.abs(fx.sunsetHour(day, fx.CITIES.stpete) - sunset) > 0.25, "sunset is the same as St. Pete's");
  assert(fx.here() === here, "here() isn't the open day's city");
});

check("city: the fixture's clock runs on Pacific time for open now, closing buffers and after midnight", () => {
  const was = process.env.TZ;
  const sunrises = [];
  try {
    for (const tz of ["UTC", "Asia/Kolkata"]) {
      process.env.TZ = tz;
      const p = fxPlan({ id: "fx5", deck: fxDeck({ taste: ["qa-pacific-cafe", "qa-pacific-late"], drift: ["qa-pacific-park"] }) });
      fx.weatherByDate = { "2026-10-10": { status: "ready", name: "Saturday", temp: "60°F", wind: "5 mph W", short: "Sunny", wet: false, fetchedAt: Date.now() } };
      fx.openDay(p, { mode: "play" });
      const clock = (stamp) => { fx.clockOverride = new Date(stamp); };
      const label = tz + ": ";
      // 11:30pm Pacific on the night is that night, whatever the phone's own zone says.
      clock("2026-10-10T23:30:00-07:00");
      const now = fx.cityNow();
      assert(now.iso === "2026-10-10" && now.hour === 23.5, label + JSON.stringify(now));
      assert(fx.isPlanDay() && fx.planHour() === 23.5, label + "the night isn't the plan night");
      // Open now, then the closing buffer: a 20-minute coffee and a 15-minute walk before 5pm.
      clock("2026-10-10T15:00:00-07:00");
      assert(fx.offered("taste").includes("qa-pacific-cafe") && !fx.offered("taste").includes("qa-pacific-late"), label + "3pm: " + fx.offered("taste"));
      clock("2026-10-10T16:30:00-07:00");
      const cafe = fx.stopView("qa-pacific-cafe");
      assert(fx.viewHour(cafe) === 16.5 && fx.openNow(cafe, "held") && fx.closingLine(cafe) === "Closes at 5pm. Not much time left.", label + "4:30pm: " + fx.closingLine(cafe));
      clock("2026-10-10T16:50:00-07:00");
      assert(!fx.offered("taste").includes("qa-pacific-cafe") && fx.openNow(fx.stopView("qa-pacific-cafe"), "held"), label + "4:50pm: the buffer didn't hold the cafe back: " + fx.offered("taste"));
      clock("2026-10-10T17:10:00-07:00");
      assert(!fx.openNow(fx.stopView("qa-pacific-cafe"), "held"), label + "5:10pm: the cafe is still open");
      // After midnight on the plan night, the late counter is still open.
      clock("2026-10-11T00:30:00-07:00");
      assert(fx.cityNow().iso === "2026-10-11" && fx.planHour() === 24.5 && fx.stillHeldNight("2026-10-10") && !fx.isPlanDay(), label + "12:30am isn't the plan night");
      const counter = fx.stopView("qa-pacific-late");
      assert(fx.viewHour(counter) === 24.5 && fx.openNow(counter, "held") && fx.untilLine(counter) === "Open until 1am", label + "12:30am: " + fx.untilLine(counter));
      clock("2026-10-11T01:30:00-07:00");
      assert(!fx.openNow(fx.stopView("qa-pacific-late"), "held"), label + "1:30am: the late counter is still open");
      sunrises.push(fx.sunriseHour(fx.parseDate("2026-10-10"), fx.CITIES["qa-pacific"]));
    }
  } finally {
    if (was === undefined) delete process.env.TZ; else process.env.TZ = was;
    fx.clockOverride = fxNoon;
  }
  assert(sunrises[0] === sunrises[1] && sunrises[0] > 6.5 && sunrises[0] < 8.5, "sunrise " + sunrises);
});

check("city: old #play/ links with no city open as St. Pete, the 8240ac1 St. Petersburg link still opens, new links carry city, and an unknown city shows the broken-link screen", () => {
  // No city field at all.
  const noCity = OLD_LINKS[OLD_LINKS.length - 1];
  assert(/^40a974a/.test(noCity.built) && decodeLink(noCity.hash).city === undefined, "the 40a974a link has a city");
  [g, fx].forEach((page) => {
    const old = page.decodePlan(noCity.hash.replace(/^#play\//, ""));
    assert(old && old.city === "stpete", "no city opened as " + (old && old.city));
    assert(deckPlaceIds(old.deck).every((id) => page.STOP_BY_ID[id].city === "stpete"), "an old deck reaches outside St. Pete");
    assert(old.deck.anchor.id === "bellabrava" && old.deck.anchor.alts.join() === "la-v-vietnamese,pin-wok-bowl" && old.deck.allergy === true, "the frozen deck changed");
  });
  resetPhone();
  sunny("2026-10-10");
  openLink(noCity.hash);
  assert(g.mode === "play" && g.plan.city === "stpete" && /Alex and Riley/.test(playText()) && /· St\. Petersburg/.test(playText()), "the no-city link didn't open: " + playText().slice(0, 100));
  // The oldest link says "St. Petersburg" and carries no deck.
  assert(decodeLink(OLD_LINKS[0].hash).city === "St. Petersburg", "the 8240ac1 link doesn't say St. Petersburg");
  resetPhone();
  sunny("2026-10-10");
  openLink(OLD_LINKS[0].hash);
  assert(g.mode === "play" && g.plan.city === "stpete" && /· St\. Petersburg/.test(playText()), "the 8240ac1 link didn't open: " + playText().slice(0, 100));
  // New links carry the city, and the deck stays version 1.
  resetPhone();
  g.setMode("create");
  g.plan = null;
  g.fillForm(null);
  $("you").value = "A"; $("them").value = "B";
  g.applyPills({ occasion: "Date", drink: "no", lean: "gems" });
  g.renderKinds("Date", "easy");
  $("budget-amount").value = "120";
  $("date").value = "2026-10-10";
  assert(g.submitForm() === true && g.plan.city === "stpete", "the form didn't make a St. Pete day");
  const sent = decodeLink(g.shareUrl());
  assert(sent.city === "stpete" && sent.deck.v === 1, "the new link: " + JSON.stringify(sent).slice(0, 120));
  fx.openDay(fxPlan({}), { mode: "create" });
  assert(decodeLink(fx.shareUrl()).city === "qa-pacific", "the fixture's link doesn't carry its city");
  // An unknown city is a broken link, not a day in the wrong place.
  const stray = g.encodePlan(Object.assign(g.linkPlan(g.plan), { city: "nowhere" }));
  assert(g.decodePlan(stray) === null, "an unknown city decoded");
  resetPhone();
  openLink("#play/" + stray);
  assert(g.plan === null && /This link didn't come through whole\./.test(playText()), "no broken-link screen: " + playText().slice(0, 100));
  assert(locationState.hash === "#play/" + stray, "the broken link's hash changed");
  // The fixture's own link means nothing to a page that never loaded it.
  const fxLink = g.encodePlan(g.linkPlan(Object.assign(fxPlan({ deck: fxDeck({ taste: ["qa-pacific-cafe"] }) }), {})));
  assert(g.decodePlan(fxLink) === null, "the suite's page opened a city it never loaded");
  // A deck only keeps its own city's places, in both directions.
  const mixed = { v: 1, anchor: { type: "stop", id: "bellabrava", time: 18, leave: 17.5, alts: ["qa-pacific-late", "la-v-vietnamese"] }, pools: { taste: ["qa-pacific-cafe", "kahwa"], drift: ["qa-pacific-park", "pier"], dig: [], soft: [] }, park: true };
  const inFixture = fx.decodePlan(fx.encodePlan(Object.assign(fxPlan({}), { deck: mixed, skip: ["kahwa", "qa-pacific-park"] })));
  assert(inFixture.deck.anchor.type === "none" && inFixture.deck.pools.taste.join() === "qa-pacific-cafe" && inFixture.deck.pools.drift.join() === "qa-pacific-park" && inFixture.deck.park === false, "a fixture deck kept St. Pete places: " + JSON.stringify(inFixture.deck));
  assert(inFixture.skip.join() === "qa-pacific-park", "a fixture day's skips kept St. Pete places");
  const inStPete = fx.decodePlan(fx.encodePlan(Object.assign(makePlan({}), { deck: mixed, skip: ["kahwa", "qa-pacific-park"] })));
  assert(inStPete.deck.anchor.id === "bellabrava" && inStPete.deck.anchor.alts.join() === "la-v-vietnamese" && inStPete.deck.pools.taste.join() === "kahwa" && inStPete.deck.pools.drift.join() === "pier" && inStPete.deck.park === true, "a St. Pete deck kept fixture places: " + JSON.stringify(inStPete.deck));
  assert(inStPete.skip.join() === "kahwa", "a St. Pete day's skips kept fixture places");
  // The page says the same thing about a day it saved before the city was a field.
  assert(g.decodePlan(g.encodePlan(makePlan({ city: "St. Petersburg" }))).city === "stpete" && g.decodePlan(g.encodePlan(makePlan({ city: "" }))).city === "stpete", "a saved day lost its city");
});

check("city: one real city shows no picker and the fixture doesn't count; two real cities show a picker that sets the day's city", () => {
  duo.clockOverride = new Date("2026-10-10T23:30:00-07:00");
  const doc = duo.document;
  const el = (id) => doc.getElementById(id);
  duo.addCity(clone(fixtureFile));
  assert(duo.realCities().map((c) => c.cityId).join() === "stpete" && Object.keys(duo.CITIES).join() === "stpete,qa-pacific", "the fixture counted as a real city");
  duo.setMode("create");
  duo.plan = null;
  duo.fillForm(null);
  assert(el("city-pick").classList.contains("hidden") && el("city-pick").innerHTML === "", "a picker showed for one real city");
  assert(!el("city-fixed").classList.contains("hidden") && el("city-fixed").textContent === "St. Petersburg", "the city label: " + el("city-fixed").textContent);
  // A second real city: a test-only clone with its own ids.
  const second = clone(fixtureFile);
  Object.assign(second, { cityId: "qa-second", city: "Second City (QA only)", short: "Second City", fixture: false });
  second.stops.forEach((s) => { s.id = s.id.replace("qa-pacific", "qa-second"); });
  duo.addCity(second);
  assert(duo.realCities().map((c) => c.cityId).join() === "stpete,qa-second", "real cities: " + duo.realCities().map((c) => c.cityId));
  duo.plan = null;
  duo.fillForm(null);
  const buttons = () => [...doc.querySelectorAll("#city-pick button")];
  assert(el("city-fixed").classList.contains("hidden") && !el("city-pick").classList.contains("hidden"), "the picker isn't showing");
  assert(el("city-pick").getAttribute("role") === "group" && el("city-pick").getAttribute("aria-label") === "City", "the picker isn't a labelled group");
  assert(buttons().map((b) => b.textContent).join("|") === "St. Petersburg|Second City (QA only)", "buttons: " + buttons().map((b) => b.textContent));
  assert(buttons().map((b) => b.getAttribute("aria-pressed")).join() === "true,false" && duo.pickedCityId() === "stpete", "the first city isn't the pick");
  // The date can run from "today" in the picked city's own zone: it is still Oct 10 on the Pacific coast.
  assert(el("date").getAttribute("min") === "2026-10-11" && el("date").getAttribute("max") === "2026-10-14", "St. Pete's dates: " + el("date").getAttribute("min"));
  clickOn(duo, buttons()[1]);
  assert(buttons().map((b) => b.getAttribute("aria-pressed")).join() === "false,true" && duo.pickedCityId() === "qa-second", "the click didn't pick the city");
  assert(el("date").getAttribute("min") === "2026-10-10" && el("date").getAttribute("max") === "2026-10-13", "the dates didn't follow the pick: " + el("date").getAttribute("min"));
  // The form never reads the pick as a drink or a lean.
  assert(!doc.querySelector("#city-pick [data-group], #city-pick [data-value]"), "the picker borrows the form's pill hooks");
  el("you").value = "A"; el("them").value = "B";
  duo.applyPills({ occasion: "Date", drink: "no", lean: "gems" });
  duo.renderKinds("Date", "easy");
  assert(duo.pickedCityId() === "qa-second", "filling the pills moved the city");
  el("budget-amount").value = "120";
  el("date").value = "2026-10-10";
  assert(duo.submitForm() === true && duo.plan.city === "qa-second", "the day's city: " + (duo.plan && duo.plan.city));
  assert(decodeLink(duo.shareUrl()).city === "qa-second" && duo.here().cityId === "qa-second", "the link or the clock didn't follow the city");
  assert(el("desk-top").textContent.includes("A date in Second City for A and B") && el("desk-top").textContent.includes("· Second City (QA only)"), "desk: " + el("desk-top").textContent.slice(0, 160));
  duo.fillForm(duo.plan);
  assert(duo.pickedCityId() === "qa-second" && buttons().map((b) => b.getAttribute("aria-pressed")).join() === "false,true", "Change the day lost the city");
  // Back to St. Pete: the day on the Pacific clock is already past by New York's.
  clickOn(duo, buttons()[0]);
  el("date").value = "2026-10-10";
  assert(duo.submitForm() === false && /today or a date ahead/.test(el("form-err").textContent), "a date before St. Pete's today was accepted");
});

check("city: the fixture file passes the schema, every place has a source and a check date, and the page never loads it on its own", () => {
  const validate = catalogValidator();
  assert(validate(fixtureFile), JSON.stringify(validate.errors && validate.errors.slice(0, 3)));
  assert(fixtureFile.fixture === true && fixtureFile.rainLine === undefined && fixtureFile.cityId === "qa-pacific", "the fixture's config");
  assert(fixtureFile.timeZone === "America/Los_Angeles" && fixtureFile.weather.lat === 44.000 && fixtureFile.weather.lon === -124.500 && fixtureFile.sun.lat === 44.000 && fixtureFile.sun.lon === -124.500, "the fixture's place on the map");
  assert(fixtureFile.stops.map((s) => s.id).join() === "qa-pacific-cafe,qa-pacific-park,qa-pacific-late", "the fixture's places");
  fixtureFile.stops.forEach((s) => {
    assert(/^https:\/\/example\.invalid\//.test(s.source), s.id + " has a real-looking source");
    assert(typeof s.hoursChecked === "string" && g.realDay(s.hoursChecked), s.id + " has no real check date");
    assert(/^QA Fixture /.test(s.name) && s.hint === "Test fixture. Not a real place.", s.id + " could pass for a real place");
    assert(!stopsFile.stops.some((e) => e.id === s.id), s.id + " is also a St. Pete place");
  });
  assert(fixtureFile.cityId !== stopsFile.cityId && fixtureFile.city !== stopsFile.city, "the fixture shares a city with the file");
  assert(fixtureFile.stops[2].week["6"].join() === "17,25" && [0, 1, 2, 3, 4, 5].every((d) => fixtureFile.stops[2].week[d] === null), "the late counter isn't Saturday only");
  // Nothing loads it but a test that asks.
  assert(askedFor.join() === "data/cities.json,data/stops.json,data/kirkland.json", "the page asked for " + askedFor.join(", "));
  [g, plainPage.window].forEach((page) => {
    assert(Object.keys(page.CITIES).join() === "stpete,kirkland" && !page.STOPS.some((s) => /^qa-pacific/.test(s.id)), "a page loaded the fixture on its own");
  });
  assert(!html.includes("qa-fixtures") && (html.match(/addCity\(/g) || []).length === 1, "index.html reaches for another city file");
});

check("city: docs/adding-a-city.md names every config field, source and hoursChecked", () => {
  const fields = Object.keys(stopsSchema.properties).filter((k) => k !== "$schema" && k !== "stops");
  assert(fields.join() === "city,cityId,short,region,regionNames,timeZone,weather,sun,rainLine,fixture", "the schema's fields: " + fields);
  fields.forEach((k) => assert(cityDoc.includes("`" + k + "`"), "the doc doesn't name " + k));
  ["`source`", "`hoursChecked`", "data/<cityId>.json", "data/stops.json", "data/cities.json", "`loadCatalog`"].forEach((word) => assert(cityDoc.includes(word), "the doc doesn't say " + word));
  assert(/`data\/stops\.json` stays first/.test(cityDoc) && /never removed/.test(cityDoc), "the doc doesn't say stops.json comes first and a listed city is never removed");
  assert(!/only real city so far|fetches only|#50/.test(cityDoc), "the doc still has the one-city wording");
  assert(!/no code change/i.test(cityDoc), "the doc says a new city needs no code change");
  assert(/permanent/i.test(cityDoc) && /unique/i.test(cityDoc) && /IANA/.test(cityDoc) && /3 decimals/.test(cityDoc) && /first/i.test(cityDoc), "the doc is missing a rule");
  assert(/19 original places/.test(cityDoc) && /null/.test(cityDoc), "the doc doesn't say who may leave hoursChecked null");
  assert(fs.readFileSync(new URL("./README.md", import.meta.url), "utf8").includes("docs/adding-a-city.md"), "the README doesn't link the doc");
});

// --- #50: Kirkland, the second real city ---

const kirklandIds = kirklandFile.stops.map((e) => e.id);
const stpetePage = (await settled({ fetchList: stpeteOnly })).window;
// What the page does with a day it opens with nothing to answer the weather: asks for the forecast point.
const weatherAddress = (page, plan) => {
  const urls = [];
  const realFetch = page.fetch;
  page.fetch = blocked(urls);
  try {
    resetPhone();
    page.weatherByDate = {};
    page.openDay(plan, { mode: "play" });
  } finally {
    page.fetch = realFetch;
  }
  return urls[0];
};
const pointOf = (file) => file.weather.lat.toFixed(3) + "," + file.weather.lon.toFixed(3);

check("kirkland: data/cities.json lists data/stops.json first, then data/kirkland.json, and nothing from qa-fixtures", () => {
  const raw = fs.readFileSync(new URL("./data/cities.json", import.meta.url), "utf8").trim();
  assert(raw[0] === "[" && Array.isArray(citiesFile), "the list isn't a bare array");
  assert(citiesFile[0] === "data/stops.json" && citiesFile[1] === "data/kirkland.json", "the list starts " + citiesFile.slice(0, 2));
  assert(new Set(citiesFile).size === citiesFile.length, "a path is listed twice");
  citiesFile.forEach((f) => {
    assert(typeof f === "string" && /^data\/[a-z][a-z0-9-]*\.json$/.test(f), f + " isn't a data/<name>.json path");
    assert(!/qa-|fixture/i.test(f), f + " is a test-only file");
    assert(fs.existsSync(new URL("./" + f, import.meta.url)), f + " isn't there");
  });
});

check("kirkland: data/kirkland.json passes data/stops.schema.json, its cityId is kirkland, and its time zone is real", () => {
  const validate = catalogValidator();
  assert(validate(kirklandFile), JSON.stringify((validate.errors || []).slice(0, 3)));
  assert(kirklandFile.cityId === "kirkland" && kirklandFile.fixture === undefined, "the config says " + kirklandFile.cityId);
  assert(typeof kirklandFile.timeZone === "string" && Intl.supportedValuesOf("timeZone").includes(kirklandFile.timeZone), "the time zone isn't a real one: " + kirklandFile.timeZone);
  new Intl.DateTimeFormat("en-US", { timeZone: kirklandFile.timeZone });
  const city = g.CITIES.kirkland;
  assert(city && city.name === kirklandFile.city && city.timeZone === kirklandFile.timeZone && city.fixture === false, "the page didn't read the file's config");
  assert(g.realCities().map((c) => c.cityId).join() === "stpete,kirkland", "real cities: " + g.realCities().map((c) => c.cityId));
  assert(new Set(kirklandIds).size === kirklandIds.length && !kirklandIds.some((id) => stopsFile.stops.some((e) => e.id === id)), "a Kirkland id repeats or is a St. Pete id");
  g.STOPS.filter((s) => kirklandIds.includes(s.id)).forEach((s) => assert(s.city === "kirkland", s.id + " isn't a Kirkland place"));
  assert(kirklandFile.stops.every((e) => e.city === undefined) && g.STOPS.filter((s) => kirklandIds.includes(s.id)).length === kirklandIds.length, "a Kirkland place is missing or was changed in place");
});

check("kirkland: every place has an https source and a real hoursChecked date, never null", () => {
  kirklandFile.stops.forEach((e) => {
    assert(/^https:\/\/[^\s/]+\.[^\s/]+/.test(e.source || ""), e.id + " has no https source");
    assert(typeof e.hoursChecked === "string" && g.realDay(e.hoursChecked), e.id + " has no real check date: " + e.hoursChecked);
  });
});

check("kirkland: each feel (taste, drift, dig, soft) has at least 6 places not tagged museum, and every weekday has one open", () => {
  const everyday = (f) => kirklandFile.stops.filter((e) => e.feel === f && !e.bar && !e.booking && !e.openDates && !e.months && (e.tags || []).indexOf("museum") === -1);
  ["taste", "drift", "dig", "soft"].forEach((f) => {
    const list = everyday(f);
    assert(list.length >= 6, f + " has only " + list.length + " everyday places");
    for (let day = 0; day <= 6; day++) {
      assert(list.some((e) => e.week[String(day)]), f + " has nothing open on weekday " + day);
    }
  });
  // A cheap, a mid and a nice dinner, each open into the evening on a weekday.
  ["cheap", "mid", "nice"].forEach((band) => {
    const dinners = kirklandFile.stops.filter((e) => e.dinner === true && e.costBand === band && !e.bar && [1, 2, 3, 4, 5].some((d) => e.week[String(d)] && e.week[String(d)][1] >= 20));
    assert(dinners.length >= 1, "no " + band + " dinner open to 8pm on a weekday");
  });
});

check("kirkland: picking Kirkland on the create screen builds a Kirkland-only day; not picking it builds the same St. Pete deck", () => {
  const buttons = () => [...document.querySelectorAll("#city-pick button")];
  const brief = (date, must) => ({ you: "A", them: "B", occasion: "Date", kind: "easy", lean: "gems", drink: "no", budgetAmount: "40", must, date, allergy: false });
  // The form only takes a date up to three days after the city's today.
  const fillAndSend = (pickKirkland, date, must) => {
    resetPhone();
    g.clockOverride = new Date(date === "2026-10-13" ? "2026-10-10T12:00:00-07:00" : PINNED);
    g.setMode("create");
    g.plan = null;
    g.fillForm(null);
    assert(buttons().map((b) => b.textContent).join("|") === "St. Petersburg|Kirkland", "buttons: " + buttons().map((b) => b.textContent));
    if (pickKirkland) clickOn(g, buttons()[1]);
    assert(g.pickedCityId() === (pickKirkland ? "kirkland" : "stpete"), "the pick didn't take");
    $("you").value = "A"; $("them").value = "B";
    g.applyPills({ occasion: "Date", drink: "no", lean: "gems" });
    g.renderKinds("Date", "easy");
    $("budget-amount").value = "40";
    $("date").value = date;
    $("must").value = must;
    assert(g.submitForm() === true, "the form said: " + $("form-err").textContent);
    return g.plan;
  };
  try {
    for (const date of ["2026-10-10", "2026-10-13"]) {
      for (const must of ["", "no museums"]) {
        const label = date + " " + JSON.stringify(must) + ": ";
        const day = fillAndSend(true, date, must);
        assert(day.city === "kirkland" && decodeLink(g.shareUrl()).city === "kirkland" && g.here().cityId === "kirkland", label + "the day isn't Kirkland's");
        const ids = deckPlaceIds(day.deck);
        assert(ids.length > 0 && ids.every((id) => kirklandIds.includes(id)), label + "a place from somewhere else: " + ids);
        assert(g.POOL_MAX === 6, "the mood cap from #62 isn't on this page");
        Object.entries(day.deck.pools).forEach(([feel, list]) => assert(list.length >= 1 && list.length <= g.POOL_MAX, label + feel + " has " + list.length + " places"));
        ids.forEach((id) => assert(g.STOP_BY_ID[id].isOpen(g.parseDate(date), date), label + id + " is closed that day"));
        assert(day.deck.park === false && day.deck.anchor.type === "none", label + "a Kirkland day got parking or a dinner it wasn't asked for: " + JSON.stringify(day.deck.anchor));
        assert(weatherAddress(g, day) === "https://api.weather.gov/points/" + pointOf(kirklandFile), label + "weather address " + weatherAddress(g, day));
        const same = fillAndSend(false, date, must);
        assert(same.city === "stpete" && decodeLink(g.shareUrl()).city === "stpete", label + "the day isn't St. Pete's");
        assert(JSON.stringify(same.deck) === JSON.stringify(g.buildDeck(makePlan(brief(date, must)))), label + "the St. Pete deck changed with Kirkland loaded");
        assert(!deckPlaceIds(same.deck).some((id) => kirklandIds.includes(id)), label + "a Kirkland place came up in St. Pete");
        assert(weatherAddress(g, same) === STPETE_BEFORE.weatherUrl, label + "St. Pete weather address");
      }
    }
  } finally {
    resetPhone();
  }
  // Kirkland's own clock: 11:30pm there is still Oct 10, and 2:30am Oct 11 in St. Pete's.
  g.clockOverride = new Date("2026-10-10T23:30:00-07:00");
  assert(g.cityNow(g.CITIES.kirkland).iso === "2026-10-10" && g.cityNow(g.CITIES.stpete).iso === "2026-10-11", "the clocks");
  g.clockOverride = PINNED;
});

check("kirkland: old #play/ links still open as St. Pete with their frozen decks while Kirkland is loaded", () => {
  assert(g.CITIES.kirkland && g.DEFAULT_CITY === "stpete", "Kirkland isn't loaded, or isn't second");
  OLD_LINKS.forEach((link) => {
    const encoded = link.hash.replace(/^#(?:play\/)?/, "");
    const old = g.decodePlan(encoded);
    assert(old && old.city === "stpete", link.built + ": opens in " + (old && old.city));
    const raw = decodeLink(link.hash).deck;
    if (raw) assert(JSON.stringify(deckPlaceIds(old.deck).sort()) === JSON.stringify(deckPlaceIds(raw).sort()), link.built + ": the frozen deck changed");
    assert(JSON.stringify(old.deck) === JSON.stringify(stpetePage.decodePlan(encoded).deck), link.built + ": a different deck than a St. Pete-only page reads");
    resetPhone();
    sunny("2026-10-10");
    openLink(link.hash);
    assert(g.mode === "play" && g.plan && g.plan.city === "stpete" && /· St\. Petersburg/.test(playText()), link.built + ": didn't open as St. Pete");
    if (raw) assert(JSON.stringify(g.plan.deck) === JSON.stringify(old.deck), link.built + ": the opened deck isn't the frozen one");
    deckPlaceIds(g.plan.deck || { anchor: null, pools: {} }).forEach((id) => assert(!kirklandIds.includes(id), link.built + ": reaches into Kirkland: " + id));
  });
  resetPhone();
});

// A page that is told the list or a file is wrong, and what is left of it.
async function brokenKirkland(options) {
  const phone = savedDay();
  const before = JSON.stringify(phone);
  const page = await settled(Object.assign({ hash: linkOnPhone, store: phone }, options));
  return { page, phone, before };
}

const kirklandBroken = {
  "Kirkland's file is missing": { fetchKirkland: replies({ ok: false, status: 404, json: () => Promise.resolve({}) }) },
  "Kirkland's request fails": { fetchKirkland: offline },
  "Kirkland's file isn't JSON": { fetchKirkland: replies({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("Unexpected token <")) }) },
  "Kirkland's file has no places": { fetchKirkland: replies({ ok: true, status: 200, json: () => Promise.resolve(Object.assign(clone(kirklandFile), { stops: [] })) }) },
  "Kirkland has no time zone": { fetchKirkland: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(Object.assign(clone(kirklandFile), { timeZone: undefined })) }) },
  "Kirkland's time zone isn't a real one": { fetchKirkland: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(Object.assign(clone(kirklandFile), { timeZone: "Mars/Olympus_Mons" })) }) },
  "one Kirkland place can't be read": { fetchKirkland: () => { const f = clone(kirklandFile); delete f.stops[3].week; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(f) }); } },
  "a Kirkland id is in its file twice": { fetchKirkland: () => { const f = clone(kirklandFile); f.stops[1].id = f.stops[0].id; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(f) }); } },
  "Kirkland has a St. Pete place's id": { fetchKirkland: () => { const f = clone(kirklandFile); f.stops[0].id = "kahwa"; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(f) }); } },
  "Kirkland has St. Pete's city id": { fetchKirkland: () => { const f = clone(kirklandFile); f.cityId = "stpete"; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(f) }); } },
  "Kirkland has St. Pete's city name": { fetchKirkland: () => { const f = clone(kirklandFile); f.city = "St. Petersburg"; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(f) }); } },
  "the list's request fails": { fetchList: offline },
  "the list is missing": { fetchList: replies({ ok: false, status: 404, json: () => Promise.resolve([]) }) },
  "the list isn't JSON": { fetchList: replies({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("Unexpected token <")) }) },
  "the list is empty": { fetchList: reply([]) },
  "the list isn't a list": { fetchList: reply({ files: ["data/stops.json"] }) },
  "the list has a path that isn't a city file": { fetchList: reply(["data/stops.json", "../elsewhere.json"]) },
  "the list has a web address": { fetchList: reply(["data/stops.json", "https://example.com/data/kirkland.json"]) },
  "the list has a path in a folder": { fetchList: reply(["data/stops.json", "data/qa/kirkland.json"]) },
  "the list has a path in capitals": { fetchList: reply(["data/stops.json", "data/Kirkland.json"]) },
  "the list has something that isn't a path": { fetchList: reply(["data/stops.json", 7]) },
  "the list names a file twice": { fetchList: reply(["data/stops.json", "data/kirkland.json", "data/stops.json"]) }
};
const askedStray = [];
await settled({ asked: askedStray, fetchList: reply(["data/stops.json", "../elsewhere.json"]) });
const kirklandBrokenPages = {};
for (const [why, options] of Object.entries(kirklandBroken)) kirklandBrokenPages[why] = await brokenKirkland(options);

check("kirkland: a bad Kirkland file or a bad cities list fails the load like a bad St. Pete file, and changes nothing", () => {
  assert(Object.keys(kirklandBrokenPages).length >= 20, "too few broken cases");
  for (const [why, { page, phone, before }] of Object.entries(kirklandBrokenPages)) {
    const w = page.window, doc = page.document;
    const text = doc.getElementById("play").textContent;
    assert(w.STOPS.length === 0 && Object.keys(w.STOP_BY_ID).length === 0 && Object.keys(w.CITIES).length === 0 && w.CATALOG === null && w.DEFAULT_CITY === null, why + ": some places or cities loaded anyway (St. Pete too?)");
    assert(w.plan === null && w.mode === "play", why + ": a day was built");
    assert(/Hmm/.test(text) && /The places didn't load\./.test(text) && /Your link is fine\. Nothing in it has changed\./.test(text), why + ": " + text);
    assert(doc.querySelector('#play [role="alert"]') && doc.getElementById("catalog-retry"), why + ": not announced, or no way to try again");
    assert(!doc.getElementById("loading"), why + ": still says loading");
    assert(page.writes.replaceState === 0 && page.locationState.hash === linkOnPhone, why + ": touched the link");
    assert(JSON.stringify(phone) === before, why + ": wrote to the phone's storage");
  }
  // A bad list asks for no city file at all, and a bad path is never fetched.
  assert(askedStray.join() === "data/cities.json", "asked for " + askedStray);
  // readCity also takes the cities read earlier in the same load, which aren't saved yet.
  const earlier = stpetePage.readCity(clone(kirklandFile));
  const state = () => stpetePage.STOPS.length + "|" + Object.keys(stpetePage.CITIES) + "|" + Object.keys(stpetePage.STOP_BY_ID).length;
  const was = state();
  assert(earlier.city.cityId === "kirkland" && was === stopsFile.stops.length + "|stpete|" + stopsFile.stops.length, "reading a city saved it");
  const renamed = (change) => {
    const f = clone(kirklandFile);
    Object.assign(f, { cityId: "elsewhere", city: "Elsewhere (QA only)" });
    f.stops.forEach((e) => { e.id = "elsewhere-" + e.id; });
    change(f);
    return throwsError(() => stpetePage.readCity(f, [earlier]));
  };
  assert(throwsError(() => stpetePage.readCity(clone(kirklandFile), [earlier])), "the same city twice was accepted");
  assert(!renamed(() => {}), "a different city read earlier shouldn't block");
  assert(renamed((f) => { f.city = kirklandFile.city; }), "a city name that an earlier file has was accepted");
  assert(renamed((f) => { f.cityId = kirklandFile.cityId; }), "a city id that an earlier file has was accepted");
  assert(renamed((f) => { f.stops[4].id = kirklandIds[4]; }), "a stop id that an earlier file has was accepted");
  assert(state() === was, "reading a city changed the page");
});

check("kirkland: drinks stay opt-in: every bar, brewery, winery or taproom is marked bar", () => {
  const drinky = /\b(?:bar|brewery|brewing|winery|taproom|tap room|cidery|distillery|tavern|pub|beer garden|cocktails?)\b/i;
  const pastryBar = /croissant bar/i;
  const sells = kirklandFile.stops.filter((e) => drinky.test((e.tags || []).join(" ")) || (drinky.test(e.name) && !pastryBar.test(e.name)));
  assert(sells.length >= 1, "no drinking place to check");
  sells.forEach((e) => assert(e.bar === true && g.STOP_BY_ID[e.id].bar === true, e.id + " serves drinks but isn't marked bar"));
  // A day that said no to drinks never offers one, on any day of the week or for any note.
  for (const date of ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]) {
    for (const must of ["", "beer, drinks, brewery", "coffee, tacos, art, walking, music"]) {
      const deck = deckOf({ city: "kirkland", date, must, drink: "no", kind: "celebrate", budgetAmount: "300" });
      deckPlaceIds(deck).forEach((id) => assert(!g.STOP_BY_ID[id].bar, date + " " + must + ": a bar came up on a no-drinks day: " + id));
    }
  }
  const yes = deckOf({ city: "kirkland", date: "2026-10-10", must: "", drink: "yes", budgetAmount: "300" });
  assert(deckPlaceIds(yes).every((id) => kirklandIds.includes(id)), "a yes-drinks Kirkland day left Kirkland");
});

check("kirkland: the arts center gallery is closed between the exhibitions its page lists (#50)", () => {
  const gallery = g.STOP_BY_ID["kirkland-arts-center-gallery"];
  const open = (iso) => gallery.isOpen(g.parseDate(iso), iso);
  assert(!open("2026-10-14") && !open("2026-11-21"), "open between exhibitions");
  assert(open("2026-10-17"), "closed during Northwest Designer Craft Artists");
  const raw = kirklandFile.stops.find((e) => e.id === "kirkland-arts-center-gallery");
  assert(raw.closedDates.length === 0 && raw.skipDates.join() === ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-11-21", "2026-11-22"].concat(Array.from({ length: 10 }, (_, i) => "2026-12-" + (22 + i))).join(), "the gaps: " + raw.skipDates);
});

check("kirkland: Parklane's posted hours right now are 11am to 6pm (#50)", () => {
  const raw = kirklandFile.stops.find((e) => e.id === "kirkland-parklane-gallery");
  assert(raw.week["6"].join() === "11,18", "Saturday is " + raw.week["6"]);
  assert(raw.hoursText.includes("11am \u2013 6pm") && raw.hoursText.includes("April 1"), "hoursText: " + raw.hoursText);
  assert(raw.hoursChecked === "2026-10-13", "checked " + raw.hoursChecked);
});

check("city: in a second city, a place you pass on comes back (#62)", () => {
  fx.clockOverride = fxNoon;
  fx.weatherByDate = {};
  // The day is already over in the fixture's own clock, so no hours filter and no day-early guard.
  const p = fxPlan({ id: "fx62", date: "2026-10-03", must: "coffee, walking" });
  p.deck = fx.buildDeck(p);
  const feel = fx.FEEL_ORDER.find((f) => (p.deck.pools[f] || []).length >= 2);
  assert(feel, "the fixture has no feeling with two places in the deck: " + JSON.stringify(p.deck.pools));
  const fileIds = fixtureFile.stops.filter((s) => s.feel === feel).map((s) => s.id);
  assert(p.deck.pools[feel].length >= 2 && p.deck.pools[feel].every((id) => fileIds.includes(id)), "a place from outside the fixture file is in the pool: " + p.deck.pools[feel]);
  const wanted = p.deck.pools[feel].slice();
  fx.weatherByDate = { [p.date]: { status: "ready", name: "Saturday", temp: "60°F", wind: "5 mph W", short: "Sunny", wet: false, fetchedAt: Date.now() } };
  fx.openDay(p, { mode: "play" });
  assert(!fx.beforePlanDay() && fx.offered(feel).length === wanted.length, "setup: " + fx.offered(feel));
  fx.act("begin");
  fx.act("feel", feel);
  const seen = [];
  for (let i = 0; i < wanted.length; i++) {
    fx.act("reveal");
    seen.push(fx.view.pending);
    fx.act("pass", fx.view.pending);
  }
  assert(new Set(seen).size === wanted.length, "a place showed twice before each had shown once: " + seen);
  assert(fx.playState().skip.length === 0 && fx.playState().passed.join() === seen.join(), "passed: " + fx.playState().passed);
  assert(fx.view.panel === "commit" && fx.view.pending === seen[0], "the passed place didn't come back: " + fx.view.pending);
  fx.act("reveal");
  fx.act("here", fx.view.pending);
  assert(fx.playState().trail.length === 1, "We're here in the second city didn't log");
});

check("play: passing and shuffling name no place, mood or category (#62)", () => {
  const stops = JSON.parse(fs.readFileSync(new URL("./data/stops.json", import.meta.url), "utf8")).stops.concat(fixtureFile.stops);
  const words = new Set();
  stops.forEach((s) => {
    [s.id, s.feel, s.meal, s.costBand, s.menuFocus].concat(s.tags || []).forEach((w) => { if (typeof w === "string" && w) words.add(w.toLowerCase()); });
  });
  g.FEEL_ORDER.concat(Object.keys(g.FEELS), ["surprise"]).forEach((w) => words.add(w));
  assert(words.size > 40 && words.has(g.FEEL_ORDER[0]), "setup: too few words to scan for: " + words.size);
  [g.moodQueue, g.passHere, g.shuffleFeel].forEach((fn) => {
    assert(typeof fn === "function", "a function to scan is missing");
    const source = fn.toString();
    const quoted = [...source.matchAll(/(["'])((?:(?!\1)[^\\\n])*)\1/g)].map((m) => m[2].toLowerCase());
    const hits = quoted.filter((q) => words.has(q));
    assert(!hits.length, fn.name + " names " + hits.join(", "));
  });
});

const failed = results.filter((r) => r.startsWith("FAIL"));
console.log("\n--- summary ---");
console.log(results.length - failed.length + " passed, " + failed.length + " failed");
if (failed.length) process.exit(1);
console.log("All QA checks passed.");
