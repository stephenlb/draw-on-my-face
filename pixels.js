(() => {
  "use strict";

  const PUBNUB_SUBSCRIBE_KEY = "demo";
  const PUBNUB_CHANNEL = "pixels";
  const PUBLIC_KEY_B64 = "zB+OixXEDO2B8Mj1bZAFrY8s6AArNBFVbUDSPRyPN7o=";
  const MAX_COMMAND_AGE_MS = 30 * 1000;
  const MAX_PIXELS_PER_BATCH = 500;
  const MAX_LIVE_PIXELS = 150000;
  const MAX_PIXELS_PER_USER_PER_SEC = 200;
  const MAX_PIXEL_SIZE = 0.1;
  const usedNonces = new Set();

  let pubnub = null;
  let canvas = null;
  let context = null;
  let subscribed = false;
  let livePixels = [];
  let pendingPixels = [];
  let pixelSeq = 0;
  const userPixelStats = {};

  function acquireCanvas() {
    if (canvas && context) return true;
    const element = document.getElementById("canvas");
    if (!element) return false;
    canvas = element;
    context = canvas.getContext("2d");
    return !!context;
  }

  function clearCanvas() {
    if (!acquireCanvas()) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function base64ToBytes(value) {
    try {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch (err) {
      return null;
    }
  }

  function createSignedPayload(timestamp, nonce) {
    return "clear|" + timestamp + "|" + nonce;
  }

  async function verifySignature(timestamp, nonce, signatureB64) {
    try {
      if (!window.crypto || !window.crypto.subtle) return false;
      const publicKeyBytes = base64ToBytes(PUBLIC_KEY_B64);
      if (!publicKeyBytes || publicKeyBytes.length !== 32) return false;
      const signatureBytes = base64ToBytes(signatureB64);
      if (!signatureBytes || signatureBytes.length !== 64) return false;
      const payloadBytes = new TextEncoder().encode(createSignedPayload(timestamp, nonce));
      const publicKey = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, ["verify"]);
      return await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signatureBytes, payloadBytes);
    } catch (err) {
      return false;
    }
  }

  function handlePixelBatch(message) {
    if (!Array.isArray(message.pixels)) return;
    const now = Date.now();
    const defaultSize = typeof message.size === "number" ? Math.min(message.size, MAX_PIXEL_SIZE) : 0.008;
    const lifetimeMs = typeof message.fadeMs === "number" ? message.fadeMs : 150000;
    const id = message.userId || "anon";
    const stat = userPixelStats[id] || (userPixelStats[id] = { count: 0, windowStart: now });
    if (now - stat.windowStart > 1000) {
      stat.count = 0;
      stat.windowStart = now;
    }
    const batch = message.pixels.slice(0, MAX_PIXELS_PER_BATCH);
    batch.forEach((p) => {
      if (typeof p.x !== "number" || typeof p.y !== "number") return;
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
      if (typeof p.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(p.color)) return;
      if (stat.count >= MAX_PIXELS_PER_USER_PER_SEC) return;
      stat.count++;
      livePixels.push({
        x: p.x,
        y: p.y,
        color: p.color,
        size: typeof p.size === "number" ? Math.min(p.size, MAX_PIXEL_SIZE) : defaultSize,
        expiresAt: now + lifetimeMs
      });
    });
    if (livePixels.length > MAX_LIVE_PIXELS) {
      livePixels.splice(0, livePixels.length - MAX_LIVE_PIXELS);
    }
  }

  function queuePixel(x, y, color, opts) {
    pendingPixels.push({
      x: x,
      y: y,
      color: color,
      size: opts && opts.size
    });
  }

  function flushPixels() {
    if (pendingPixels.length === 0 || !pubnub) return;
    pixelSeq++;
    const batch = pendingPixels;
    pendingPixels = [];
    pubnub.publish({
      channel: PUBNUB_CHANNEL,
      message: {
        userId: window.userId || ("pixels-" + pixelSeq),
        seq: pixelSeq,
        size: 0.008,
        fadeMs: 150000,
        pixels: batch
      }
    });
  }

  setInterval(flushPixels, 190);

  setInterval(() => {
    const now = Date.now();
    Object.keys(userPixelStats).forEach(id => {
      if (now - userPixelStats[id].windowStart > 30000) delete userPixelStats[id];
    });
  }, 30000);

  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function(callback) {
    return nativeRequestAnimationFrame((timestamp) => {
      callback(timestamp);
      afterFrame();
    });
  };

  function afterFrame() {
    if (!acquireCanvas()) return;
    const now = Date.now();
    livePixels = livePixels.filter((p) => p.expiresAt > now);
    if (livePixels.length === 0) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    livePixels.forEach((p) => {
      const px = p.x * canvas.width;
      const py = p.y * canvas.height;
      const size = p.size * canvas.width;
      context.fillStyle = p.color;
      context.fillRect(px - size / 2, py - size / 2, size, size);
    });
    context.restore();
  }

  async function processMessage(message) {
    if (!message) return;
    if (Array.isArray(message.pixels)) {
      handlePixelBatch(message);
      return;
    }
    if (message.type !== "clear") return;
    if (typeof message.timestamp !== "number") return;
    if (typeof message.nonce !== "string" || message.nonce.length < 16) return;
    if (typeof message.signature !== "string") return;
    if (Math.abs(Date.now() - message.timestamp) > MAX_COMMAND_AGE_MS) return;
    if (usedNonces.has(message.nonce)) return;
    const valid = await verifySignature(message.timestamp, message.nonce, message.signature);
    if (!valid) return;
    usedNonces.add(message.nonce);
    if (usedNonces.size > 1000) {
      const oldest = usedNonces.values().next().value;
      usedNonces.delete(oldest);
    }
    clearCanvas();
  }

  function initializePubNub() {
    if (pubnub) return true;
    if (typeof window.PubNub !== "function") return false;
    if (!PUBNUB_SUBSCRIBE_KEY || PUBNUB_SUBSCRIBE_KEY === "YOUR_SUBSCRIBE_KEY") return false;
    if (!PUBLIC_KEY_B64 || PUBLIC_KEY_B64 === "YOUR_PUBLIC_KEY") return false;
    try {
      pubnub = window.PubNub({});
    } catch (err) {
      pubnub = null;
      return false;
    }
    return true;
  }

  function subscribe() {
    if (!initializePubNub() || subscribed) return;
    try {
      pubnub.subscribe({
        channel: PUBNUB_CHANNEL,
        messages: function(message) {
          processMessage(message);
        }
      });
    } catch (err) {
      return;
    }
    subscribed = true;
  }

  function initialize() {
    acquireCanvas();
    subscribe();
  }

  initialize();
  document.addEventListener("DOMContentLoaded", initialize);

  window.DrawOnMyFace = {
    clearLocal: clearCanvas
  };
  window.DrawOnMyFace.queuePixel = queuePixel;
  window.DrawOnMyFace.flushPixels = flushPixels;
  window.DrawOnMyFace.getLivePixelCount = () => livePixels.length;
})();
