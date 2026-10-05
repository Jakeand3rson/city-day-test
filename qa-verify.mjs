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

Object.assign(window, {
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  },
  history: {
    replaceState(_a, _b, url) {
      if (typeof url === "string") {
        if (url.startsWith("#")) {
          locationState.hash = url;
        } else if (url.includes("#")) {
          const i = url.indexOf("#");
          locationState.hash = url.slice(i);
          const before = url.slice(0, i);
          const q = before.indexOf("?");
          if (q >= 0) {
            locationState.pathname = before.slice(0, q) || locationState.pathname;
            locationState.search = before.slice(q);
          } else if (before) {
            locationState.pathname = before;
            locationState.search = "";
          }
        } else {
          locationState.hash = "";
          const q = url.indexOf("?");
          if (q >= 0) {
            locationState.pathname = url.slice(0, q) || locationState.pathname;
            locationState.search = url.slice(q);
          } else {
            locationState.pathname = url || locationState.pathname;
            locationState.search = "";
          }
        }
        locationState.href = locationState.origin + locationState.pathname + locationState.search + locationState.hash;
      }
    }
  },
  scrollTo() {},
  navigator: { clipboard: null },
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

const scripts = [...document.querySelectorAll("script")].map((s) => s.textContent).filter(Boolean);
const scriptBody = scripts.join("\n;\n");
vm.createContext(window);
vm.runInContext(scriptBody, window);

const g = window;

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
    date: "2026-10-11",
    city: "St. Petersburg",
    drink: "no",
    style: "mystery",
    lean: "must",
    budget: "",
    budgetAmount: "100",
    must: "walking and coffee",
    skip: [],
    rebuild: 0
  }, overrides || {});
}

function asCreator() {
  g.setMode("create");
  g.playStarted = true;
  g.revealed = false;
  g.moodFocus = null;
}

function asPlay(started) {
  g.setMode("play");
  g.playStarted = !!started;
  g.revealed = false;
  g.moodFocus = null;
}

const results = [];
function ok(name) { results.push("PASS " + name); console.log("PASS " + name); }
function fail(name, err) { results.push("FAIL " + name + ": " + err); console.error("FAIL " + name + ": " + err); }

// --- 1. Mystery: stops/recap empty; wet weather must not name museums while unrevealed
try {
  asCreator();
  g.weatherByDate["2026-10-11"] = {
    status: "ready",
    name: "Saturday",
    temp: "78°F",
    wind: "10 mph E",
    short: "Showers",
    wet: true
  };
  g.plan = makePlan({ style: "mystery", must: "walking and coffee" });
  g.renderDay();
  const stopsEmpty = document.getElementById("stops").innerHTML.trim() === "";
  const recapEmpty = document.getElementById("recap").innerHTML.trim() === "";
  const stopsHidden = document.getElementById("stops").classList.contains("hidden");
  const weather = document.getElementById("weather-line").textContent;
  assert(stopsEmpty, "stops should be empty in mystery");
  assert(recapEmpty, "recap should be empty in mystery");
  assert(stopsHidden, "stops should be hidden in mystery");
  assert(!/dal[ií]/i.test(weather), "weather must not contain Dalí while mystery unrevealed: " + weather);
  assert(!/mfa/i.test(weather), "weather must not contain MFA while mystery unrevealed: " + weather);
  assert(/Lean indoors\. Outdoor stops are only if it clears\./.test(weather), "generic wet line expected: " + weather);
  assert(g.weatherByDate["2026-10-11"].status === "ready", "weather should stay ready after renderDay");
  ok("1 mystery empty + wet line no museum names");
} catch (e) { fail("1 mystery empty + wet line", e.message); }

// --- 2. Mood focus + re-renderDay
try {
  asCreator();
  g.weatherByDate["2026-10-11"] = {
    status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Sunny", wet: false
  };
  g.plan = makePlan({ style: "mystery", must: "walking coffee food art gallery" });
  g.renderDay();
  const allStops = g.visibleStops();
  assert(allStops.length > 0, "need some stops");
  const moodKey = g.moodFor(allStops[0].start);
  g.moodFocus = moodKey;
  g.renderDay();
  const before = document.getElementById("stops").innerHTML;
  assert(before.trim().length > 0, "mood stops should render");
  assert(!document.getElementById("stops").classList.contains("hidden"), "stops visible with moodFocus");
  assert(!document.getElementById("moods").classList.contains("hidden"), "moods still visible");
  assert(document.getElementById("recap").innerHTML.trim() === "", "recap stays empty");
  g.renderDay();
  const after = document.getElementById("stops").innerHTML;
  assert(after.trim().length > 0, "mood stops still visible after re-renderDay");
  assert(after.includes("<article"), "mood stops html present after weather re-render");
  ok("2 mood focus survives re-renderDay");
} catch (e) { fail("2 mood focus", e.message); }

