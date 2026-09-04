(() => {
'use strict';

const VERSION = 'Connected by PubNub';
const READY_KEY = '__DOF_CANVAS_LITE__';
const INSTALLING_KEY = '__DOF_CANVAS_LITE_INSTALLING__';
const HOST_ID = 'dof-canvas-lite';
const IS_OVERLAY_MODE =
  new URLSearchParams(window.location.search).get('overlay') === 'true';

if (IS_OVERLAY_MODE) return;

if (window[READY_KEY] || window[INSTALLING_KEY]) return;
window[INSTALLING_KEY] = true;

const CHANNEL = 'coords';
const TOOL_ID = 'lite';
const POINTS_PER_SECOND = 50;
const SEND_INTERVAL_MS = 1000 / POINTS_PER_SECOND;
const MAX_ANIMATION_MS = 5000;
const RECEIVER_TRACK_CAP = 40;
const RECEIVER_POINT_LIFETIME_MS = 5000;
const MAX_IDENTITIES = 6;
const MAX_STROKESET_DRAW_MS = 4000;
const MAX_STROKESET_SLOTS = Math.floor(POINTS_PER_SECOND * MAX_STROKESET_DRAW_MS / 1000);
const TEXT_HOLD_MS = 0;
const REFRESH_MARGIN_MS = 100;
const SHAPE_SCALE = 0.25;
const WHEEL_SIZE = 116;
const WHEEL_LIGHTNESS = 0.5;
const REGION_COLS = 4;
const REGION_ROWS = 3;
const CENTRE_BIAS = 0.35;
const LOAD_WEIGHT = 8;
const SAMPLE_WIDTH = 96;
const SAMPLE_HEIGHT = 72;
const PEN_UP_STYLE = 'rgba(0,0,0,0)';


const BLOCKED_TERMS = [
  'fuck','shit','cunt','bitch','bastard','wanker','bollock','wank',
  'nigger','nigga','faggot','retard','tranny','paki','spic','chink','kike',
  'whore','slut','rape','porn','penis','vagina','boob','tit','anal','anus',
  'cock','dick','pussy','semen','cum','orgasm','masturbat','sex','horny',
  'nazi','hitler','kkk','heroin','cocaine','meth',
  'ass','arse','gay','damn','hell','crap','piss','bugger','git','twat',
  'prick','knob','fag','queer','dyke','homo','sod','bloody','bastards',
  'idiot','stupid','moron','loser','ugly','fat','die','kill','hate',
  'drunk','weed','vape','beer','vodka'
];

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blockedPattern = term => [...term].map(char => `${escapeRegExp(char)}+`).join('\\s*');
const BLOCKED_REGEX = BLOCKED_TERMS.map(term => new RegExp(`(?:^|\\s)${blockedPattern(term)}(?=\\s|$)`));

const Shapes = Object.freeze({
  circle(steps = 18) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const angle = -Math.PI / 2 + Math.PI * 2 * i / steps;
      points.push([0.5 + Math.cos(angle) * 0.34, 0.5 + Math.sin(angle) * 0.34]);
    }
    return points;
  },
  star() {
    const points = [];
    for (let i = 0; i <= 10; i++) {
      const angle = -Math.PI / 2 + Math.PI * 2 * i / 10;
      const radius = i % 2 === 0 ? 0.36 : 0.15;
      points.push([0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius]);
    }
    return points;
  },
  heart(steps = 24) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = Math.PI * 2 * i / steps;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      points.push([0.5 + x / 42, 0.52 - y / 42]);
    }
    return points;
  },
  triangle() {
    return [[0.5,0.18],[0.82,0.76],[0.18,0.76],[0.5,0.18]];
  },
  square() {
    return [[0.24,0.24],[0.76,0.24],[0.76,0.76],[0.24,0.76],[0.24,0.24]];
  },
  spiral(turns = 3, steps = 30) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = Math.PI * 2 * turns * t;
      const radius = 0.05 + 0.30 * t;
      points.push([0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius]);
    }
    return points;
  }
});

