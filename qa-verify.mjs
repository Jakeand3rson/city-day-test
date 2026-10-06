import fs from "fs";
import { parseHTML } from "linkedom";
import vm from "vm";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const { window, document } = parseHTML(html);

const store = {};
const locationState = {
  hash: "",
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
  g.clockOverride = null;
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

check("note: 'no seafood' keeps Stillwaters off the day", () => {
  const deck = deckOf({ must: "pasta, no seafood", kind: "celebrate", budgetAmount: "300" });
  assert(!allIds(deck).includes("stillwaters") && deck.anchor.id !== "stillwaters", JSON.stringify(deck));
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
  const p = makePlan({ anchor: { name: "Dinner at Beso", time: "17:45", where: "30 S Lemon Ave, Sarasota" } });
  const deck = g.buildDeck(p);
  assert(deck.anchor.type === "custom" && deck.anchor.time === 17.75 && deck.anchor.leave === 17.25, JSON.stringify(deck.anchor));
  g.plan = p; p.deck = deck;
  const line = g.anchorLine();
  assert(/Dinner at Beso at 5:45pm\. Leave by about 5:15pm/.test(line), line);
});

check("sunset: about 7:10pm on October 10", () => {
  const h = g.sunsetHour(g.parseDate("2026-10-10"));
  assert(h > 19.0 && h < 19.35, "sunset hour " + h);
});

// --- the link ---

check("link: the deck rides in the link and survives a weather change", () => {
  const p = makePlan({ must: "coffee, art, dinner", kind: "celebrate", budgetAmount: "300" });
  p.deck = g.buildDeck(p);
  const back = g.decodePlan(g.encodePlan(p));
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

// --- the play loop ---

check("play: curtain, then feelings, then one hidden pick, then one reveal", () => {
  startPlay({ must: "coffee, walking, vintage records", you: "Jake", them: "Sam" });
  assert(/For Jake and Sam\./.test(playText()), "curtain names");
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

check("play: Not this, try again swaps in another from the same feeling", () => {
  startPlay({ date: "2026-10-10", must: "coffee, gelato, market" });
  g.act("begin");
  g.act("feel", "taste");
  g.act("reveal");
  const first = g.view.pending;
  g.act("skip", first);
  assert(g.playState().skip.includes(first), "skip saved");
  assert(g.view.pending !== first, "new pick");
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
  g.act("here", "bellabrava");
  assert(!/Real dinner/.test(playText()), "anchor not offered twice");
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
  const before = g.liveIds();
  const target = before[0];
  const feel = g.STOP_BY_ID[target].feel;
  g.plan.skip.push(target);
  g.plan.deck = g.buildDeck(g.plan);
  assert(!g.liveIds().includes(target), "removed");
  assert(!g.plan.deck.pools[feel].includes(target), "rebuilt without it");
});

check("desk: wet weather line counts real indoor picks, names none", () => {
  wet(g.plan.date);
  const line = g.weatherLine(g.plan.date);
  assert(/indoor picks are on the day/.test(line) && !/Dal[ií]|MFA/.test(line), line);
});

check("desk: Play it here, then Back to your desk", () => {
  locationState.hash = "#play/" + g.encodePlan(g.plan);
  g.boot();
  assert(g.mode === "play", "play after hash change");
  assert(/Back to your desk/.test(playText()), "desk link for the creator");
  locationState.hash = "";
  locationState.search = "?create";
  g.boot();
  assert(g.mode === "create", "desk again");
  assert(locationState.search === "", "?create stripped, so Play it here works next time");
  locationState.hash = "#play/" + g.encodePlan(g.plan);
  g.boot();
  assert(g.mode === "play", "play works again");
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
  $("date").value = "2030-01-05";
  $("anchor-name").value = "Dinner";
  assert(g.submitForm() === false && /already set/.test($("form-err").textContent), "anchor without time");
  $("anchor-time").value = "18:30";
  assert(g.submitForm() === true, "valid form");
  assert(g.plan.deck.anchor.type === "custom", "anchor saved");
});

const failed = results.filter((r) => r.startsWith("FAIL"));
console.log("\n--- summary ---");
console.log(results.length - failed.length + " passed, " + failed.length + " failed");
if (failed.length) process.exit(1);
console.log("All QA checks passed.");
