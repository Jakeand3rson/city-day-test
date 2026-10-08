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
    const deck = deckOf({ must, kind: "celebrate", budgetAmount: "250" });
    assert(deck.anchor.id !== "stillwaters" && !allIds(deck).includes("stillwaters"), must + " -> " + JSON.stringify(deck.anchor));
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
  g.act("here", "bellabrava");
  g.act("cool");
  assert(/Dinner's done/.test(playText()) && !/No fixed point/.test(playText()), playText().slice(0, 200));
  g.act("back");
  assert(/Dinner: done\./.test(playText()) && !/Leave by/.test(playText()), "strip");
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
  creatorDesk({ must: "Nice dinner somewhere. No seafood, no mexican.", kind: "celebrate", budgetAmount: "120" });
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
  assert(!/\d{3}[-. ]\d{3}[-. ]\d{4}/.test(fs.readFileSync(new URL("./index.html", import.meta.url), "utf8")), "a phone number in the page");
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
    const deck = deckOf({ must, kind: "celebrate", budgetAmount: "300" });
    assert(deck.anchor.id !== "stillwaters" && !allIds(deck).includes("stillwaters"), must + " -> " + JSON.stringify(deck.anchor));
  }
  const terms = g.avoidTerms(makePlan({ must: "nut allergy, she's gluten-free, no dairy" }));
  assert(terms.includes("nuts") && terms.includes("gluten") && terms.includes("dairy"), JSON.stringify(terms));
  // Still the same as before:
  assert(!allIds(deckOf({ must: "she hates museums. walking", date: "2026-10-13" })).includes("dali"), "hates museums");
  assert(deckOf({ must: "She's never been to the Dali, so that's a must.", kind: "celebrate", budgetAmount: "250" }).pools.soft.includes("dali"), "never been");
  assert(deckOf({ must: "He doesn't eat seafood so let's do tacos", date: "2026-10-13", budgetAmount: "120" }).anchor.id === "bodega", "so tacos");
  assert(deckOf({ must: "no seafood, dinner", kind: "celebrate", budgetAmount: "300" }).anchor.id !== "stillwaters", "no seafood");
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
    const deck = deckOf({ must, kind: "celebrate", budgetAmount: "300" });
    assert(deck.anchor.id !== "stillwaters" && !allIds(deck).includes("stillwaters"), must + " -> " + JSON.stringify(deck.anchor));
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
  g.act("here", "bellabrava");
  assert(/Tell Jake how it went/.test(playText()), "missing after dinner");
  click($("play").querySelector('.btn[data-act="trail"]'));
  assert(g.view.panel === "trail" && $("play").querySelector('[data-act="feedback"]'), "goes to the feedback");
});

const failed = results.filter((r) => r.startsWith("FAIL"));
console.log("\n--- summary ---");
console.log(results.length - failed.length + " passed, " + failed.length + " failed");
if (failed.length) process.exit(1);
console.log("All QA checks passed.");