const Glyphs = Object.freeze({
  ' ':[],
  '!':[[[0.5,0],[0.5,0.72]],[[0.5,0.92],[0.5,0.94]]],
  '+':[[[0.1,0.5],[0.9,0.5]],[[0.5,0.1],[0.5,0.9]]],
  '-':[[[0.15,0.52],[0.85,0.52]]],
  '.':[[[0.5,0.93],[0.5,0.95]]],
  '/':[[[0.1,1],[0.9,0]]],
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
  ':':[[[0.5,0.32],[0.5,0.34]],[[0.5,0.72],[0.5,0.74]]],
  '?':[[[0.1,0.2],[0.28,0],[0.72,0],[0.9,0.2],[0.9,0.4],[0.5,0.62],[0.5,0.72]],[[0.5,0.92],[0.5,0.94]]],
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
});

let pubnub = null;
let seq = 0;
let activeController = null;
let fallbackColor = '#ff2d55';
let rainbowInk = false;
let rainbowHue = 0;
let wheelCanvas = null;
let statusEl = null;
let samplerCanvas = null;
let samplerContext = null;

function normaliseForFilter(text) {
  return String(text)
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7+]/g, 't')
    .replace(/[8]/g, 'b')
    .replace(/[9]/g, 'g')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isClean(text) {
  const normalised = normaliseForFilter(text);
  if (!normalised) return true;
  for (const regex of BLOCKED_REGEX) if (regex.test(normalised)) return false;
  return true;
}

function supportedText(text) {
  return [...String(text).toUpperCase()].filter(char => Glyphs[char] !== undefined).join('');
}

function layoutWord(word, box = {x:0.06, y:0.34, w:0.88, h:0.32}) {
  const chars = [...String(word).toUpperCase()].filter(char => Glyphs[char] !== undefined);
  if (!chars.length) return [];
  const advance = 1.15;
  const total = chars.length * advance;
  const strokes = [];
  chars.forEach((char, index) => {
    for (const stroke of Glyphs[char]) {
      strokes.push(stroke.map(([gx, gy]) => [
        box.x + box.w * ((index * advance + gx) / total),
        box.y + box.h * gy
      ]));
    }
  });
  return strokes;
}

function layoutLines(lines, box = {x:0.08, y:0.26, w:0.84, h:0.48}) {
  const rows = lines.map(String).filter(Boolean);
  if (!rows.length) return [];
  const advance = 1.15;
  const gapFraction = 0.22;
  const rowHeight = box.h / (rows.length + gapFraction * (rows.length - 1));
  const supportedRows = rows.map(row => [...row.toUpperCase()].filter(char => Glyphs[char] !== undefined));
  const longest = Math.max(...supportedRows.map(row => row.length), 1);
  const glyphWidth = box.w / (longest * advance);
  const strokes = [];
  supportedRows.forEach((chars, rowIndex) => {
    const lineWidth = chars.length * advance * glyphWidth;
    const x0 = box.x + (box.w - lineWidth) / 2;
    const y0 = box.y + rowIndex * rowHeight * (1 + gapFraction);
    chars.forEach((char, charIndex) => {
      for (const stroke of Glyphs[char]) {
        strokes.push(stroke.map(([gx, gy]) => [
          x0 + (charIndex * advance + gx) * glyphWidth,
          y0 + gy * rowHeight
        ]));
      }
    });
  });
  return strokes;
}

function strokeCost(stroke) {
  if (!stroke.length) return 0;
  return stroke.length === 1 ? 2 : stroke.length;
}

function trackCost(strokes) {
  let total = 0;
  for (const stroke of strokes) total += strokeCost(stroke);
  return total;
}