// --- 3. Rebuild resets mystery + moodFocus
try {
  asCreator();
  g.plan = makePlan({ style: "mystery" });
  g.moodFocus = "afternoon";
  g.weatherByDate["2026-10-11"] = {
    status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Sunny", wet: false
  };
  g.renderDay();
  assert(document.getElementById("stops").innerHTML.trim().length > 0, "precondition: mood stops shown");
  g.plan.rebuild = (Number(g.plan.rebuild) || 0) + 1;
  g.revealed = false;
  g.moodFocus = null;
  g.renderDay();
  assert(g.moodFocus === null, "moodFocus reset");
  assert(g.revealed === false, "still mystery");
  assert(document.getElementById("stops").innerHTML.trim() === "", "stops cleared after rebuild");
  assert(document.getElementById("stops").classList.contains("hidden"), "stops hidden after rebuild");
  assert(!document.getElementById("moods").classList.contains("hidden"), "moods shown again");
  ok("3 rebuild resets mystery + moodFocus");
} catch (e) { fail("3 rebuild reset", e.message); }

// --- 4. Note with "no museums"
try {
  g.weatherByDate["2026-10-11"] = {
    status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Rain", wet: true
  };
  const p = makePlan({
    style: "plan",
    must: "no museums, walking, coffee, food",
    budgetAmount: "200",
    kind: "easy"
  });
  const avoids = g.noteAvoids(p);
  assert(avoids.museums === true, "noteAvoids should detect no museums");
  const wants = g.noteWants(p);
  assert(wants.art === false, "art should be false when avoiding museums even if museum word matches");
  g.plan = p;
  asCreator();
  g.revealed = true;
  const stops = g.pickStops(p);
  const ids = stops.map((s) => s.id);
  assert(!ids.includes("dali"), "dali excluded: " + ids.join(","));
  assert(!ids.includes("mfa"), "mfa excluded: " + ids.join(","));
  ok("4 no museums respected under wet weather");
} catch (e) { fail("4 no museums", e.message); }

// --- 5. Show the day reveals full list
try {
  asCreator();
  g.plan = makePlan({ style: "mystery", must: "walking coffee food" });
  g.moodFocus = "morning";
  g.weatherByDate["2026-10-11"] = {
    status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Sunny", wet: false
  };
  g.renderDay();
  g.revealed = true;
  g.moodFocus = null;
  g.renderDay();
  const htmlStops = document.getElementById("stops").innerHTML;
  assert(htmlStops.includes("<article"), "full stops after reveal");
  assert(!document.getElementById("stops").classList.contains("hidden"), "stops visible");
  assert(document.getElementById("moods").classList.contains("hidden"), "moods hidden after reveal");
  assert(!document.getElementById("recap").classList.contains("hidden"), "recap shown");
  assert(document.getElementById("recap").innerHTML.includes("The day"), "recap filled");
  ok("5 show the day reveals full list");
} catch (e) { fail("5 show the day", e.message); }

// --- 6. Weather short-circuit
try {
  asCreator();
  g.weatherByDate["2026-10-11"] = {
    status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Sunny", wet: false
  };
  g.plan = makePlan({ style: "plan", date: "2026-10-11" });
  g.revealed = true;
  g.renderDay();
  assert(g.weatherByDate["2026-10-11"].status === "ready", "status stayed ready, not loading");
  g.weatherByDate["2026-10-17"] = { status: "later" };
  g.plan = makePlan({ style: "plan", date: "2026-10-17" });
  g.renderDay();
  assert(g.weatherByDate["2026-10-17"].status === "later", "later not refetched to loading");
  g.weatherByDate["2026-10-10"] = { status: "error" };
  g.plan = makePlan({ style: "plan", date: "2026-10-10" });
  g.renderDay();
  assert(g.weatherByDate["2026-10-10"].status === "error", "error not refetched to loading");
  ok("6 renderDay does not reset ready/later/error weather");
} catch (e) { fail("6 weather short-circuit", e.message); }

try {
  const p = makePlan({ must: "no museums please" });
  assert(g.noteAvoids(p).museums === true, "avoids");
  assert(g.noteWants(p).art === false, "art false for no museums");
  ok("extra noteWants art false for 'no museums'");
} catch (e) { fail("extra noteWants", e.message); }

