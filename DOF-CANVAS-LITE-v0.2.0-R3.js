(() => {
'use strict';

/*
  DOF CANVAS LITE — v0.2.0-R3
  ---------------------------------------------------------------------------
  A single-file, page-resident toolkit for draw-on-my-face. No extension or
  build step is required. It uses the page-provided PubNub runtime and, when
  integrated with index.html, the controlled DrawOnMyFace colour API.

  WHAT THIS IS NOT
  ----------------
  It is not a port of the extension-only LIVE Drawing Toolkit or the
  SDT-EXHIBITION game modules. Those depend on extension globals and bridge
  facilities that do not exist on a bare canvas page. This publishes directly
  to the same `coords` channel through a publisher handle created from the
  page-provided PubNub runtime. It uses the receiver's required coordinate
  fields plus optional `tool` metadata that the current receiver safely ignores.

  RECEIVER LIMITS (read from current index.html)
  --------------------------------------------------------
    index.html  maxTrackPoints  = 40     points visible per userId at once
    index.html  pointLifetimeMS = 5000   every point self-expires after 5s
    index.html  lineWidth       = 3      fixed, senders cannot change it
    coords message shape        = { x, y, userId, style, seq }

  Three consequences drive the whole design:

  1. The 5-second output limit is NOT something this file enforces with a
     timer - it is the platform's own behaviour. Every point dies after 5s no
     matter what. The cap here exists to stop a long ANIMATION running on, not
     to expire pixels.

  2. Only 40 points per identity are ever on screen. Every shape below fits
     inside that. Wordmarks do not: "PUBNUB" costs 61 points once each
     stroke's pen-up is counted, so under one identity the receiver discards
     the oldest 21 and the word loses its opening letters entirely.
     This build publishes a long wordmark under SEVERAL identities, which the
     operator authorised explicitly. The earlier build refused to, on the view
     that the budget is per person and taking several shares of it is not a
     public tool's place. That reasoning was wrong about the mechanism as much
     as the etiquette: the cap is not a fair-share allowance, it is a
     per-track buffer, and a wordmark is one object rather than one person's
     stream of drawing. The pool is bounded at 6 and reused, so this tool's
     footprint is fixed rather than growing with use.

  3. There are no performance controls, by request. Rate, size and thickness
     are fixed at conservative values rather than exposed as user controls.
     There is nothing here to turn up.
*/

const VERSION = '0.2.0-R3';
if (window.__DOF_CANVAS_LITE__ || window.__DOF_CANVAS_LITE_INSTALLING__) return;
// Reserve the install while the document is still loading so a duplicate script
// tag cannot register a second DOMContentLoaded installer. Cleared on success or
// failure; the public ready marker is created only after build() succeeds.
window.__DOF_CANVAS_LITE_INSTALLING__ = true;

// ---------------------------------------------------------------------------
// Fixed operating limits. Deliberately not user-editable - see note 3 above.
// ---------------------------------------------------------------------------
const POINTS_PER_SECOND = 28;    // fixed conservative send cadence
const MAX_ANIMATION_MS  = 5000;  // default ceiling for shape/animation actions
// Optional sender metadata. The current receiver ignores this field and still
// applies the normal per-userId 40-point cap; compatible future receivers may
// use it to identify structured-tool output without changing message shape.
const TOOL_ID = 'lite';

// The receiver keeps at most this many points per userId and discards the
// OLDEST beyond it. Verified in the current index.html: maxTrackPoints = 40,
// with no active per-tool budget handling.
//
// An earlier build set this to 100 in anticipation of a receiver change giving
// declared tools a bigger budget. That change is not live, so the cap really
// was 40 and "PUBNUB" lost its opening letters on screen.
const RECEIVER_TRACK_CAP = 40;

// MULTI-IDENTITY.
// The cap is per userId, so it is not a canvas-wide ceiling - it is a ceiling
// per *sender*. Publishing a long wordmark as several identities gives each
// chunk its own full 40-point track and the whole word stays on screen at
// once. This needs no receiver change at all, so it works with the current
// receiver rather than depending on a separate per-tool budget change.
//
// The pool is BOUNDED and reused between actions rather than minted fresh each
// time: the receiver holds a track object per userId it has ever seen, so
// unique-per-action identities would grow that map without limit.
const MAX_IDENTITIES = 6;        // 6 x 40 = 240 points, far beyond any wordmark

// Total work allowed in one action. Doubles as a guard on draw TIME: at the
// fixed rate 240 points is about 8.5s.
const MAX_TOTAL_POINTS = RECEIVER_TRACK_CAP * MAX_IDENTITIES;
const CHANNEL = 'coords';

// ---------------------------------------------------------------------------
// Word filter
// ---------------------------------------------------------------------------
// Substring matching is wrong here - it produces the Scunthorpe problem, where
// innocent words are blocked because a banned string appears inside them. This
// normalises common letter-for-symbol substitutions first, then matches on
// WORD BOUNDARIES only.
//
// The list is deliberately short and generic. It is a starting point to be
// extended by whoever operates the canvas, not an attempt at a complete
// moderation policy - no wordlist is.
// Two tiers, because the two kinds of word need opposite matching rules.
//
// SUBSTRING: terms that essentially never occur inside an innocent English
// word, so any appearance at all is a block. This also catches padding tricks
// like "xxfuckxx" that a word-boundary test would wave through.
const BLOCKED_SUBSTRING = [
  'fuck','shit','cunt','bitch','bastard','wanker','bollock','wank',
  'nigger','nigga','faggot','retard','tranny','paki','spic','chink','kike',
  'whore','slut','rape','porn','penis','vagina','boob','tit','anal','anus',
  'cock','dick','pussy','semen','cum','orgasm','masturbat','sex','horny',
  'nazi','hitler','kkk','heroin','cocaine','meth'
];

// WORD-BOUNDARY: real words that also live inside perfectly innocent ones.
// "ass" is in class/pass/assessment/embassy, "hell" in shell/hello,
// "gay" in Gaya. Matching these as substrings is the Scunthorpe problem, so
// they only block when they stand alone as a word.
const BLOCKED_WORD = [
  'ass','arse','gay','damn','hell','crap','piss','bugger','git','twat',
  'prick','knob','fag','queer','dyke','homo','sod','bloody','bastards',
  'idiot','stupid','moron','loser','ugly','fat','die','kill','hate',
  'drunk','weed','vape','beer','vodka'
];

// ALLOWLIST - checked FIRST, and the reason this filter is not the classic
// broken one.
//
// Substring matching is what catches padding tricks like "xxfuckxx", but it
// also fires inside perfectly ordinary words: Scunthorpe and Penistone are
// real towns, Sussex is a real county, cockburn is a real surname, shiitake is
// a mushroom. Blocking those is the Scunthorpe problem - named after AOL
// locking the town's residents out in 1996 - and an earlier revision of this
// file reintroduced it exactly.
//
// These words are removed from the text before the substring pass runs, so
// "Scunthorpe" survives while "Scunthorpe fuck" still blocks on the part that
// is actually a problem.
const ALLOWED = [
  'scunthorpe','penistone','lightwater','clitheroe','cockburn','cockfosters',
  'sussex','essex','middlesex','wessex','assassin','assassins','assess',
  'assessment','assessments','assemble','assembly','assign','assist','asset',
  'associate','association','assume','assure','embassy','class','classic',
  'glass','grass','pass','passage','password','bass','mass','massive',
  'compass','harass','hello','shell','shelter','she','hells','hellenic',
  'shiitake','titan','title','titles','document','documents','accumulate',
  'circumstance','cumulative','crapaud','analysis','analyse','analyze',
  'canal','banal','therapist','specialist','grape','grapes','scrape'
];

function stripAllowed(text) {
  let out = text;
  // longest first, so "assessment" is consumed before "assess" or "ass"
  for (const word of [...ALLOWED].sort((a,b) => b.length - a.length)) {
    out = out.split(word).join(' ');
  }
  return out;
}

function normaliseForFilter(text) {
  return String(text)
    .toLowerCase()
    // collapse the usual character swaps before matching
    .replace(/[0]/g,'o').replace(/[1!|]/g,'i').replace(/[3]/g,'e')
    .replace(/[4@]/g,'a').replace(/[5$]/g,'s').replace(/[7]/g,'t')
    .replace(/[8]/g,'b').replace(/[9]/g,'g').replace(/[+]/g,'t')
    // drop anything that is not a letter or a space, so f.u.c.k and f-u-c-k
    // collapse to the same token as fuck
    .replace(/[^a-z ]+/g,'')
    .replace(/\s+/g,' ')
    .trim();
}

function isClean(text) {
  const norm = normaliseForFilter(text);
  if (!norm) return true;

  // Innocent words that merely contain a blocked substring are removed before
  // the substring pass - see ALLOWED. Word-boundary checks below run on the
  // ORIGINAL text, so this cannot be used to smuggle a standalone bad word.
  const safe = stripAllowed(norm);

  // Space-stripped form defeats "f u c k" and "a s s".
  //
  // Letter padding is handled by matching a repetition-tolerant PATTERN rather
  // than by pre-squeezing the text. Squeezing needs a fixed run length and no
  // single choice works: collapsing runs to one letter turns "fuuuuck" into
  // "fuck" but also "assss" into "as", while collapsing to two fixes "assss"
  // and breaks "fuuuuck". "aaasss" defeats both, because it needs the a-run
  // collapsed to one AND the s-run to two. Turning "ass" into /a+s+s+/ matches
  // every padding of it at once and needs no guessing.
  const collapsed = safe.replace(/ /g,'');
  const pattern = term => term.split('')
    .map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '+')
    .join('');

  for (const term of BLOCKED_SUBSTRING) {
    if (new RegExp(pattern(term)).test(collapsed)) return false;
  }

  for (const term of BLOCKED_WORD) {
    const boundary = new RegExp(`(^|\\s)${term}(\\s|$)`);
    if (boundary.test(norm)) return false;
    // the whole input being exactly the word, however spaced or padded out
    if (new RegExp(`^${pattern(term)}$`).test(collapsed)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Shapes. Normalised 0..1 space. Every one fits a single identity track.
// ---------------------------------------------------------------------------
const Shapes = {
  circle(steps = 18) {
    const p = [];
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI/2 + Math.PI*2*i/steps;
      p.push([0.5 + Math.cos(a)*0.34, 0.5 + Math.sin(a)*0.34]);
    }
    return p;                                   // 19 points
  },
  star() {
    const p = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI/2 + Math.PI*2*i/10;
      const r = i % 2 === 0 ? 0.36 : 0.15;
      p.push([0.5 + Math.cos(a)*r, 0.5 + Math.sin(a)*r]);
    }
    return p;                                   // 11 points
  },
  heart(steps = 24) {
    const p = [];
    for (let i = 0; i <= steps; i++) {
      const t = Math.PI*2*i/steps;
      const x = 16*Math.sin(t)**3;
      const y = 13*Math.cos(t) - 5*Math.cos(2*t) - 2*Math.cos(3*t) - Math.cos(4*t);
      p.push([0.5 + x/42, 0.52 - y/42]);
    }
    return p;                                   // 25 points
  },
  triangle() {
    return [[0.5,0.18],[0.82,0.76],[0.18,0.76],[0.5,0.18]];
  },
  square() {
    return [[0.24,0.24],[0.76,0.24],[0.76,0.76],[0.24,0.76],[0.24,0.24]];
  },
  spiral(turns = 3, steps = 30) {
    const p = [];
    for (let i = 0; i <= steps; i++) {
      const t = i/steps;
      const a = Math.PI*2*turns*t;
      const r = 0.05 + 0.30*t;
      p.push([0.5 + Math.cos(a)*r, 0.5 + Math.sin(a)*r]);
    }
    return p;                                   // 31 points
  }
};

// ---------------------------------------------------------------------------
// Stroke font - only the characters the wordmarks need.
// Glyphs are drawn in a 0..1 box and packed onto a baseline by layoutWord().
// ---------------------------------------------------------------------------
const Glyphs = {
  " ":[],
  "!":[[[0.5,0],[0.5,0.72]],[[0.5,0.92],[0.5,0.94]]],
  "+":[[[0.1,0.5],[0.9,0.5]],[[0.5,0.1],[0.5,0.9]]],
  "-":[[[0.15,0.52],[0.85,0.52]]],
  ".":[[[0.5,0.93],[0.5,0.95]]],
  "/":[[[0.1,1],[0.9,0]]],
  0:[[[0.25,0],[0.75,0],[0.95,0.2],[0.95,0.8],[0.75,1],[0.25,1],[0.05,0.8],[0.05,0.2],[0.25,0]]],
  1:[[[0.3,0.22],[0.5,0],[0.5,1]],[[0.2,1],[0.8,1]]],
  2:[[[0.08,0.2],[0.25,0],[0.75,0],[0.94,0.2],[0.94,0.38],[0.05,1],[0.95,1]]],
  3:[[[0.08,0.12],[0.28,0],[0.75,0],[0.94,0.18],[0.75,0.5],[0.94,0.7],[0.94,0.84],[0.75,1],[0.25,1],[0.06,0.86]]],
  4:[[[0.78,1],[0.78,0],[0.05,0.68],[1,0.68]]],
  5:[[[0.92,0],[0.12,0],[0.08,0.5],[0.72,0.5],[0.94,0.68],[0.94,0.84],[0.75,1],[0.25,1],[0.06,0.86]]],
  6:[[[0.9,0.12],[0.72,0],[0.25,0],[0.06,0.25],[0.06,0.78],[0.25,1],[0.72,1],[0.94,0.8],[0.94,0.62],[0.72,0.48],[0.06,0.48]]],
  7:[[[0.05,0],[0.95,0],[0.35,1]]],
  8:[[[0.25,0],[0.75,0],[0.94,0.18],[0.75,0.5],[0.25,0.5],[0.06,0.18],[0.25,0]],[[0.25,0.5],[0.75,0.5],[0.94,0.72],[0.75,1],[0.25,1],[0.06,0.72],[0.25,0.5]]],
  9:[[[0.94,0.52],[0.28,0.52],[0.06,0.35],[0.06,0.18],[0.25,0],[0.75,0],[0.94,0.22],[0.94,0.78],[0.75,1],[0.25,1],[0.08,0.88]]],
  ":":[[[0.5,0.32],[0.5,0.34]],[[0.5,0.72],[0.5,0.74]]],
  "?":[[[0.1,0.2],[0.28,0],[0.72,0],[0.9,0.2],[0.9,0.4],[0.5,0.62],[0.5,0.72]],[[0.5,0.92],[0.5,0.94]]],
  A:[[[0,1],[0.5,0],[1,1]],[[0.2,0.58],[0.8,0.58]]],
  B:[[[0,0],[0,1]],[[0,0],[0.66,0],[0.9,0.18],[0.9,0.38],[0.66,0.5],[0,0.5]],[[0,0.5],[0.68,0.5],[0.92,0.65],[0.92,0.85],[0.68,1],[0,1]]],
  C:[[[0.95,0.12],[0.72,0],[0.25,0],[0.05,0.2],[0.05,0.8],[0.25,1],[0.72,1],[0.95,0.88]]],
  D:[[[0,0],[0,1]],[[0,0],[0.62,0],[0.94,0.28],[0.94,0.72],[0.62,1],[0,1]]],
  E:[[[0.95,0],[0,0],[0,1],[0.95,1]],[[0,0.5],[0.72,0.5]]],
  F:[[[0,1],[0,0],[0.95,0]],[[0,0.5],[0.72,0.5]]],
  G:[[[0.95,0.18],[0.72,0],[0.25,0],[0.05,0.22],[0.05,0.78],[0.25,1],[0.75,1],[0.95,0.78],[0.95,0.55],[0.58,0.55]]],
  H:[[[0,0],[0,1]],[[1,0],[1,1]],[[0,0.5],[1,0.5]]],
  I:[[[0.1,0],[0.9,0]],[[0.5,0],[0.5,1]],[[0.1,1],[0.9,1]]],
  J:[[[0.15,0],[0.9,0],[0.9,0.76],[0.75,1],[0.3,1],[0.08,0.8]]],
  K:[[[0,0],[0,1]],[[0.95,0],[0,0.58],[0.95,1]]],
  L:[[[0,0],[0,1],[0.95,1]]],
  M:[[[0,1],[0,0],[0.5,0.52],[1,0],[1,1]]],
  N:[[[0,1],[0,0],[1,1],[1,0]]],
  O:[[[0.25,0],[0.75,0],[0.96,0.22],[0.96,0.78],[0.75,1],[0.25,1],[0.04,0.78],[0.04,0.22],[0.25,0]]],
  P:[[[0,1],[0,0],[0.68,0],[0.92,0.2],[0.92,0.4],[0.68,0.55],[0,0.55]]],
  Q:[[[0.25,0],[0.75,0],[0.96,0.22],[0.96,0.78],[0.75,1],[0.25,1],[0.04,0.78],[0.04,0.22],[0.25,0]],[[0.58,0.68],[1,1]]],
  R:[[[0,1],[0,0],[0.68,0],[0.92,0.2],[0.92,0.4],[0.68,0.55],[0,0.55]],[[0.54,0.55],[1,1]]],
  S:[[[0.92,0.15],[0.72,0],[0.25,0],[0.06,0.18],[0.06,0.4],[0.25,0.5],[0.72,0.5],[0.94,0.62],[0.94,0.84],[0.75,1],[0.22,1],[0.05,0.86]]],
  T:[[[0,0],[1,0]],[[0.5,0],[0.5,1]]],
  U:[[[0,0],[0,0.76],[0.22,1],[0.78,1],[1,0.76],[1,0]]],
  V:[[[0,0],[0.5,1],[1,0]]],
  W:[[[0,0],[0.2,1],[0.5,0.55],[0.8,1],[1,0]]],
  X:[[[0,0],[1,1]],[[1,0],[0,1]]],
  Y:[[[0,0],[0.5,0.5],[1,0]],[[0.5,0.5],[0.5,1]]],
  Z:[[[0,0],[1,0],[0,1],[1,1]]]
};

// Lay a word out along a baseline, returning one array of strokes in 0..1
// space. `box` lets a caller place the word in part of the canvas.
function layoutWord(word, box = {x:0.06, y:0.34, w:0.88, h:0.32}) {
  const chars = [...word.toUpperCase()].filter(c => Glyphs[c] !== undefined);
  if (!chars.length) return [];
  const advance = 1.15;                       // glyph width + gap
  const total = chars.length * advance;
  const out = [];
  chars.forEach((ch, i) => {
    for (const stroke of Glyphs[ch]) {
      out.push(stroke.map(([gx, gy]) => [
        box.x + box.w * ((i*advance + gx) / total),
        box.y + box.h * gy
      ]));
    }
  });
  return out;
}

function countPoints(strokes) {
  return strokes.reduce((n, s) => n + s.length, 0);
}

// STACKED LAYOUT.
// "LIKE SUB" on one line spans the full canvas width, which makes each letter
// small and leaves the wordmark stretched across the whole face. Stacking it
// as two lines uses the vertical space instead, so the letters are larger and
// the mark reads as a unit.
//
// Lines are NOT laid out by calling layoutWord per line: that fits each line
// to the full box width independently, so a 3-character line would get letters
// half again as wide as a 4-character one and the block would look ragged.
// Instead one glyph width is derived from the LONGEST line and every line uses
// it, with shorter lines centred - which is what makes the stack look set
// rather than stretched.
function layoutLines(lines, box = {x:0.08, y:0.26, w:0.84, h:0.48}) {
  const rows = lines.filter(l => l.length);
  if (!rows.length) return [];
  const advance = 1.15;                        // glyph width + gap
  const gapFrac = 0.22;                        // vertical gap, as a line height
  const rowH = box.h / (rows.length + gapFrac * (rows.length - 1));
  const glyphW = box.w / (Math.max(...rows.map(r => r.length)) * advance);
  const out = [];

  rows.forEach((line, r) => {
    const chars = [...line.toUpperCase()].filter(c => Glyphs[c] !== undefined);
    const lineW = chars.length * advance * glyphW;
    const x0 = box.x + (box.w - lineW) / 2;    // centre the short line
    const y0 = box.y + r * rowH * (1 + gapFrac);
    chars.forEach((ch, i) => {
      for (const stroke of Glyphs[ch]) {
        out.push(stroke.map(([gx, gy]) => [
          x0 + (i * advance + gx) * glyphW,
          y0 + gy * rowH
        ]));
      }
    });
  });
  return out;
}

// TRUE COST OF A STROKE.
// Every stroke is preceded by a pen-up point (see PEN_UP_STYLE), and the
// receiver counts that point against the track exactly like a visible one.
// A stroke of length L therefore occupies L+1 slots, not L. Missing this is
// what made "PUBNUB" fail while the arithmetic said it should fit: 51 glyph
// points looked fine, but the real cost is 61.
function trackCost(strokes) {
  return strokes.reduce((n, s) => n + s.length + 1, 0);
}

// Split strokes into chunks that each fit ONE identity's track. Chunks never
// split mid-stroke: a letter stroke divided across two identities would be
// drawn as two disconnected fragments, because separate userIds are never
// joined to each other.
//
// A single stroke larger than the cap cannot be helped by more identities and
// is passed through whole; no glyph or shape in this file is that large.
function chunkByTrack(strokes, cap = RECEIVER_TRACK_CAP) {
  const parts = [];
  let current = [], used = 0;
  for (const stroke of strokes) {
    const cost = stroke.length + 1;
    if (used + cost > cap && current.length) {
      parts.push(current); current = []; used = 0;
    }
    current.push(stroke); used += cost;
  }
  if (current.length) parts.push(current);
  return parts;
}

// ---------------------------------------------------------------------------
// Publisher
// ---------------------------------------------------------------------------
// One point per message using the receiver's normal coords path. Lite keeps a
// separate bounded identity pool on purpose: freehand drawing has its own seq
// counter and 40-point track, so sharing that userId would create duplicate or
// out-of-order seq values and make structured output evict freehand points.
let pubnub = null;
let seq = 0;
let activeRun = 0;                 // increments to cancel whatever is running

function client() {
  if (pubnub) return pubnub;
  if (typeof window.PubNub !== 'function') {
    throw new Error('PubNub runtime unavailable');
  }
  pubnub = window.PubNub({});
  if (!pubnub || typeof pubnub.publish !== 'function') {
    throw new Error('PubNub publisher unavailable');
  }
  return pubnub;
}

function identity() {
  if (!window.__DOF_LITE_ID) window.__DOF_LITE_ID = 'lite-' + Math.random().toString(36).slice(2,10);
  return window.__DOF_LITE_ID;
}

// Identity n of the bounded Lite pool. Index 0 handles normal short actions;
// only output that genuinely needs more than one 40-point receiver track reaches
// for a second name. The pool is stable and bounded, so repeated actions do not
// mint unbounded receiver-track identities.
function identityFor(index) {
  const base = identity();
  return index === 0 ? base : base + '~' + index;
}

function sendPoint(x, y, style, who) {
  const c = client();
  // Points outside 0..1 are clamped rather than dropped: the receiver maps
  // them straight onto screen coordinates and off-canvas values would simply
  // vanish, which looks like a broken shape.
  c.publish({
    channel: CHANNEL,
    message: {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      userId: who || identity(),
      style,
      seq: ++seq,
      // Optional forward-compatible metadata. The current receiver ignores
      // unknown fields and applies the normal per-userId track cap. A future
      // receiver may use this tag to recognise structured-tool output.
      tool: TOOL_ID
    }
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// PEN UP.
// index.html has no explicit pen-up: every point a userId sends is joined to
// the last one, which is why separate strokes (letters especially) were strung
// together by travel lines. But rebuildPaths starts a NEW Path2D whenever the
// style CHANGES, and draws that first segment in the NEW style:
//
//     if (pointStyle !== style) { path = new Path2D();
//       paths.push({style: pointStyle, path});
//       path.moveTo(previousX, previousY); }
//     path.lineTo(x, y);
//
// So publishing the destination with a fully transparent style paints the
// travel segment in transparent - invisible - and the following point resumes
// from there in the real color. That is a genuine pen-up built out of the
// receiver's own behaviour, no upstream change required.
const PEN_UP_STYLE = 'rgba(0,0,0,0)';

async function penUp(x, y, runId, deadline, who) {
  if (runId !== activeRun || Date.now() > deadline) return false;
  sendPoint(x, y, PEN_UP_STYLE, who);
  await wait(1000 / POINTS_PER_SECOND);
  return true;
}

// Draw a set of strokes at the fixed rate, abandoning immediately if a newer
// action started or the 5s ceiling is reached.
//
// EVERY stroke gets a leading pen-up, including the first one of an action.
// An earlier version skipped the first, reasoning that there was nothing to
// disconnect from - which is wrong across actions. The receiver joins points
// per userId with no notion of an action boundary, so the first point of a new
// shape was drawn as a line FROM the last point of the previous one: drawing a
// circle after some text left a long diagonal scar between them.
//
// Note the fix belongs at the START, not the end. A trailing pen-up parks the
// pen somewhere, and the next action still draws a visible line from that
// parking spot to wherever it begins. Only a leading pen-up makes the travel
// itself invisible.
async function drawStrokes(strokes, style, runId, deadline, who) {
  const gap = 1000 / POINTS_PER_SECOND;
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    if (!await penUp(stroke[0][0], stroke[0][1], runId, deadline, who)) return false;
    for (const [x, y] of stroke) {
      if (runId !== activeRun || Date.now() > deadline) return false;
      sendPoint(x, y, style, who);
      await wait(gap);
    }
  }
  return true;
}

// Draw pre-chunked work, each chunk under its own identity so each gets a full
// track of its own.
//
// Chunks are drawn in SEQUENCE, not in parallel. The point rate is a
// canvas-wide budget and firing several chunks at once would multiply it,
// which is the sort of load this tool exists not to add. Sequencing costs
// nothing visually, because nothing expires for 5s and the whole word takes
// about 2s.
async function drawChunks(chunks, style, runId, deadline) {
  for (let i = 0; i < chunks.length; i++) {
    const who = identityFor(i % MAX_IDENTITIES);
    if (!await drawStrokes(chunks[i], style, runId, deadline, who)) return false;
  }
  return true;
}

// Every user-triggered action goes through here, so the 5s ceiling and the
// cancel-previous behaviour cannot be bypassed by any individual button.
// budgetMs defaults to the animation ceiling; text passes a longer one because
// a held word is not a running animation (see drawWord).
async function run(fn, budgetMs = MAX_ANIMATION_MS) {
  const runId = ++activeRun;
  const deadline = Date.now() + budgetMs;
  setStatus('drawing…');
  try {
    await fn(runId, deadline);
    if (runId === activeRun) setStatus('done');
  } catch (err) {
    if (runId === activeRun) setStatus('error: ' + (err?.message || err));
  }
}

function stopAll() {
  activeRun++;
  setStatus('stopped');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
// SHAPE SIZE. Halved once from the original, then halved again by request, so
// this is a quarter of the first version. A full-width shape dominated the
// canvas and left no room for anyone else drawing; at 0.25 several shapes
// coexist comfortably, which is also what makes the free-space finder below
// worth having.
const SHAPE_SCALE = 0.25;

// 1:1 ASPECT.
// The receiver maps x straight onto screenWidth and y onto screenHeight, so a
// shape defined in plain 0..1 space is stretched by whatever the window
// happens to be - on a 1290x700 canvas a circle came out as a wide ellipse.
// Squeezing x by height/width makes a circle a circle and a square a square,
// whatever the viewport. Text deliberately does NOT use this: a wordmark
// should span the canvas width rather than be squashed into a square.
function aspect() {
  const c = document.getElementById('canvas');
  const w = c?.clientWidth  || window.innerWidth  || 1;
  const h = c?.clientHeight || window.innerHeight || 1;
  return h / w;                       // <1 on a landscape window
}

// cx/cy place the shape's CENTRE in normalised canvas space, so a caller can
// drop a shape into found space without doing offset arithmetic.
function transform(points, {scale = 1, rotate = 0, cx = 0.5, cy = 0.5, square = true}) {
  const cos = Math.cos(rotate), sin = Math.sin(rotate);
  const k = square ? aspect() : 1;
  return points.map(([x, y]) => {
    const px = (x - 0.5) * scale, py = (y - 0.5) * scale;
    const rx = px*cos - py*sin, ry = px*sin + py*cos;
    // aspect squeeze is applied AFTER rotation, so a rotated square stays
    // square instead of shearing as it turns
    return [cx + rx*k, cy + ry];
  });
}

// --- Free-space finder -----------------------------------------------------
// Score every region by how much live ink it already holds and place new work
// into the quietest one. It reads the CANVAS PIXELS rather than tracking only
// this tool's published points, so it accounts for every mark actually on
// screen - other visitors, structured output and freehand drawing. A centre
// bias keeps empty corner space from outranking the part of the face the
// audience is actually looking at.
const REGION_COLS = 4, REGION_ROWS = 3;
const CENTRE_BIAS = 0.35;   // 0 = purely emptiest, higher = pulls to middle

// LOAD WEIGHT. Not cosmetic - without it the finder does not distribute at all.
// One shape covers only ~1.8% of a region (measured on the live canvas), so
// unweighted its score contribution is ~0.018, while the centre term reaches
// ~0.165 at the corners. The bias swamps the ink almost entirely.
// Simulating 12 sequential placements:
//     weight 1 -> 4 of 12 regions used, 5 shapes stacked in one region
//     weight 4 -> 10 of 12 regions, at most 2 stacked
//     weight 8 -> 12 of 12 regions, never stacks
// 8 is the smallest value that reaches every region while still preferring the
// centre on an empty canvas, which is the behaviour wanted.
const LOAD_WEIGHT = 8;

function quietestRegion() {
  const cv = document.getElementById('canvas');
  if (!cv || !cv.width) return {x: 0.5, y: 0.5, load: 0, fallback: true};
  let data;
  try {
    data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  } catch (e) {
    return {x: 0.5, y: 0.5, load: 0, fallback: true};   // tainted canvas
  }

  const load = new Array(REGION_COLS * REGION_ROWS).fill(0);
  const step = 4;                       // sample every 4th pixel; plenty
  let perRegion = 0;
  for (let y = 0; y < cv.height; y += step) {
    for (let x = 0; x < cv.width; x += step) {
      if (data[(y*cv.width + x)*4 + 3] > 16) {          // any ink at all
        const rx = Math.min(REGION_COLS-1, Math.floor(x / (cv.width /REGION_COLS)));
        const ry = Math.min(REGION_ROWS-1, Math.floor(y / (cv.height/REGION_ROWS)));
        load[ry*REGION_COLS + rx]++;
      }
    }
  }
  perRegion = Math.ceil(cv.width/step) * Math.ceil(cv.height/step) / load.length;

  let best = 0, bestScore = Infinity;
  for (let i = 0; i < load.length; i++) {
    const rx = i % REGION_COLS, ry = Math.floor(i / REGION_COLS);
    const cx = (rx + 0.5) / REGION_COLS, cy = (ry + 0.5) / REGION_ROWS;
    // 0.45 rather than 0.5: on a portrait face the visually important area
    // sits slightly above geometric centre.
    const offCentre = Math.hypot(cx - 0.5, cy - 0.45);
    const score = (load[i] / perRegion) * LOAD_WEIGHT + offCentre * CENTRE_BIAS;
    if (score < bestScore) { bestScore = score; best = i; }
  }

  const rx = best % REGION_COLS, ry = Math.floor(best / REGION_COLS);
  return {
    x: (rx + 0.5) / REGION_COLS,
    y: (ry + 0.5) / REGION_ROWS,
    load: Math.round(100 * load[best] / perRegion),
    region: `${rx+1},${ry+1}`
  };
}

// Shapes and animations hunt for space. The brand wordmarks deliberately do
// NOT - a call-out that wanders into a corner is not a call-out, so PubNub and
// Like & Sub always take the middle.
async function drawShape(name, style) {
  const spot = quietestRegion();
  const pts = transform(Shapes[name](), {scale: SHAPE_SCALE, cx: spot.x, cy: spot.y});
  setStatus(`drawing in region ${spot.region || 'centre'} (${spot.load ?? 0}% busy)`);
  await run((runId, deadline) => drawStrokes([pts], style, runId, deadline));
}

// Animations reuse one shape and vary the transform per pass. How many passes
// fit is decided by the clock, not by a count, so the 5s ceiling always holds
// however slow the network is.
async function animate(name, mode, style) {
  const base = Shapes[name]();
  // The spot is chosen ONCE, not per pass. Re-running the finder each pass
  // would make the animation hop about as its own ink changes which region
  // looks quietest - it would chase itself around the canvas.
  const spot = quietestRegion();
  setStatus(`animating in region ${spot.region || 'centre'} (${spot.load ?? 0}% busy)`);
  await run(async (runId, deadline) => {
    let pass = 0;
    while (Date.now() < deadline && runId === activeRun) {
      const t = pass++;
      const opts = {scale: SHAPE_SCALE, cx: spot.x, cy: spot.y};
      if (mode === 'spin')       opts.rotate = t * 0.5;
      else if (mode === 'pulse') opts.scale  = SHAPE_SCALE * (0.6 + 0.4 * Math.abs(Math.sin(t * 0.6)));
      else { opts.cx = spot.x + Math.sin(t * 0.7) * 0.10; opts.cy = spot.y + Math.cos(t * 0.5) * 0.08; }
      const ok = await drawStrokes([transform(base, opts)], style, runId, deadline);
      if (!ok) return;
    }
  });
}

// How long a finished word stays fully on screen before it is allowed to fade.
const TEXT_HOLD_MS = 3000;

// Trim a word only if it exceeds the TOTAL budget across every identity.
//
// Two earlier approaches failed for the same underlying reason. Splitting into
// sequential parts under ONE identity does not work: the parts accumulate in
// the same track, so a 61-point "PUBNUB" still loses its oldest 21 points and
// the word is never whole at any instant. Trimming characters does work, but
// answers a question nobody asked - the user typed a word and wants that word.
//
// Multiple identities remove the constraint instead of negotiating with it,
// because 40 was never a canvas ceiling, only a per-sender one. At 6 x 40 the
// longest input the box accepts (14 characters, 84 points) is comfortable, so
// nothing is trimmed in practice and this is a backstop, not a policy.
function fitWord(word) {
  let text = word;
  while (text.length > 1 && trackCost(layoutWord(text)) > MAX_TOTAL_POINTS) {
    text = text.slice(0, -1);
  }
  return {text, trimmed: text !== word, points: trackCost(layoutWord(text))};
}

// Draw any finished set of strokes: chunk it across identities, then hold it.
// Shared by typed text and by the stacked brand marks so both get identical
// treatment - there is no second copy of the hold logic to drift.
async function drawStrokeSet(strokes, style) {
  const parts = chunkByTrack(strokes);
  // Text gets a longer budget than MAX_ANIMATION_MS: the ceiling exists to
  // stop an ANIMATION running on, and a held word is not an animation. The
  // total is still bounded - draw time plus the hold, and nothing more.
  await run(async (runId, deadline) => {
    // No pause between chunks. The old 180ms beat existed to make a split
    // wordmark read as two deliberate halves, which was making a virtue of the
    // truncation. Chunks are no longer halves of anything - they are one word
    // sharing several tracks - so a gap between them is just a stutter
    // mid-word.
    if (!await drawChunks(parts, style, runId, deadline)) return;

    // HOLD. Without this a word is only whole for about 2.5s: it takes ~2.5s
    // to draw at the fixed rate, and the FIRST letters start expiring 5s after
    // they arrived - so they begin vanishing while the reader is still on the
    // last word. Republishing the identical points at identical coordinates
    // resets their expiry and changes nothing visually, so the completed word
    // simply stays put for the hold period.
    const until = Date.now() + TEXT_HOLD_MS;
    setStatus('holding…');
    while (Date.now() < until && runId === activeRun) {
      // deadline is pushed out for the refresh pass, otherwise the original
      // draw deadline would abort the hold before it started
      if (!await drawChunks(parts, style, runId, until + 2000)) return;
    }
  }, MAX_ANIMATION_MS + TEXT_HOLD_MS + 3000);
}

async function drawWord(word, style) {
  const fit = fitWord(word);
  if (fit.trimmed) {
    setStatus(`"${word}" needs ${trackCost(layoutWord(word))} pts, total budget is ${MAX_TOTAL_POINTS} - drawing "${fit.text}"`);
  }
  await drawStrokeSet(layoutWord(fit.text), style);
}

// A stacked wordmark, e.g. ['LIKE','SUB'] as two centred lines.
async function drawLines(lines, style) {
  await drawStrokeSet(layoutLines(lines), style);
}

// ---------------------------------------------------------------------------
// UI - one small panel, no settings
// ---------------------------------------------------------------------------
// COLOR WHEEL.
// Replaces a fixed swatch row. A named-color table was considered and
// rejected: the list that exists runs to 700+ entries, which is a large
// payload and a scrolling list to hunt through, for strictly fewer colors
// than a wheel gives. Hue comes from the angle, saturation from the radius,
// and a separate slider handles lightness - so every color is two clicks
// away and the whole control costs a few dozen lines.
const WHEEL_SIZE = 116;
// Fallback used only when Canvas Lite is run outside the full page. On the
// integrated canvas, index.html owns the canonical activeStyle and exposes it
// through DrawOnMyFace.getDrawColor()/setDrawColor().
let fallbackColor = '#ff2d55';
let lightness = 0.5;

function getActiveColor() {
  const api = window.DrawOnMyFace;
  if (api && typeof api.getDrawColor === 'function') {
    const current = api.getDrawColor();
    if (typeof current === 'string' && current) return current;
  }
  return fallbackColor;
}

function setActiveColor(hex) {
  fallbackColor = hex;
  const api = window.DrawOnMyFace;
  if (api && typeof api.setDrawColor === 'function') {
    api.setDrawColor(hex);
  }
  return hex;
}
let wheelCanvas = null;
let statusEl = null;

function hslToHex(h, s, l) {
  const f = n => {
    const k = (n + h/30) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function paintWheel(cv, l) {
  const ctx = cv.getContext('2d');
  const r = cv.width / 2;
  const img = ctx.createImageData(cv.width, cv.height);
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      const dx = x - r, dy = y - r;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const i = (y*cv.width + x) * 4;
      if (dist > r) { img.data[i+3] = 0; continue; }
      const hue = (Math.atan2(dy, dx) * 180/Math.PI + 360) % 360;
      const sat = Math.min(1, dist / r);
      const hex = hslToHex(hue, sat, l);
      img.data[i]   = parseInt(hex.slice(1,3), 16);
      img.data[i+1] = parseInt(hex.slice(3,5), 16);
      img.data[i+2] = parseInt(hex.slice(5,7), 16);
      // soften the rim so the wheel does not look jagged
      img.data[i+3] = dist > r - 1.5 ? Math.round(255 * (r - dist) / 1.5) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function pickFromWheel(cv, ev, l) {
  const rect = cv.getBoundingClientRect();
  const r = rect.width / 2;
  const dx = ev.clientX - rect.left - r;
  const dy = ev.clientY - rect.top - r;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist > r) return null;                       // outside the disc
  const hue = (Math.atan2(dy, dx) * 180/Math.PI + 360) % 360;
  return hslToHex(hue, Math.min(1, dist / r), l);
}

function setStatus(text) { if (statusEl) statusEl.textContent = text; }

function build() {
  const host = document.createElement('div');
  host.id = 'dof-canvas-lite';
  const root = host.attachShadow({mode:'open'});   // isolated from page CSS

  // EVENT ISOLATION.
  // index.html listens for click and pointermove on window to drive stickers and
  // freehand drawing. Shadow DOM isolates CSS, not composed input events: a click
  // on a Lite button or pointer movement over this panel would otherwise bubble
  // through the host and also trigger the page controls. Stop those events at
  // the host in the normal bubbling phase, after Lite's own shadow controls have
  // received them but before they reach window. Pointer events cover mouse and
  // pen, while touch events are also isolated explicitly because index.html has
  // a separate body-level touchmove handler. Click also catches keyboard
  // activation of buttons. Do not preventDefault here: Lite should isolate its
  // UI from the host page without changing the controls' own browser behaviour.
  for (const type of [
    'click',
    'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'touchstart', 'touchmove', 'touchend', 'touchcancel'
  ]) {
    host.addEventListener(type, ev => ev.stopPropagation());
  }

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        position: fixed; right: 12px; bottom: 12px; z-index: 2147483000;
        width: 230px; padding: 10px; border-radius: 10px;
        background: #11151c; color: #e8edf5; border: 1px solid #2a3444;
        font: 12px/1.35 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.45);
      }
      .title { font-weight: 700; letter-spacing: .04em; margin-bottom: 8px; display:flex; justify-content:space-between; align-items:center; }
      .title small { font-weight: 400; opacity: .5; }
      .row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
      button {
        flex: 1 1 auto; min-width: 52px; padding: 6px 4px; cursor: pointer;
        background: #1b2230; color: #e8edf5; border: 1px solid #2f3a4c;
        border-radius: 6px; font: inherit;
      }
      button:hover { background: #26303f; }
      button.brand { background: #1d2b1f; border-color: #2f5136; }
      button.stop  { background: #3a1b1b; border-color: #5c2a2a; }
      .wheelwrap { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
      #wheel { cursor: crosshair; border-radius: 50%; display: block; }
      .preview { width: 30px; height: 30px; border-radius: 6px; border: 1px solid #3a4658; flex: 0 0 auto; }
      .hex { font-size: 10px; opacity: .6; letter-spacing: .06em; }
      input[type=range] { width: 100%; margin: 0 0 8px; accent-color: #7aa2ff; }
      input[type=text] {
        width: 100%; box-sizing: border-box; padding: 5px 6px; margin-bottom: 6px;
        background: #0c1017; color: #e8edf5; border: 1px solid #2f3a4c; border-radius: 6px; font: inherit;
      }
      .status { opacity: .6; min-height: 14px; }
      .label { opacity: .5; text-transform: uppercase; font-size: 10px; letter-spacing: .08em; margin: 2px 0 4px; }
    </style>
    <div class="panel">
      <div class="title"><span>CANVAS LITE</span><small>${VERSION}</small></div>

      <div class="label">Color</div>
      <div class="wheelwrap">
        <canvas id="wheel" width="${WHEEL_SIZE}" height="${WHEEL_SIZE}"></canvas>
        <div>
          <div class="preview" id="preview"></div>
          <div class="hex" id="hex"></div>
        </div>
      </div>
      <input type="range" id="light" min="10" max="90" value="50" title="lightness">

      <div class="label">Shapes</div>
      <div class="row">
        <button data-shape="heart">Heart</button>
        <button data-shape="star">Star</button>
        <button data-shape="circle">Circle</button>
        <button data-shape="triangle">Triangle</button>
        <button data-shape="square">Square</button>
        <button data-shape="spiral">Spiral</button>
      </div>

      <div class="label">Animate</div>
      <div class="row">
        <button data-anim="spin">Spin</button>
        <button data-anim="pulse">Pulse</button>
        <button data-anim="drift">Drift</button>
      </div>

      <div class="label">Graphics</div>
      <div class="row">
        <button class="brand" data-word="PUBNUB">PubNub</button>
        <button class="brand" data-stack="LIKE|SUB">Like &amp; Sub</button>
      </div>

      <div class="label">Your text</div>
      <input type="text" id="txt" maxlength="14" placeholder="short message">
      <div class="row"><button id="send">Draw text</button></div>

      <div class="row"><button class="stop" id="stop">STOP</button></div>
      <div class="status" id="status">ready</div>
    </div>
  `;

  // COLOR WHEEL WIRING.
  // The wheel painter and picker existed but were never connected: build()
  // still iterated a hard-coded swatch list that no longer exists anywhere in
  // the file, so installing threw a ReferenceError before the panel ever
  // appeared. Hue comes from the angle, saturation from the radius, and the
  // slider supplies lightness - repainting the wheel so the disc always shows
  // the colors actually reachable at the current lightness.
  wheelCanvas = root.getElementById('wheel');
  const lightEl = root.getElementById('light');
  const preview = root.getElementById('preview');
  const hexEl   = root.getElementById('hex');
  const showColor = () => {
    const current = getActiveColor();
    preview.style.background = current;
    hexEl.textContent = current;
  };
  paintWheel(wheelCanvas, lightness);
  // Mirror the engine's current colour into the standalone fallback without
  // changing the engine value. This keeps integrated and standalone state aligned.
  setActiveColor(getActiveColor());
  showColor();
  wheelCanvas.addEventListener('click', ev => {
    const hex = pickFromWheel(wheelCanvas, ev, lightness);
    if (hex) { setActiveColor(hex); showColor(); }
  });
  lightEl.addEventListener('input', () => {
    lightness = Number(lightEl.value) / 100;
    paintWheel(wheelCanvas, lightness);
  });

  statusEl = root.getElementById('status');

  root.querySelectorAll('[data-shape]').forEach(b =>
    b.addEventListener('click', () => drawShape(b.dataset.shape, getActiveColor())));

  root.querySelectorAll('[data-anim]').forEach(b =>
    b.addEventListener('click', () => animate('star', b.dataset.anim, getActiveColor())));

  root.querySelectorAll('[data-word]').forEach(b =>
    b.addEventListener('click', () => drawWord(b.dataset.word, getActiveColor())));
  root.querySelectorAll('[data-stack]').forEach(b =>
    b.addEventListener('click', () => drawLines(b.dataset.stack.split('|'), getActiveColor())));

  root.getElementById('send').addEventListener('click', () => {
    const input = root.getElementById('txt');
    const text = input.value.trim();
    if (!text) return;
    if (!isClean(text)) { setStatus('blocked — keep it kind'); return; }
    drawWord(text, getActiveColor());
  });

  root.getElementById('stop').addEventListener('click', stopAll);

  document.body.appendChild(host);
}

function install() {
  try {
    build();
    window.__DOF_CANVAS_LITE__ = {
      version: VERSION,
      // exposed for testing, not for driving output from the console
      _test: { isClean, layoutWord, chunkByTrack, trackCost, countPoints, Shapes, identityFor }
    };
    console.log('[DOF CANVAS LITE] ready', VERSION);
  } catch (err) {
    console.error('[DOF CANVAS LITE] install failed', err);
    throw err;
  } finally {
    delete window.__DOF_CANVAS_LITE_INSTALLING__;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, {once:true});
} else {
  install();
}
})();