function chunkByTrack(strokes, cap = RECEIVER_TRACK_CAP) {
  const chunks = [];
  let current = [];
  let used = 0;
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    const cost = strokeCost(stroke);
    if (cost > cap) throw new RangeError(`Stroke requires ${cost} receiver slots; track cap is ${cap}`);
    if (used + cost > cap && current.length) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(stroke);
    used += cost;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function fitWord(word) {
  const source = String(word);
  const supported = supportedText(source);
  let text = supported;
  while (text.length) {
    const strokes = layoutWord(text);
    const slots = trackCost(strokes);
    const chunks = chunkByTrack(strokes).length;
    if (slots <= MAX_STROKESET_SLOTS && chunks <= MAX_IDENTITIES) {
      return {
        text,
        changed:text !== source.toUpperCase(),
        trimmed:text.length < supported.length,
        slots,
        chunks,
        strokes
      };
    }
    text = text.slice(0, -1);
  }
  return {text:'', changed:source.length > 0, trimmed:supported.length > 0, slots:0, chunks:0, strokes:[]};
}

function validateConfiguration() {
  if (!(POINTS_PER_SECOND > 0)) throw new RangeError('POINTS_PER_SECOND must be positive');
  if (!(MAX_STROKESET_DRAW_MS > 0 && MAX_STROKESET_DRAW_MS < RECEIVER_POINT_LIFETIME_MS)) throw new RangeError('Stroke-set draw budget must be shorter than receiver point lifetime');
  if (MAX_IDENTITIES < 1) throw new RangeError('MAX_IDENTITIES must be at least 1');
  for (const [name, createShape] of Object.entries(Shapes)) {
    const cost = trackCost([createShape()]);
    if (cost > RECEIVER_TRACK_CAP) throw new RangeError(`${name} requires ${cost} receiver slots; track cap is ${RECEIVER_TRACK_CAP}`);
  }
  for (const [char, strokes] of Object.entries(Glyphs)) {
    for (const stroke of strokes) {
      const cost = strokeCost(stroke);
      if (cost > RECEIVER_TRACK_CAP) throw new RangeError(`Glyph ${char} contains a stroke requiring ${cost} receiver slots`);
    }
  }
  for (const [name, strokes] of [['PUBNUB', layoutWord('PUBNUB')], ['LIKE|SUB', layoutLines(['LIKE','SUB'])]]) {
    const slots = trackCost(strokes);
    const chunks = chunkByTrack(strokes).length;
    if (slots > MAX_STROKESET_SLOTS || chunks > MAX_IDENTITIES) throw new RangeError(`${name} exceeds configured structured-output limits`);
  }
}

function client() {
  if (pubnub) return pubnub;
  if (typeof window.PubNub !== 'function') throw new Error('PubNub runtime unavailable');
  pubnub = window.PubNub({});
  if (!pubnub || typeof pubnub.publish !== 'function') throw new Error('PubNub publisher unavailable');
  return pubnub;
}

function identityBase() {
  if (window.__DOF_LITE_ID) return window.__DOF_LITE_ID;
  const token = window.crypto && typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  window.__DOF_LITE_ID = `lite-${token}`;
  return window.__DOF_LITE_ID;
}

function identityFor(index) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_IDENTITIES) throw new RangeError('Lite identity index out of range');
  const base = identityBase();
  return index === 0 ? base : `${base}~${index}`;
}

function sendPoint(x, y, style, userId) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Point coordinates must be finite numbers');
  client().publish({
    channel: CHANNEL,
    message: {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      userId,
      style,
      seq: ++seq,
      tool: TOOL_ID
    }
  });
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function sleep(ms, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, Math.max(0, ms));
    signal.addEventListener('abort', aborted, {once:true});
    function done() {
      signal.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(abortError());
    }
  });
}

function assertRun(context) {
  if (context.signal.aborted) throw abortError();
  if (performance.now() > context.deadline) throw new DOMException('Action deadline exceeded', 'TimeoutError');
}