// --- 7. Creator desk share URL uses #play/
try {
  asCreator();
  g.plan = makePlan({ style: "mystery" });
  g.weatherByDate["2026-10-11"] = {
    status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Sunny", wet: false
  };
  g.openDay(g.plan, { mode: "create" });
  assert(g.mode === "create", "mode create");
  assert(!document.getElementById("screen-day").classList.contains("hidden"), "day desk visible");
  assert(!document.getElementById("creator-desk").classList.contains("hidden"), "creator desk in DOM");
  assert(document.body.classList.contains("mode-create"), "body mode-create");
  const url = g.shareUrl();
  assert(/#play\//.test(url), "share url has play prefix: " + url);
  assert(document.getElementById("share-url").value.includes("#play/"), "share input has play prefix");
  assert(document.getElementById("rebuild"), "rebuild exists for creator");
  assert(document.getElementById("note-edit"), "note-edit exists for creator");
  ok("7 creator desk + play share URL");
} catch (e) { fail("7 creator desk share", e.message); }

// --- 8. Play URL: no creator chrome; mystery hides until mood
try {
  const p = makePlan({ style: "mystery", must: "walking coffee food" });
  const encoded = g.encodePlan(p);
  locationState.hash = "#play/" + encoded;
  locationState.search = "";
  g.openDay(p, { mode: "play", playStarted: false });
  assert(g.mode === "play", "play mode");
  assert(document.body.classList.contains("mode-play"), "body mode-play");
  assert(!document.getElementById("play-landing").classList.contains("hidden"), "landing visible");
  assert(document.getElementById("day-flow").classList.contains("hidden"), "day flow hidden on landing");
  // CSS hides creator desk in play mode; also ensure about/form hidden
  g.show("day");
  assert(document.getElementById("screen-about").classList.contains("hidden"), "about hidden");
  assert(document.getElementById("screen-form").classList.contains("hidden"), "form hidden");
  // Begin play
  g.playStarted = true;
  g.revealed = false;
  g.moodFocus = null;
  g.weatherByDate["2026-10-11"] = {
    status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Sunny", wet: false
  };
  g.renderDay();
  assert(document.getElementById("play-landing").classList.contains("hidden"), "landing gone");
  assert(!document.getElementById("day-flow").classList.contains("hidden"), "day flow shown");
  assert(document.getElementById("stops").innerHTML.trim() === "", "mystery stops empty");
  assert(document.getElementById("stops").classList.contains("hidden"), "stops hidden");
  assert(!document.getElementById("moods").classList.contains("hidden"), "moods shown");
  // plan-line should be empty for consumer
  assert(document.getElementById("plan-line").classList.contains("hidden") || !document.getElementById("plan-line").textContent.trim(), "no plan-line for consumer");
  ok("8 play URL landing + mystery hide");
} catch (e) { fail("8 play URL mystery", e.message); }

// --- 9. Play mood + re-render keeps stops
try {
  asPlay(true);
  g.plan = makePlan({ style: "mystery", must: "walking coffee food" });
  g.weatherByDate["2026-10-11"] = {
    status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Sunny", wet: false
  };
  g.renderDay();
  const stops = g.visibleStops();
  assert(stops.length > 0, "need stops");
  g.moodFocus = g.moodFor(stops[0].start);
  g.renderDay();
  assert(document.getElementById("stops").innerHTML.includes("<article"), "mood stops in play");
  g.renderDay();
  assert(document.getElementById("stops").innerHTML.includes("<article"), "mood stops survive re-render in play");
  ok("9 play mood survives re-render");
} catch (e) { fail("9 play mood", e.message); }

// --- 10. Plan style play shows stops without show-all
try {
  asPlay(true);
  g.plan = makePlan({ style: "plan", must: "walking coffee food" });
  g.revealed = false;
  g.moodFocus = null;
  g.weatherByDate["2026-10-11"] = {
    status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Sunny", wet: false
  };
  g.renderDay();
  assert(document.getElementById("moods").classList.contains("hidden"), "no moods for plan style");
  assert(document.getElementById("show-all").classList.contains("hidden"), "no show-all for plan");
  assert(document.getElementById("stops").innerHTML.includes("<article"), "plan style shows stops");
  assert(!document.getElementById("stops").classList.contains("hidden"), "stops visible");
  ok("10 plan style play shows stops");
} catch (e) { fail("10 plan style play", e.message); }

// --- 11. Bare hash treated as play
try {
  const p = makePlan({ id: "bare1", style: "mystery" });
  const encoded = g.encodePlan(p);
  const parsed = g.parseIncomingHash && (() => {
    locationState.hash = "#" + encoded;
    return g.parseIncomingHash();
  })();
  assert(parsed.mode === "play", "bare hash => play");
  assert(parsed.encoded === encoded, "encoded preserved");
  const playParsed = (() => {
    locationState.hash = "#play/" + encoded;
    return g.parseIncomingHash();
  })();
  assert(playParsed.mode === "play", "play/ hash => play");
  assert(playParsed.encoded === encoded, "play encoded");
  ok("11 bare hash and play/ parse");
} catch (e) { fail("11 hash parse", e.message); }

// --- 12. Play wet weather nameless on landing
try {
  asPlay(false);
  g.plan = makePlan({ style: "mystery" });
  g.weatherByDate["2026-10-11"] = {
    status: "ready", name: "Saturday", temp: "78°F", wind: "10 mph E", short: "Showers", wet: true
  };
  g.renderDay();
  const lw = document.getElementById("land-weather").textContent;
  assert(!/dal[ií]/i.test(lw), "landing weather no dali: " + lw);
  assert(!/mfa/i.test(lw), "landing weather no mfa: " + lw);
  assert(/Lean indoors/.test(lw), "landing wet tip: " + lw);
  ok("12 play landing wet weather nameless");
} catch (e) { fail("12 play landing wet", e.message); }

const failed = results.filter((r) => r.startsWith("FAIL"));
console.log("\n--- summary ---");
console.log(results.join("\n"));
if (failed.length) {
  console.error("\n" + failed.length + " failed");
  process.exit(1);
}
console.log("\nAll QA checks passed.");
