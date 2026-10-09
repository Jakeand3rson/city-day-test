import fs from "fs";
import { parseHTML } from "linkedom";
import vm from "vm";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const { window, document } = parseHTML(html);

const store = {};
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

// Node 21+ has a getter-only global `navigator`, so it is not assigned here.
Object.assign(window, {
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  },
  history: { replaceState(_a, _b, url) { applyUrl(url); } },
  scrollTo() {},
  location: locationState,
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  fetch: async () => { throw new Error("network blocked in QA"); },
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

const g = window;
const $ = (id) => document.getElementById(id);

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
  const early = (name === "here" || name === "skip") && g.plan && !g.keepEarlyClock && g.nowNY().iso < g.plan.date;
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
    city: "St. Petersburg",
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

check("deck: up to 3 per feeling, no repeats, anchor not in pools, all open that date", () => {
  for (const date of ["2026-10-10", "2026-10-13", "2026-10-17", "2027-03-06"]) {
    const deck = deckOf({ date, must: "coffee, tacos, art, walking, music", kind: "celebrate", budgetAmount: "300" });
    const ids = allIds(deck);
    assert(new Set(ids).size === ids.length, date + " repeats: " + ids);
    Object.values(deck.pools).forEach((list) => assert(list.length <= 3, date + " pool too big"));
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
  const h = g.sunsetHour(g.parseDate("2026-10-10"));
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
  { built: "9e0a8a4, a frozen deck with a picked dinner, from an allergy note (no dinner alternates, no allergy flag)", hash: "#play/eyJpZCI6Im9sZGxpbmszMSIsInlvdSI6IkFsZXgiLCJ0aGVtIjoiUmlsZXkiLCJvY2Nhc2lvbiI6IkRhdGUiLCJraW5kIjoiY2VsZWJyYXRlIiwiZGF0ZSI6IjIwMjYtMTAtMTAiLCJkcmluayI6Im5vIiwibGVhbiI6Im11c3QiLCJkZWNrIjp7InYiOjEsImFuY2hvciI6eyJ0eXBlIjoic3RvcCIsImlkIjoiYmVsbGFicmF2YSIsInRpbWUiOjE4LCJsZWF2ZSI6MTcuNX0sInBvb2xzIjp7InRhc3RlIjpbIm1hcmtldCIsImNhZmUtY2xlbWVudGluZSIsInBhY2l1Z28iXSwiZHJpZnQiOlsiZmVzdGl2YWwiLCJzdW5rZW4tZ2FyZGVucyIsIm5vcnRoLXN0cmF1Yi1wYXJrIl0sImRpZyI6WyJwdW1wa2luIiwiZmxvcmlkYS1jcmFmdGFydCIsImNvYXN0YWwtaG91c2UtdmludGFnZSJdLCJzb2Z0IjpbInBhbGVob3JzZSIsImphbWVzLW11c2V1bSIsInN0LXBldGUtbXVzZXVtLW9mLWhpc3RvcnkiXX0sInBhcmsiOmZhbHNlfX0" }
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
    g.act("skip", id);
    assert(g.playState().skip.length === 0 && g.view.pending === id, "early Not this skipped " + g.playState().skip);
    g.clockOverride = new Date("2026-10-10T09:00:00-04:00");
    g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
    assert(g.playState().trail.length === 0 && g.playState().skip.length === 0, "the early taps carried onto Saturday");
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
  g.act("skip", first);
  assert(g.playState().skip.includes(first), "skip saved");
  assert(g.view.panel === "commit" && g.view.pending && g.view.pending !== first, "panel " + g.view.panel + " pending " + g.view.pending);
  assert(g.plan.deck.pools.taste.includes(g.view.pending), "replacement from the same feeling");
});

check("play: Not this says another place is lined up, and that place stays off", () => {
  startPlay({ date: "2026-10-10", must: "coffee, gelato, market" });
  g.act("begin");
  g.act("feel", "taste");
  g.act("reveal");
  const first = g.view.pending;
  const before = playText();
  g.act("skip", first);
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
    g.act("skip", id);
    guard++;
  }
  assert(g.playState().skip.includes(first) && !g.offered("taste").includes(first), "offered again: " + g.offered("taste"));
  g.openDay(g.decodePlan(g.encodePlan(g.linkPlan(g.plan))), { mode: "play" });
  g.act("begin");
  g.act("feel", "taste");
  assert(g.playState().skip.includes(first) && !g.offered("taste").includes(first), "came back after reload");
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
  assert(g.plan.deck.pools.taste.length === 3, "precondition: a full taste pool");
  click($("desk-top").querySelector('[data-desk-skip="' + target + '"]'));
  assert(!g.liveIds().includes(target), "removed");
  assert(g.plan.deck.pools.taste.length === 3 && !g.plan.deck.pools.taste.includes(target), "the next place stepped in: " + g.plan.deck.pools.taste);
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
  g.act("skip", g.view.pending);
  g.act("reveal");
  g.act("here", g.view.pending);
  assert(g.playState().trail.length === 1, "preview trail recorded");
  locationState.hash = "";
  locationState.search = "?create=" + encodeURIComponent(p.id);
  g.boot();
  assert(JSON.stringify(g.liveIds()) === JSON.stringify(before), "desk changed after preview: " + g.liveIds());
  openLink("#play/" + enc);
  assert(g.view.panel === "curtain" && g.playState().trail.length === 0 && g.playState().skip.length === 0, "real day starts clean");
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
  g.clockOverride = new Date("2026-10-10T17:40:00-04:00");
  g.act("reveal");
  assert(g.view.panel === "feel" && !g.view.pending, "panel " + g.view.panel + " pending " + g.view.pending);
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
  assert(!/Museum of Fine Arts|The Dalí Museum/.test(playText()), "lists places that open at 10");
  g.clockOverride = new Date("2026-10-13T10:30:00-04:00");
  g.act("back");
  g.act("iffy");
  assert(/Museum of Fine Arts|The Dalí Museum/.test(playText()), "at 10:30 the museums are open");
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
  assert(Math.abs(park.start(oct) - (g.sunriseHour(oct) - 0.5)) < 0.1, "opens 30 min before sunrise: " + park.start(oct));
  assert(Math.abs(park.end(oct) - (g.sunsetHour(oct) + 0.5)) < 0.1, "closes 30 min after sunset: " + park.end(oct));
  assert(park.end(jan) < park.end(oct), "closes earlier in winter");
  assert(/opens 30 min before sunrise, closes 30 min after sunset/.test(park.hours(oct)), park.hours(oct));
  // Published times for St. Pete (sunrise-sunset.org), including both DST switch days.
  const published = [["2026-10-10", "07:26", "19:08"], ["2026-11-01", "06:40", "17:47"], ["2026-12-21", "07:15", "17:41"],
    ["2027-03-14", "07:39", "19:39"], ["2027-06-21", "06:34", "20:30"]];
  const hrs = (t) => Number(t.slice(0, 2)) + Number(t.slice(3)) / 60;
  for (const [iso, rise, set] of published) {
    const d = g.parseDate(iso);
    assert(Math.abs(g.sunriseHour(d) - hrs(rise)) <= 3 / 60, iso + " sunrise " + g.fmtHour(g.sunriseHour(d)) + ", published " + rise);
    assert(Math.abs(g.sunsetHour(d) - hrs(set)) <= 3 / 60, iso + " sunset " + g.fmtHour(g.sunsetHour(d)) + ", published " + set);
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
  for (const e of g.PLACES) {
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
  for (const e of g.PLACES) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(e.hoursChecked || ""), e.id + " has no hoursChecked date");
    for (let k = 0; k < 7; k++) {
      const w = e.week[String(k)];
      assert(w === null || (Array.isArray(w) && w.length === 2 && w[0] < w[1] && w[0] >= 0 && w[1] <= 28), e.id + " bad hours on day " + k);
    }
  }
});

check("catalog: the new places cover drift, cheap meals, coffee and dessert, kids, and rainy days", () => {
  const added = g.PLACES;
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
  for (const e of g.PLACES) {
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
        const h = g.nowNY().hour;
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
    const stop = g.weekStop(Object.assign({}, base, { closedDates: closedDates }));
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
  assert(JSON.stringify(g.cleanDeck(raw).anchor.alts) === JSON.stringify(["baba-on-central", "la-v-vietnamese"]), JSON.stringify(g.cleanDeck(raw).anchor));
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

const failed = results.filter((r) => r.startsWith("FAIL"));
console.log("\n--- summary ---");
console.log(results.length - failed.length + " passed, " + failed.length + " failed");
if (failed.length) process.exit(1);
console.log("All QA checks passed.");