async function emitPoint(context, x, y, style, userId) {
  assertRun(context);
  const delay = context.nextSendAt - performance.now();
  if (delay > 0) await sleep(delay, context.signal);
  assertRun(context);
  sendPoint(x, y, resolveInkStyle(style), userId);
  context.nextSendAt = performance.now() + SEND_INTERVAL_MS;
}

async function drawStrokes(strokes, style, context, userId) {
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    await emitPoint(context, stroke[0][0], stroke[0][1], PEN_UP_STYLE, userId);
    if (stroke.length === 1) {
      await emitPoint(context, stroke[0][0], stroke[0][1], style, userId);
      continue;
    }
    for (let index = 1; index < stroke.length; index++) {
      const [x, y] = stroke[index];
      await emitPoint(context, x, y, style, userId);
    }
  }
}

async function drawChunks(chunks, style, context) {
  if (chunks.length > MAX_IDENTITIES) throw new RangeError(`Stroke set requires ${chunks.length} Lite tracks; maximum is ${MAX_IDENTITIES}`);
  for (let index = 0; index < chunks.length; index++) {
    await drawStrokes(chunks[index], style, context, identityFor(index));
  }
}

async function run(task, budgetMs = MAX_ANIMATION_MS, initialStatus = 'drawing…') {
  if (activeController) activeController.abort();
  const controller = new AbortController();
  activeController = controller;
  const context = {
    signal:controller.signal,
    deadline:performance.now() + budgetMs,
    nextSendAt:performance.now()
  };
  setStatus(initialStatus);
  try {
    await task(context);
    if (activeController === controller && !controller.signal.aborted) setStatus('done');
  } catch (error) {
    if (activeController !== controller || error?.name === 'AbortError') return;
    if (error?.name === 'TimeoutError') setStatus('time limit');
    else setStatus(`error: ${error?.message || error}`);
  } finally {
    if (activeController === controller) activeController = null;
  }
}

function stopAll() {
  if (activeController) activeController.abort();
  activeController = null;
  setStatus('stopped');
}

function screenAspect() {
  const canvas = document.getElementById('canvas');
  const width = canvas?.clientWidth || window.innerWidth || 1;
  const height = canvas?.clientHeight || window.innerHeight || 1;
  return height / width;
}

function transformPoints(points, {scale = 1, rotate = 0, cx = 0.5, cy = 0.5, square = true} = {}) {
  const cos = Math.cos(rotate);
  const sin = Math.sin(rotate);
  const aspect = square ? screenAspect() : 1;
  const local = points.map(([x, y]) => {
    const px = (x - 0.5) * scale;
    const py = (y - 0.5) * scale;
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    return [rx * aspect, ry];
  });
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of local) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const fitScale = Math.min(1, width > 0 ? 1 / width : 1, height > 0 ? 1 / height : 1);
  const fitted = local.map(([x, y]) => [cx + x * fitScale, cy + y * fitScale]);
  minX = Math.min(...fitted.map(point => point[0]));
  maxX = Math.max(...fitted.map(point => point[0]));
  minY = Math.min(...fitted.map(point => point[1]));
  maxY = Math.max(...fitted.map(point => point[1]));
  const shiftX = minX < 0 ? -minX : maxX > 1 ? 1 - maxX : 0;
  const shiftY = minY < 0 ? -minY : maxY > 1 ? 1 - maxY : 0;
  return fitted.map(([x, y]) => [x + shiftX, y + shiftY]);
}

function sampler() {
  if (samplerCanvas && samplerContext) return [samplerCanvas, samplerContext];
  samplerCanvas = document.createElement('canvas');
  samplerCanvas.width = SAMPLE_WIDTH;
  samplerCanvas.height = SAMPLE_HEIGHT;
  samplerContext = samplerCanvas.getContext('2d', {willReadFrequently:true});
  if (!samplerContext) throw new Error('Canvas sampler unavailable');
  return [samplerCanvas, samplerContext];
}

