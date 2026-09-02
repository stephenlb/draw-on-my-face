(() => {
  "use strict";

  /*
   * ============================================================
   * Draw On My Face
   * SIGNED CLEAR-ONLY CLIENT
   * ============================================================
   *
   * This replacement intentionally does NOT contain the
   * original drawing/pixel features.
   *
   * It only:
   *
   *   - connects to PubNub
   *   - subscribes to "pixels"
   *   - accepts signed clear commands
   *   - verifies Ed25519 signatures
   *   - clears the canvas after successful verification
   *
   * ============================================================
   */


  // ============================================================
  // CONFIGURATION
  // ============================================================

  /*
   * clear_client.py automatically replaces this value with
   * your configured PubNub Subscribe Key.
   */
  const PUBNUB_SUBSCRIBE_KEY =
    "demo";

  /*
   * Draw On My Face channel.
   */
  const PUBNUB_CHANNEL =
    "pixels";

  /*
   * Ed25519 PUBLIC KEY.
   *
   * clear_client.py automatically replaces this value.
   *
   * NEVER put the private key in this file.
   */
  const PUBLIC_KEY_B64 =
    "zB+OixXEDO2B8Mj1bZAFrY8s6AArNBFVbUDSPRyPN7o=";


  // ============================================================
  // SECURITY
  // ============================================================

  /*
   * Commands older than this are rejected.
   *
   * This prevents old valid commands from being replayed
   * much later.
   */
  const MAX_COMMAND_AGE_MS =
    30 * 1000;


  /*
   * Nonces already processed by this page.
   */
  const usedNonces =
    new Set();


  // ============================================================
  // STATE
  // ============================================================

  let pubnub = null;

  let canvas = null;

  let context = null;

  let subscribed = false;

  let livePixels = [];

  let pendingPixels = [];

  let pixelSeq = 0;


  // ============================================================
  // LOGGING
  // ============================================================

  function log(...args) {

    console.log(
      "[DrawOnMyFace]",
      ...args
    );

  }


  function warn(...args) {

    console.warn(
      "[DrawOnMyFace]",
      ...args
    );

  }


  function error(...args) {

    console.error(
      "[DrawOnMyFace]",
      ...args
    );

  }


  // ============================================================
  // CANVAS
  // ============================================================

  function acquireCanvas() {

    if (
      canvas &&
      context
    ) {

      return true;

    }


    const element =
      document.getElementById(
        "canvas"
      );


    if (!element) {

      warn(
        "Canvas element not found."
      );

      return false;

    }


    canvas =
      element;


    context =
      canvas.getContext(
        "2d"
      );


    if (!context) {

      error(
        "Could not obtain 2D canvas context."
      );

      return false;

    }


    log(
      "Canvas acquired:",
      canvas.width,
      "x",
      canvas.height
    );


    return true;

  }


  // ============================================================
  // CLEAR CANVAS
  // ============================================================

  function clearCanvas() {

    if (
      !acquireCanvas()
    ) {

      warn(
        "Canvas is not available."
      );

      return;

    }


    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );


    log(
      "Canvas cleared."
    );

  }


  // ============================================================
  // BASE64 DECODER
  // ============================================================

  function base64ToBytes(
    value
  ) {

    try {

      const binary =
        atob(value);


      const bytes =
        new Uint8Array(
          binary.length
        );


      for (
        let i = 0;
        i < binary.length;
        i++
      ) {

        bytes[i] =
          binary.charCodeAt(i);

      }


      return bytes;

    } catch (err) {

      error(
        "Invalid Base64 data:",
        err
      );

      return null;

    }

  }


  // ============================================================
  // SIGNED PAYLOAD
  // ============================================================

  /*
   * clear_client.py signs EXACTLY:
   *
   * clear|timestamp|nonce
   *
   * JavaScript must create the exact same byte sequence.
   */
  function createSignedPayload(
    timestamp,
    nonce
  ) {

    return (
      "clear"
      + "|"
      + timestamp
      + "|"
      + nonce
    );

  }


  // ============================================================
  // ED25519 VERIFICATION
  // ============================================================

  async function verifySignature(
    timestamp,
    nonce,
    signatureB64
  ) {

    try {

      if (
        !window.crypto ||
        !window.crypto.subtle
      ) {

        error(
          "Web Crypto API is unavailable."
        );

        return false;

      }


      // --------------------------------------------------------
      // PUBLIC KEY
      // --------------------------------------------------------

      const publicKeyBytes =
        base64ToBytes(
          PUBLIC_KEY_B64
        );


      if (!publicKeyBytes) {

        return false;

      }


      if (
        publicKeyBytes.length !==
        32
      ) {

        error(
          "Invalid Ed25519 public key length:",
          publicKeyBytes.length
        );

        return false;

      }


      // --------------------------------------------------------
      // SIGNATURE
      // --------------------------------------------------------

      const signatureBytes =
        base64ToBytes(
          signatureB64
        );


      if (!signatureBytes) {

        return false;

      }


      if (
        signatureBytes.length !==
        64
      ) {

        error(
          "Invalid Ed25519 signature length:",
          signatureBytes.length
        );

        return false;

      }


      // --------------------------------------------------------
      // PAYLOAD
      // --------------------------------------------------------

      const payload =
        createSignedPayload(
          timestamp,
          nonce
        );


      log(
        "Verifying payload:",
        payload
      );


      const payloadBytes =
        new TextEncoder().encode(
          payload
        );


      // --------------------------------------------------------
      // IMPORT PUBLIC KEY
      // --------------------------------------------------------

      const publicKey =
        await crypto.subtle.importKey(

          "raw",

          publicKeyBytes,

          {
            name:
              "Ed25519"
          },

          false,

          [
            "verify"
          ]

        );


      // --------------------------------------------------------
      // VERIFY
      // --------------------------------------------------------

      const valid =
        await crypto.subtle.verify(

          {
            name:
              "Ed25519"
          },

          publicKey,

          signatureBytes,

          payloadBytes

        );


      return valid;

    } catch (err) {

      error(
        "Ed25519 verification failed:",
        err
      );

      return false;

    }

  }


  // ============================================================
  // PIXEL DRAWING
  // ============================================================

  function handlePixelBatch(message) {

    const now =
      Date.now();

    const defaultSize =
      typeof message.size === "number"
        ? message.size
        : 0.008;

    const lifetimeMs =
      typeof message.fadeMs === "number"
        ? message.fadeMs
        : 150000;

    message.pixels.forEach((p) => {

      if (
        typeof p.x !== "number" ||
        typeof p.y !== "number" ||
        typeof p.color !== "string"
      ) {
        return;
      }

      livePixels.push({
        x: p.x,
        y: p.y,
        color: p.color,
        size:
          typeof p.size === "number"
            ? p.size
            : defaultSize,
        expiresAt:
          now + lifetimeMs
      });

    });

    if (livePixels.length > 150000) {
      livePixels.splice(0, livePixels.length - 150000);
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

    if (
      pendingPixels.length === 0 ||
      !pubnub
    ) {
      return;
    }

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


  const nativeRequestAnimationFrame =
    window.requestAnimationFrame.bind(window);

  window.requestAnimationFrame = function(callback) {

    return nativeRequestAnimationFrame((timestamp) => {
      callback(timestamp);
      afterFrame();
    });

  };


  function afterFrame() {

    if (!acquireCanvas()) {
      return;
    }

    const now = Date.now();

    livePixels =
      livePixels.filter((p) => p.expiresAt > now);

    if (livePixels.length === 0) {
      return;
    }

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);

    livePixels.forEach((p) => {

      const px = p.x * canvas.width;
      const py = p.y * canvas.height;
      const size = p.size * canvas.width;

      context.fillStyle = p.color;

      context.fillRect(
        px - size / 2,
        py - size / 2,
        size,
        size
      );

    });

    context.restore();

  }


  // ============================================================
  // PROCESS PUBNUB MESSAGE
  // ============================================================

  async function processMessage(
    message
  ) {

    log(
      "RECEIVED:",
      message
    );


    if (!message) {

      warn(
        "Ignored empty message."
      );

      return;

    }


    if (
      Array.isArray(
        message.pixels
      )
    ) {

      handlePixelBatch(
        message
      );

      return;

    }


    // ----------------------------------------------------------
    // ONLY ACCEPT CLEAR
    // ----------------------------------------------------------

    if (
      message.type !==
      "clear"
    ) {

      log(
        "Ignored non-clear message."
      );

      return;

    }


    log(
      "Clear command received."
    );


    // ----------------------------------------------------------
    // TIMESTAMP
    // ----------------------------------------------------------

    if (
      typeof message.timestamp !==
      "number"
    ) {

      warn(
        "Rejected: invalid timestamp."
      );

      return;

    }


    // ----------------------------------------------------------
    // NONCE
    // ----------------------------------------------------------

    if (
      typeof message.nonce !==
      "string"
    ) {

      warn(
        "Rejected: invalid nonce."
      );

      return;

    }


    if (
      message.nonce.length < 16
    ) {

      warn(
        "Rejected: nonce is too short."
      );

      return;

    }


    // ----------------------------------------------------------
    // SIGNATURE
    // ----------------------------------------------------------

    if (
      typeof message.signature !==
      "string"
    ) {

      warn(
        "Rejected: missing signature."
      );

      return;

    }


    // ----------------------------------------------------------
    // TIMESTAMP PROTECTION
    // ----------------------------------------------------------

    const now =
      Date.now();


    const age =
      Math.abs(
        now -
        message.timestamp
      );


    log(
      "Command age:",
      age,
      "ms"
    );


    if (
      age >
      MAX_COMMAND_AGE_MS
    ) {

      warn(
        "Rejected: command expired."
      );

      return;

    }


    // ----------------------------------------------------------
    // REPLAY PROTECTION
    // ----------------------------------------------------------

    if (
      usedNonces.has(
        message.nonce
      )
    ) {

      warn(
        "Rejected: nonce already used."
      );

      return;

    }


    // ----------------------------------------------------------
    // CRYPTOGRAPHIC VERIFICATION
    // ----------------------------------------------------------

    log(
      "Checking Ed25519 signature..."
    );


    const valid =
      await verifySignature(

        message.timestamp,

        message.nonce,

        message.signature

      );


    if (!valid) {

      warn(
        "Rejected: INVALID SIGNATURE."
      );

      return;

    }


    // ----------------------------------------------------------
    // STORE NONCE
    // ----------------------------------------------------------

    usedNonces.add(
      message.nonce
    );


    /*
     * Prevent unlimited memory growth.
     */
    if (
      usedNonces.size >
      1000
    ) {

      const iterator =
        usedNonces.values();


      const oldest =
        iterator.next().value;


      usedNonces.delete(
        oldest
      );

    }


    // ----------------------------------------------------------
    // VALID COMMAND
    // ----------------------------------------------------------

    log(
      "VALID SIGNED CLEAR COMMAND."
    );


    clearCanvas();

  }


  // ============================================================
  // PUBNUB INITIALIZATION
  // ============================================================

  function initializePubNub() {

    if (pubnub) {

      return true;

    }


    // ----------------------------------------------------------
    // SDK CHECK
    // ----------------------------------------------------------

    if (
      typeof window.PubNub !==
      "function"
    ) {

      error(
        "PubNub SDK not found."
      );

      return false;

    }


    // ----------------------------------------------------------
    // SUBSCRIBE KEY CHECK
    // ----------------------------------------------------------

    if (
      !PUBNUB_SUBSCRIBE_KEY ||
      PUBNUB_SUBSCRIBE_KEY ===
      "YOUR_SUBSCRIBE_KEY"
    ) {

      error(
        "PUBNUB_SUBSCRIBE_KEY is not configured."
      );

      return false;

    }


    // ----------------------------------------------------------
    // PUBLIC KEY CHECK
    // ----------------------------------------------------------

    if (
      !PUBLIC_KEY_B64 ||
      PUBLIC_KEY_B64 ===
      "YOUR_PUBLIC_KEY"
    ) {

      error(
        "PUBLIC_KEY_B64 is not configured."
      );

      return false;

    }


    /*
     * Draw On My Face uses the older PubNub SDK.
     *
     * Do NOT use:
     *
     *     new PubNub(...)
     *
     * here.
     *
     * The original project initializes it with:
     *
     *     PubNub({})
     */
    try {

      pubnub =
        window.PubNub({});

    } catch (err) {

      error(
        "Could not initialize PubNub:",
        err
      );

      pubnub =
        null;

      return false;

    }


    log(
      "PubNub initialized."
    );


    return true;

  }


  // ============================================================
  // SUBSCRIBE
  // ============================================================

  function subscribe() {

    if (
      !initializePubNub()
    ) {

      return;

    }


    if (
      subscribed
    ) {

      return;

    }


    log(
      "Subscribing to:",
      PUBNUB_CHANNEL
    );


    /*
     * IMPORTANT:
     *
     * The Draw On My Face PubNub SDK expects "messages"
     * here, not "message".
     */
    try {

      pubnub.subscribe({

        channel:
          PUBNUB_CHANNEL,

        messages:
          function(message) {

            processMessage(
              message
            );

          }

      });

    } catch (err) {

      error(
        "PubNub subscribe failed:",
        err
      );

      return;

    }


    subscribed =
      true;


    log(
      "Signed clear listener started."
    );


    log(
      "Channel:",
      PUBNUB_CHANNEL
    );

  }


  // ============================================================
  // INITIALIZATION
  // ============================================================

  function initialize() {

    acquireCanvas();

    subscribe();

  }


  // ============================================================
  // START
  // ============================================================

  initialize();


  document.addEventListener(
    "DOMContentLoaded",
    initialize
  );


  // ============================================================
  // MINIMAL PUBLIC API
  // ============================================================

  /*
   * Only local clearing is exposed.
   *
   * There is deliberately no drawing API and no network
   * clearing API.
   */
  window.DrawOnMyFace = {

    clearLocal:
      clearCanvas

  };

  window.DrawOnMyFace.queuePixel = queuePixel;
  window.DrawOnMyFace.flushPixels = flushPixels;
  window.DrawOnMyFace.getLivePixelCount = () => livePixels.length;


})();