function quietestRegion() {
  const source = document.getElementById('canvas');
  if (!source || !source.width || !source.height) return {x:0.5, y:0.5, load:0, fallback:true};
  try {
    const [sampleCanvas, sampleContext] = sampler();
    sampleContext.clearRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    sampleContext.drawImage(source, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const data = sampleContext.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
    const loads = new Uint16Array(REGION_COLS * REGION_ROWS);
    const regionWidth = SAMPLE_WIDTH / REGION_COLS;
    const regionHeight = SAMPLE_HEIGHT / REGION_ROWS;
    for (let y = 0; y < SAMPLE_HEIGHT; y++) {
      const row = Math.min(REGION_ROWS - 1, Math.floor(y / regionHeight));
      for (let x = 0; x < SAMPLE_WIDTH; x++) {
        if (data[(y * SAMPLE_WIDTH + x) * 4 + 3] <= 16) continue;
        const col = Math.min(REGION_COLS - 1, Math.floor(x / regionWidth));
        loads[row * REGION_COLS + col]++;
      }
    }
    const samplesPerRegion = regionWidth * regionHeight;
    let bestIndex = 0;
    let bestScore = Infinity;
    for (let index = 0; index < loads.length; index++) {
      const col = index % REGION_COLS;
      const row = Math.floor(index / REGION_COLS);
      const x = (col + 0.5) / REGION_COLS;
      const y = (row + 0.5) / REGION_ROWS;
      const distance = Math.hypot(x - 0.5, y - 0.45);
      const score = (loads[index] / samplesPerRegion) * LOAD_WEIGHT + distance * CENTRE_BIAS;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const col = bestIndex % REGION_COLS;
    const row = Math.floor(bestIndex / REGION_COLS);
    return {
      x:(col + 0.5) / REGION_COLS,
      y:(row + 0.5) / REGION_ROWS,
      load:Math.round(100 * loads[bestIndex] / samplesPerRegion),
      region:`${col + 1},${row + 1}`
    };
  } catch {
    return {x:0.5, y:0.5, load:0, fallback:true};
  }
}

async function drawShape(name, style) {
  const shape = Shapes[name];
  if (typeof shape !== 'function') throw new Error(`Unknown shape: ${name}`);
  const spot = quietestRegion();
  const points = transformPoints(shape(), {scale:SHAPE_SCALE, cx:spot.x, cy:spot.y});
  const status = `drawing in region ${spot.region || 'centre'} (${spot.load ?? 0}% busy)`;
  await run(context => drawStrokes([points], style, context, identityFor(0)), MAX_ANIMATION_MS, status);
}

async function animate(name, mode, style) {
  const shape = Shapes[name];
  if (typeof shape !== 'function') throw new Error(`Unknown shape: ${name}`);
  const base = shape();
  const spot = quietestRegion();
  const status = `animating in region ${spot.region || 'centre'} (${spot.load ?? 0}% busy)`;
  await run(async context => {
    let pass = 0;
    while (performance.now() < context.deadline && !context.signal.aborted) {
      const options = {scale:SHAPE_SCALE, cx:spot.x, cy:spot.y};
      if (mode === 'spin') options.rotate = pass * 0.5;
      else if (mode === 'pulse') options.scale = SHAPE_SCALE * (0.6 + 0.4 * Math.abs(Math.sin(pass * 0.6)));
      else if (mode === 'drift') {
        options.cx = spot.x + Math.sin(pass * 0.7) * 0.10;
        options.cy = spot.y + Math.cos(pass * 0.5) * 0.08;
      } else {
        throw new Error(`Unknown animation mode: ${mode}`);
      }
      await drawStrokes([transformPoints(base, options)], style, context, identityFor(0));
      pass++;
    }
  }, MAX_ANIMATION_MS, status);
}

async function holdStrokeSet(chunks, style, context, initialDuration) {
  const fullVisibilityWithoutRefresh = RECEIVER_POINT_LIFETIME_MS - initialDuration;
  const holdStart = performance.now();
  const holdUntil = holdStart + TEXT_HOLD_MS;
  if (fullVisibilityWithoutRefresh < TEXT_HOLD_MS + REFRESH_MARGIN_MS) {
    setStatus('refreshing…');
    await drawChunks(chunks, style, context);
  }
  const remaining = holdUntil - performance.now();
  if (remaining > 0) {
    setStatus('holding…');
    await sleep(remaining, context.signal);
  }
}

async function drawStrokeSet(strokes, style, initialStatus = 'drawing…') {
  if (!strokes.length) throw new Error('No supported strokes to draw');
  const slots = trackCost(strokes);
  const chunks = chunkByTrack(strokes);
  if (slots > MAX_STROKESET_SLOTS) throw new RangeError(`Stroke set requires ${slots} slots; safe pass budget is ${MAX_STROKESET_SLOTS}`);
  if (chunks.length > MAX_IDENTITIES) throw new RangeError(`Stroke set requires ${chunks.length} Lite tracks; maximum is ${MAX_IDENTITIES}`);
  const estimatedPassMs = slots * SEND_INTERVAL_MS;
  const budgetMs = estimatedPassMs * 2 + TEXT_HOLD_MS + 1000;
  await run(async context => {
    const initialStartedAt = performance.now();
    await drawChunks(chunks, style, context);
    const initialDuration = performance.now() - initialStartedAt;
    await holdStrokeSet(chunks, style, context, initialDuration);
  }, budgetMs, initialStatus);
}

async function drawWord(word, style) {
  const fit = fitWord(word);
  if (!fit.text) {
    setStatus('no supported characters');
    return;
  }
  const source = String(word).toUpperCase();
  const status = fit.text === source ? 'drawing…' : `drawing "${fit.text}" to fit supported receiver output`;
  await drawStrokeSet(fit.strokes, style, status);
}

async function drawLines(lines, style) {
  await drawStrokeSet(layoutLines(lines), style);
}

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
  if (api && typeof api.setDrawColor === 'function') api.setDrawColor(hex);
  return hex;
}

function hslToHex(h, s, l) {
  const channel = n => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const value = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
function resolveInkStyle(style) {
  if (style === PEN_UP_STYLE) return style;
  const api = window.DrawOnMyFace;
  if (api && typeof api.nextInkStyle === 'function') return api.nextInkStyle(style);
  if (!rainbowInk) return style;

  const color = hslToHex(rainbowHue, 1, 0.5);
  rainbowHue = (rainbowHue + 18) % 360;

  return color;
}
function paintWheel(canvas) {
  const context = canvas.getContext('2d');
  const radius = canvas.width / 2;
  const image = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const dx = x - radius;
      const dy = y - radius;
      const distance = Math.hypot(dx, dy);
      const index = (y * canvas.width + x) * 4;
      if (distance > radius) {
        image.data[index + 3] = 0;
        continue;
      }
      const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const saturation = Math.min(1, distance / radius);
      const hex = hslToHex(hue, saturation, WHEEL_LIGHTNESS);
      image.data[index] = parseInt(hex.slice(1, 3), 16);
      image.data[index + 1] = parseInt(hex.slice(3, 5), 16);
      image.data[index + 2] = parseInt(hex.slice(5, 7), 16);
      image.data[index + 3] = distance > radius - 1.5 ? Math.round(255 * (radius - distance) / 1.5) : 255;
    }
  }
  context.putImageData(image, 0, 0);
}

function pickFromWheel(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const radius = rect.width / 2;
  const dx = event.clientX - rect.left - radius;
  const dy = event.clientY - rect.top - radius;
  const distance = Math.hypot(dx, dy);
  if (distance > radius) return null;
  const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  return hslToHex(hue, Math.min(1, distance / radius), WHEEL_LIGHTNESS);
}

let statusResetTimer = null;

function setStatus(text) {
  console.debug('[CANVAS LITE STATUS]', text);

  if (!statusEl) return;
  if (!String(text).startsWith('blocked')) return;

  clearTimeout(statusResetTimer);

  statusEl.textContent = 'blocked - keep it kind';

  statusResetTimer = setTimeout(() => {
    if (statusEl) statusEl.textContent = 'ready';
  }, 2500);
}

function destroy() {
  stopAll();
  document.getElementById(HOST_ID)?.remove();
  wheelCanvas = null;
  statusEl = null;
  delete window[READY_KEY];
  delete window[INSTALLING_KEY];
  clearTimeout(statusResetTimer);
  statusResetTimer = null;
}

function build() {
  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({mode:'open'});

  for (const type of ['click','pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel']) {
    host.addEventListener(type, event => event.stopPropagation());
  }

  root.innerHTML = `
    <style>
      :host{all:initial}
      .panel{position:fixed;right:12px;bottom:12px;z-index:2147483000;width:230px;padding:10px;border-radius:10px;background:#11151c;color:#e8edf5;border:1px solid #2a3444;font:12px/1.35 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45)}
      .title{font-weight:700;letter-spacing:.04em;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
      .title-tools{display:flex;align-items:center;gap:6px}
      .title small{font-weight:400;opacity:.5}
      .row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
      button{flex:1 1 auto;min-width:52px;padding:6px 4px;cursor:pointer;background:#1b2230;color:#e8edf5;border:1px solid #2f3a4c;border-radius:6px;font:inherit}
      button:hover{background:#26303f}
      button.brand{background:#1d2b1f;border-color:#2f5136}
      button.stop{background:#3a1b1b;border-color:#5c2a2a}
      button.min{flex:0 0 auto;min-width:0;width:18px;height:18px;padding:0;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;border-radius:4px}
      .wheelwrap{display:flex;align-items:center;gap:10px;margin-bottom:8px}
      .color-column{
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:6px
      }

      button.rainbow{
        flex:0 0 auto;
        min-width:0;
        width:30px;
        height:30px;
        padding:0;
        border-radius:6px;
        border:1px solid #3a4658;
        background:conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);
      }
      button.rainbow[aria-pressed="true"]{outline:2px solid #e8edf5;outline-offset:2px}


      #wheel{cursor:crosshair;border-radius:50%;display:block;touch-action:none}
      .preview{width:30px;height:30px;border-radius:6px;border:1px solid #3a4658;flex:0 0 auto}
      .hex{font-size:10px;opacity:.6;letter-spacing:.06em}
      input[type=text]{width:100%;box-sizing:border-box;padding:5px 6px;margin-bottom:6px;background:#0c1017;color:#e8edf5;border:1px solid #2f3a4c;border-radius:6px;font:inherit}
      .status{opacity:.6;min-height:14px}
      .label{opacity:.5;text-transform:uppercase;font-size:10px;letter-spacing:.08em;margin:2px 0 4px}
    </style>
    <div class="panel">
      <div class="title"><span>CANVAS LITE</span><span class="title-tools"><small>${VERSION}</small><button type="button" class="min" id="minBtn" title="Minimize" aria-label="Minimize panel">−</button></span></div>
      <div id="panelBody">
        <div class="label">Color</div>
        <div class="wheelwrap"><canvas id="wheel" width="${WHEEL_SIZE}" height="${WHEEL_SIZE}"></canvas>
        <div class="color-column"><button type="button" class="rainbow" id="rainbow" title="Rainbow ink" aria-label="Rainbow ink"></button>
        <div class="preview" id="preview"></div>
        <div class="hex" id="hex"></div>
      </div>
    </div>
        <div class="label">Shapes</div>
        <div class="row"><button data-shape="heart">Heart</button><button data-shape="star">Star</button><button data-shape="circle">Circle</button><button data-shape="triangle">Triangle</button><button data-shape="square">Square</button><button data-shape="spiral">Spiral</button></div>
        <div class="label">Animate</div>
        <div class="row"><button data-anim="spin">Spin</button><button data-anim="pulse">Pulse</button><button data-anim="drift">Drift</button></div>
        <div class="label">Graphics</div>
        <div class="row"><button class="brand" data-word="PUBNUB">PubNub</button><button class="brand" data-stack="LIKE|SUB">Like &amp; Sub</button></div>
        <div class="label">Your text</div>
        <input type="text" id="txt" maxlength="14" placeholder="short message">
        <div class="row"><button id="send">Draw text</button></div>
        <div class="row"><button class="stop" id="stop">STOP</button></div>
        <div class="status" id="status">ready</div>
      </div>
    </div>`;

  wheelCanvas = root.getElementById('wheel');
  statusEl = root.getElementById('status');
  const rainbowButton = root.getElementById('rainbow');
  const preview = root.getElementById('preview');
  const hex = root.getElementById('hex');  
  const panelBody = root.getElementById('panelBody');
  const minButton = root.getElementById('minBtn');
  const textInput = root.getElementById('txt');
  const showColor = () => {
    const current = getActiveColor();
    preview.style.background = current;
    hex.textContent = current;
  };

  paintWheel(wheelCanvas);
  setActiveColor(getActiveColor());
  showColor();
  rainbowInk = false;
  window.DrawOnMyFace?.setInkMode?.('solid');
  rainbowButton.setAttribute('aria-pressed', 'false');

rainbowButton.addEventListener('click', () => {
  rainbowInk = true;
  rainbowHue = 0;
  window.DrawOnMyFace?.setInkMode?.('rainbow');
  rainbowButton.setAttribute('aria-pressed', 'true');
});

wheelCanvas.addEventListener('pointerdown', event => {
  const color = pickFromWheel(wheelCanvas, event);
  if (!color) return;

  rainbowInk = false;
  window.DrawOnMyFace?.setInkMode?.('solid');
  rainbowButton.setAttribute('aria-pressed', 'false');

  setActiveColor(color);
  showColor();
});

  minButton.addEventListener('click', () => {
    panelBody.hidden = !panelBody.hidden;
    minButton.textContent = panelBody.hidden ? '+' : '−';
    minButton.title = panelBody.hidden ? 'Expand' : 'Minimize';
    minButton.setAttribute('aria-label', minButton.title + ' panel');
  });

  root.querySelectorAll('[data-shape]').forEach(button => {
    button.addEventListener('click', () => drawShape(button.dataset.shape, getActiveColor()));
  });

  root.querySelectorAll('[data-anim]').forEach(button => {
    button.addEventListener('click', () => animate('star', button.dataset.anim, getActiveColor()));
  });

  root.querySelectorAll('[data-word]').forEach(button => {
    button.addEventListener('click', () => drawWord(button.dataset.word, getActiveColor()));
  });

  root.querySelectorAll('[data-stack]').forEach(button => {
    button.addEventListener('click', () => drawLines(button.dataset.stack.split('|'), getActiveColor()));
  });

  root.getElementById('send').addEventListener('click', () => {
    const text = textInput.value.trim();
    if (!text) return;
    if (!isClean(text)) {
      setStatus('blocked - keep it kind');
      return;
    }
    drawWord(text, getActiveColor());
  });

  textInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') root.getElementById('send').click();
  });

  root.getElementById('stop').addEventListener('click', stopAll);
  document.body.appendChild(host);
}

function install() {
  try {
    validateConfiguration();
    build();
    window[READY_KEY] = {
      version:VERSION,
      destroy,
      _test:{isClean,supportedText,layoutWord,layoutLines,strokeCost,trackCost,chunkByTrack,fitWord,transformPoints,quietestRegion,Shapes,identityFor}
    };
    console.log('[DOF CANVAS LITE] ready', VERSION);
  } catch (error) {
    document.getElementById(HOST_ID)?.remove();
    console.error('[DOF CANVAS LITE] install failed', error);
    throw error;
  } finally {
    delete window[INSTALLING_KEY];
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
else install();
})();
