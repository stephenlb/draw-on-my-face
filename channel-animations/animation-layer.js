(() => {
"use strict";

const VERSION = "0.4.2-alpha3";
const SCRIPT = document.currentScript;
const USER_CONFIG = window.DOF_ANIMATION_CONFIG || {};

function resolveBaseUrl() {
  if (USER_CONFIG.assetBase) return new URL(USER_CONFIG.assetBase, location.href).href;
  if (SCRIPT && SCRIPT.src) return new URL(".", SCRIPT.src).href;
  if (/^https?:/.test(location.href)) return new URL("./channel-animations/", location.href).href;
  return "./channel-animations/";
}

const BASE_URL = resolveBaseUrl();
const CONFIG = Object.freeze({
  canvasId: USER_CONFIG.canvasId || "dof-animation-canvas",
  zIndex: Number.isFinite(USER_CONFIG.zIndex) ? USER_CONFIG.zIndex : 50,
  commandChannel: USER_CONFIG.commandChannel || "animations",
  statusChannel: USER_CONFIG.statusChannel || "animation-status",
  publicKeyB64: USER_CONFIG.publicKeyB64 || "tCu+/B0Nx3/Fy+84+fjt9Huc9ddxRGX47G3/5eimbDE=",
  autoSubscribe: USER_CONFIG.autoSubscribe !== false,
  forcePng: USER_CONFIG.forcePng === true,
  frameOverrideDataUrl: USER_CONFIG.frameOverrideDataUrl || null,
  maxCommandAgeMs: 30000
});

const SOURCE_W = 1280;
const SOURCE_H = 720;
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const easeOutCubic = t => 1 - Math.pow(1-t,3);

function randomId(prefix="id") {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return prefix + "-" + window.crypto.randomUUID();
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

const SCENES = new Map();
SCENES.set("minecraft-chase", Object.freeze({
  id: "minecraft-chase",
  width: SOURCE_W,
  height: SOURCE_H,
  fps: 24,
  frameCount: 182,
  duration: 7.583333333333333,
  video: new URL("assets/minecraft_chase_alpha_vp9.webm", BASE_URL).href,
  poster: new URL("assets/minecraft_chase_poster.png", BASE_URL).href,
  pngPattern: new URL("assets/chase_png/frame_%03d.png", BASE_URL).href
}));

function b64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function bytesToB64(bytes) {
  let s="";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k)+":"+canonical(value[k])).join(",") + "}";
}
function unsignedEnvelopePayload(envelope) {
  return {v:envelope.v,type:envelope.type,timestamp:envelope.timestamp,nonce:envelope.nonce,command:envelope.command};
}
async function importPublicKey() {
  if (window.crypto && crypto.subtle) {
    try {
      return await crypto.subtle.importKey("raw",b64ToBytes(CONFIG.publicKeyB64),{name:"Ed25519"},false,["verify"]);
    } catch (_) {}
  }
  if (window.nacl && window.nacl.sign) return null;
  throw new Error("No Ed25519 verifier available.");
}
async function verifyEnvelope(publicKey,envelope) {
  if (!envelope || envelope.v !== 1 || envelope.type !== "dof-animation-command") return false;
  if (typeof envelope.timestamp !== "number" || typeof envelope.nonce !== "string" || typeof envelope.signature !== "string") return false;
  if (Math.abs(Date.now()-envelope.timestamp) > CONFIG.maxCommandAgeMs) return false;

  const payload = new TextEncoder().encode(canonical(unsignedEnvelopePayload(envelope)));
  const signature = b64ToBytes(envelope.signature);

  if (publicKey && window.crypto && crypto.subtle) {
    try {
      if (await crypto.subtle.verify({name:"Ed25519"},publicKey,signature,payload)) return true;
    } catch (_) {}
  }

  if (window.nacl && window.nacl.sign && window.nacl.sign.detached) {
    try { return window.nacl.sign.detached.verify(payload,signature,b64ToBytes(CONFIG.publicKeyB64)); }
    catch (_) { return false; }
  }
  return false;
}

function ensureStyle() {
  if (document.getElementById("dof-animation-style")) return;
  const style=document.createElement("style");
  style.id="dof-animation-style";
  style.textContent=`#${CONFIG.canvasId}{position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:${CONFIG.zIndex};background:transparent;}`;
  document.head.appendChild(style);
}
function ensureOverlayCanvas() {
  let canvas=document.getElementById(CONFIG.canvasId);
  if (canvas) return canvas;
  ensureStyle();
  canvas=document.createElement("canvas");
  canvas.id=CONFIG.canvasId;
  canvas.setAttribute("aria-hidden","true");
  canvas.dataset.dofAnimationLayer=VERSION;
  document.body.appendChild(canvas);
  return canvas;
}

class SceneAsset {
  constructor(spec) {
    this.spec=spec;
    this.video=document.createElement("video");
    this.video.muted=true;
    this.video.playsInline=true;
    this.video.preload="auto";
    this.video.loop=false;
    this.video.poster=spec.poster;
    this.video.src=spec.video;
    this.mode=CONFIG.forcePng ? "png" : "video";
    this.ready=false;
    this.images=new Map();
    this.currentImage=null;
  }

  async loadFrame(index) {
    index=clamp(index,1,this.spec.frameCount);
    if (this.images.has(index)) return this.images.get(index);

    const src=CONFIG.frameOverrideDataUrl || this.spec.pngPattern.replace("%03d",String(index).padStart(3,"0"));
    const image=new Image();
    image.decoding="async";

    await new Promise((resolve,reject) => {
      image.onload=resolve;
      image.onerror=reject;
      image.src=src;
    });

    this.images.set(index,image);
    if (this.images.size>48) {
      const first=this.images.keys().next().value;
      if (first!==index) this.images.delete(first);
    }
    return image;
  }

  async syncPng(time) {
    const index=clamp(Math.floor(time*this.spec.fps)+1,1,this.spec.frameCount);
    try { this.currentImage=await this.loadFrame(index); } catch (_) {}
    for (const ahead of [1,2,3]) {
      const n=index+ahead;
      if (n<=this.spec.frameCount) this.loadFrame(n).catch(()=>{});
    }
  }

  async preload() {
    if (this.ready) return;

    if (this.mode==="video") {
      try {
        await new Promise((resolve,reject) => {
          const ok=()=>{cleanup();resolve();};
          const bad=()=>{cleanup();reject(this.video.error||new Error("video load failed"));};
          const cleanup=()=>{
            this.video.removeEventListener("loadeddata",ok);
            this.video.removeEventListener("error",bad);
          };
          this.video.addEventListener("loadeddata",ok,{once:true});
          this.video.addEventListener("error",bad,{once:true});
          this.video.load();
        });
      } catch (err) {
        console.warn("[DOF ANIM] WebM unavailable; using PNG fallback",err);
        this.mode="png";
      }
    }

    if (this.mode==="png") {
      await Promise.all(
        [1,24,48,72,96,120,144,168,182]
          .filter(n=>n<=this.spec.frameCount)
          .map(n=>this.loadFrame(n).catch(()=>null))
      );
    }

    this.ready=true;
  }

  frameSource() {
    if (this.mode==="video" && this.video.readyState>=2) return this.video;
    return this.currentImage;
  }
}

class AnimationRuntime {
  constructor(canvas) {
    this.canvas=canvas;
    this.ctx=canvas.getContext("2d",{alpha:true,desynchronized:true});

    this.stage=document.createElement("canvas");
    this.stage.width=SOURCE_W;
    this.stage.height=SOURCE_H;
    this.stageCtx=this.stage.getContext("2d",{alpha:true,desynchronized:true});

    this.trail=document.createElement("canvas");
    this.trail.width=SOURCE_W;
    this.trail.height=SOURCE_H;
    this.trailCtx=this.trail.getContext("2d",{alpha:true});

    this.temp=document.createElement("canvas");
    this.temp.width=SOURCE_W;
    this.temp.height=SOURCE_H;
    this.tempCtx=this.temp.getContext("2d",{alpha:true});

    this.assets=new Map();
    this.currentScene=null;
    this.currentAsset=null;
    this.playing=false;
    this.startEpoch=0;
    this.sceneTime=0;
    this.pendingTimer=0;
    this.raf=0;
    this.fit="contain";
    this.holdLast=false;
    this.title="";
    this.subtitle="";
    this.effects={bloom:0,trails:0,glitch:0,chromatic:0,shake:0,pixelate:0};
    this.lastStateReason="boot";

    this.resizeHandler=()=>this.resizeOutput();
    window.addEventListener("resize",this.resizeHandler,{passive:true});
    this.resizeOutput();
  }

  resizeOutput() {
    const dpr=window.devicePixelRatio||1;
    const w=Math.max(1,window.innerWidth);
    const h=Math.max(1,window.innerHeight);
    this.viewport={w,h,dpr};
    this.canvas.width=Math.round(w*dpr);
    this.canvas.height=Math.round(h*dpr);
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  asset(sceneId) {
    const spec=SCENES.get(sceneId);
    if (!spec) throw new Error("Unknown animation scene: "+sceneId);
    if (!this.assets.has(sceneId)) this.assets.set(sceneId,new SceneAsset(spec));
    return this.assets.get(sceneId);
  }

  async preload(sceneId="minecraft-chase") {
    await this.asset(sceneId).preload();
    this.lastStateReason="preload";
    return this.status();
  }

  applyPreset(name) {
    if (name==="polished") {
      this.effects={bloom:.10,trails:0,glitch:0,chromatic:.30,shake:0,pixelate:0};
    } else {
      this.effects={bloom:0,trails:0,glitch:0,chromatic:0,shake:0,pixelate:0};
    }
  }

  setEffects(patch={}) {
    const caps={bloom:.20,trails:.12,glitch:.02,chromatic:1.0,shake:.5,pixelate:.25};
    for (const k of Object.keys(this.effects)) {
      if (patch[k]===undefined) continue;
      const value=Number(patch[k])||0;
      this.effects[k]=Math.max(0,Math.min(caps[k],value));
    }
  }

  setTitle(text="",subtitle="") {
    this.title=String(text||"");
    this.subtitle=String(subtitle||"");
  }

  isBlackoutActive() {
    try {
      return !!(
        window.DrawOnMyFace &&
        typeof window.DrawOnMyFace.isBlackoutActive==="function" &&
        window.DrawOnMyFace.isBlackoutActive()
      );
    } catch (_) {
      return false;
    }
  }

  async play(sceneId="minecraft-chase",options={}) {
    this.stop("superseded");

    const scene=SCENES.get(sceneId);
    if (!scene) throw new Error("Unknown animation scene: "+sceneId);

    const asset=this.asset(sceneId);
    await asset.preload();

    this.currentScene=scene;
    this.currentAsset=asset;
    this.fit=["contain","cover","stretch"].includes(options.fit) ? options.fit : "contain";
    this.holdLast=!!options.holdLast;
    this.setTitle(options.title??"",options.subtitle??"");
    this.applyPreset(options.preset||"clean");
    if (options.effects) this.setEffects(options.effects);

    const startAt=Number(options.startAt)||Date.now();
    this.startEpoch=startAt;

    const begin=async()=>{
      const late=Math.max(0,(Date.now()-this.startEpoch)/1000);
      if (late>=scene.duration) {
        this.stop("expired-before-start");
        return;
      }

      this.sceneTime=late;
      this.playing=true;
      this.lastStateReason="play";

      if (asset.mode==="video") {
        try {
          asset.video.currentTime=late;
          await asset.video.play();
        } catch (err) {
          console.warn("[DOF ANIM] video play failed; switching to PNG fallback",err);
          asset.mode="png";
          await asset.syncPng(late);
        }
      } else {
        await asset.syncPng(late);
      }

      this.startRenderLoop();
    };

    const delay=startAt-Date.now();
    if (delay>4) this.pendingTimer=setTimeout(begin,delay);
    else await begin();

    return this.status();
  }

  stop(reason="stop") {
    clearTimeout(this.pendingTimer);
    this.pendingTimer=0;
    this.playing=false;
    this.sceneTime=0;
    this.lastStateReason=reason;

    if (this.currentAsset) {
      try {
        this.currentAsset.video.pause();
        this.currentAsset.video.currentTime=0;
      } catch (_) {}
    }

    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf=0;
    }

    this.stageCtx.clearRect(0,0,SOURCE_W,SOURCE_H);
    this.trailCtx.clearRect(0,0,SOURCE_W,SOURCE_H);
    this.clearOutput();
    return this.status();
  }

  panic(reason="panic") {
    this.applyPreset("clean");
    this.setTitle("","");
    return this.stop(reason);
  }

  clearOutput() {
    const {dpr,w,h}=this.viewport;
    this.ctx.save();
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    this.ctx.clearRect(0,0,w,h);
    this.ctx.restore();
  }

  startRenderLoop() {
    if (this.raf) return;

    const tick=async()=>{
      this.raf=requestAnimationFrame(tick);
      if (!this.playing) return;

      if (this.isBlackoutActive()) {
        this.panic("blackout");
        return;
      }

      const scene=this.currentScene;
      const asset=this.currentAsset;
      this.sceneTime=Math.max(0,(Date.now()-this.startEpoch)/1000);

      if (this.sceneTime>=scene.duration) {
        if (this.holdLast) {
          this.sceneTime=Math.max(0,scene.duration-1/scene.fps);
          this.playing=false;
          if (asset && asset.mode==="video") {
            try { asset.video.pause(); } catch (_) {}
          }
          if (this.raf) {
            cancelAnimationFrame(this.raf);
            this.raf=0;
          }
          this.lastStateReason="hold-last";
          this.renderFrame();
        } else {
          this.stop("complete");
        }
        return;
      }

      if (asset.mode==="png") {
        await asset.syncPng(this.sceneTime);
      } else if (Math.abs(asset.video.currentTime-this.sceneTime)>.20) {
        try { asset.video.currentTime=this.sceneTime; } catch (_) {}
      }

      this.renderFrame();
    };

    this.raf=requestAnimationFrame(tick);
  }

  drawTitle(ctx,time) {
    if (!this.title) return;

    let alpha=1,scale=1,tracking=7;
    if (time<.12) alpha=0;
    else if (time<.55) {
      const u=(time-.12)/.43;
      const eased=easeOutCubic(u);
      alpha=u;
      scale=.55+.45*eased;
      tracking=28+(7-28)*eased;
    } else if (time>3.15) {
      alpha=0;
    } else if (time>2.75) {
      alpha=1-(time-2.75)/.4;
    }

    if (alpha<=0) return;

    ctx.save();
    ctx.translate(SOURCE_W/2,95);
    ctx.scale(scale,scale);
    ctx.globalAlpha=clamp(alpha,0,1);
    ctx.font="900 82px Arial";
    ctx.textBaseline="middle";
    ctx.textAlign="left";
    ctx.lineJoin="round";
    ctx.shadowBlur=18;
    ctx.shadowColor="#ff2438";

    const chars=[...this.title];
    const widths=chars.map(ch=>ctx.measureText(ch).width);
    const total=widths.reduce((a,b)=>a+b,0)+tracking*Math.max(0,chars.length-1);
    let x=-total/2;

    for (let i=0;i<chars.length;i++) {
      ctx.lineWidth=5;
      ctx.strokeStyle="#5b0a0a";
      ctx.strokeText(chars[i],x,0);
      ctx.fillStyle="#fff";
      ctx.fillText(chars[i],x,0);
      x+=widths[i]+tracking;
    }

    if (this.subtitle) {
      ctx.shadowBlur=10;
      ctx.font="700 24px Arial";
      ctx.textAlign="center";
      ctx.fillStyle="#ff3b4f";
      ctx.fillText(this.subtitle,0,70);
    }

    ctx.restore();
  }


  sourceOffset() {
    if (!this.currentScene) return {x:0,y:0};

    if (this.currentScene.id === "minecraft-chase") {
      const intro = clamp(this.sceneTime / 0.90, 0, 1);
      const x = 360 * (1 - easeOutCubic(intro));
      return {x, y:0};
    }

    return {x:0,y:0};
  }

  renderStage() {
    const ctx=this.stageCtx;
    const source=this.currentAsset && this.currentAsset.frameSource();

    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,SOURCE_W,SOURCE_H);
    if (!source) return;

    const fx=this.effects;
    const offset=this.sourceOffset();
    const sx=(Math.random()-.5)*fx.shake + offset.x;
    const sy=(Math.random()-.5)*fx.shake + offset.y;

    if (fx.trails>0) {
      this.trailCtx.save();

      // Decay prior history before adding the current frame. This prevents
      // the persistent "ghost train" accumulation seen in v0.3.1 testing.
      this.trailCtx.globalCompositeOperation="destination-out";
      this.trailCtx.globalAlpha=.28;
      this.trailCtx.fillStyle="#000";
      this.trailCtx.fillRect(0,0,SOURCE_W,SOURCE_H);

      this.trailCtx.globalCompositeOperation="source-over";
      this.trailCtx.globalAlpha=Math.min(.12,fx.trails);
      this.trailCtx.drawImage(source,sx,sy,SOURCE_W,SOURCE_H);
      this.trailCtx.restore();

      ctx.save();
      ctx.globalAlpha=Math.min(.08,fx.trails*.65);
      ctx.drawImage(this.trail,0,0);
      ctx.restore();
    }

    ctx.drawImage(source,sx,sy,SOURCE_W,SOURCE_H);

    if (fx.bloom>0 && "filter" in ctx) {
      ctx.save();
      ctx.globalCompositeOperation="screen";
      ctx.globalAlpha=fx.bloom;
      ctx.filter="blur(7px) saturate(1.12)";
      ctx.drawImage(source,sx,sy,SOURCE_W,SOURCE_H);
      ctx.restore();
    }

    if (fx.chromatic>0) {
      const d=fx.chromatic;
      ctx.save();
      ctx.globalCompositeOperation="screen";
      ctx.globalAlpha=.06;
      ctx.drawImage(source,sx-d,sy,SOURCE_W,SOURCE_H);
      ctx.drawImage(source,sx+d,sy,SOURCE_W,SOURCE_H);
      ctx.restore();
    }

    this.drawTitle(ctx,this.sceneTime);

    if (fx.glitch>0 && Math.random()<fx.glitch) {
      for (let i=0;i<6;i++) {
        const y=Math.random()*SOURCE_H;
        const h=4+Math.random()*24;
        const dx=(Math.random()-.5)*55;
        ctx.drawImage(this.stage,0,y,SOURCE_W,h,dx,y,SOURCE_W,h);
      }
    }

    if (fx.pixelate>0) {
      const scale=Math.max(.05,1-fx.pixelate*.92);
      const tw=Math.max(1,Math.round(SOURCE_W*scale));
      const th=Math.max(1,Math.round(SOURCE_H*scale));
      this.tempCtx.clearRect(0,0,SOURCE_W,SOURCE_H);
      this.tempCtx.imageSmoothingEnabled=false;
      this.tempCtx.drawImage(this.stage,0,0,tw,th);
      ctx.imageSmoothingEnabled=false;
      ctx.clearRect(0,0,SOURCE_W,SOURCE_H);
      ctx.drawImage(this.temp,0,0,tw,th,0,0,SOURCE_W,SOURCE_H);
    }
  }

  fitRect() {
    const vw=this.viewport.w;
    const vh=this.viewport.h;

    if (this.fit==="stretch") return {x:0,y:0,w:vw,h:vh};

    const scale=this.fit==="cover"
      ? Math.max(vw/SOURCE_W,vh/SOURCE_H)
      : Math.min(vw/SOURCE_W,vh/SOURCE_H);

    const w=SOURCE_W*scale;
    const h=SOURCE_H*scale;
    return {x:(vw-w)/2,y:(vh-h)/2,w,h};
  }

  renderFrame() {
    this.renderStage();

    const {dpr,w,h}=this.viewport;
    const rect=this.fitRect();

    this.ctx.save();
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    this.ctx.clearRect(0,0,w,h);
    this.ctx.drawImage(this.stage,rect.x,rect.y,rect.w,rect.h);
    this.ctx.restore();
  }

  status() {
    return {
      version:VERSION,
      installed:true,
      playing:this.playing,
      scene:this.currentScene && this.currentScene.id,
      time:this.sceneTime,
      mode:this.currentAsset && this.currentAsset.mode,
      fit:this.fit,
      effects:{...this.effects},
      lastStateReason:this.lastStateReason,
      viewport:{...this.viewport},
      canvasId:CONFIG.canvasId
    };
  }

  destroy() {
    this.panic("destroy");
    window.removeEventListener("resize",this.resizeHandler);
    this.canvas.remove();
    const style=document.getElementById("dof-animation-style");
    if (style) style.remove();
  }
}

class RemoteControl {
  constructor(runtime) {
    this.runtime=runtime;
    this.client=null;
    this.publicKey=null;
    this.subscription=null;
    this.seenNonces=new Set();
    this.userId=randomId("dof-animation");
  }

  async start() {
    if (!CONFIG.autoSubscribe || typeof window.PubNub!=="function") return false;

    this.publicKey=await importPublicKey();
    this.client=window.PubNub({});
    this.subscription=this.client.subscribe({
      channel:CONFIG.commandChannel,
      messages:message=>this.receive(message).catch(err=>console.error("[DOF ANIM] command error",err))
    });

    await this.runtime.preload("minecraft-chase");
    await this.publishStatus("ready");
    return true;
  }

  async verify(envelope) {
    if (!envelope || this.seenNonces.has(envelope.nonce)) return false;

    const ok=await verifyEnvelope(this.publicKey,envelope);
    if (!ok) return false;

    this.seenNonces.add(envelope.nonce);
    if (this.seenNonces.size>1000) {
      this.seenNonces.delete(this.seenNonces.values().next().value);
    }
    return true;
  }

  async receive(envelope) {
    if (!await this.verify(envelope)) return;

    const cmd=envelope.command||{};
    if (cmd.action==="preload") await this.runtime.preload(cmd.scene||"minecraft-chase");
    else if (cmd.action==="play") await this.runtime.play(cmd.scene||"minecraft-chase",cmd.options||{});
    else if (cmd.action==="stop") this.runtime.stop("remote-stop");
    else if (cmd.action==="panic") this.runtime.panic("remote-panic");
    else if (cmd.action==="title") this.runtime.setTitle(cmd.text||"",cmd.subtitle||"");
    else if (cmd.action==="effect") {
      if (cmd.preset) this.runtime.applyPreset(cmd.preset);
      if (cmd.effects) this.runtime.setEffects(cmd.effects);
    } else if (window.DrawOnMyFace && window.DrawOnMyFace.stream && typeof window.DrawOnMyFace.stream.handleRemote === "function") {
      const handled = await window.DrawOnMyFace.stream.handleRemote(cmd);
      if (!handled) return;
    } else return;

    await this.publishStatus("command-applied",{action:cmd.action,nonce:envelope.nonce});
  }

  async publishStatus(status,extra={}) {
    if (!this.client) return;
    try {
      await this.client.publish({
        channel:CONFIG.statusChannel,
        message:{
          type:"dof-animation-status",
          v:1,
          status,
          userId:this.userId,
          timestamp:Date.now(),
          runtime:this.runtime.status(),
          stream:(window.DrawOnMyFace && window.DrawOnMyFace.stream && typeof window.DrawOnMyFace.stream.status === "function") ? window.DrawOnMyFace.stream.status() : null,
          ...extra
        }
      });
    } catch (err) {
      console.warn("[DOF ANIM] status publish failed",err);
    }
  }
}

let runtime=null;
let remote=null;

async function install() {
  if (
    window.DrawOnMyFace &&
    window.DrawOnMyFace.animations &&
    window.DrawOnMyFace.animations.version===VERSION
  ) return window.DrawOnMyFace.animations;

  const canvas=ensureOverlayCanvas();
  runtime=new AnimationRuntime(canvas);
  remote=new RemoteControl(runtime);

  const api={
    version:VERSION,
    preload:scene=>runtime.preload(scene),
    play:(scene,options)=>runtime.play(scene,options),
    stop:()=>runtime.stop(),
    panic:()=>runtime.panic(),
    setTitle:(text,subtitle)=>runtime.setTitle(text,subtitle),
    setPreset:preset=>runtime.applyPreset(preset),
    setEffects:effects=>runtime.setEffects(effects),
    status:()=>runtime.status(),
    scenes:()=>[...SCENES.keys()],
    register:(id,spec)=>{
      if (!id || !spec) throw new Error("id/spec required");
      SCENES.set(id,Object.freeze({...spec,id}));
      return true;
    },
    destroy:()=>{
      runtime.destroy();
      if (window.DrawOnMyFace) delete window.DrawOnMyFace.animations;
    },
    _test:{
      config:CONFIG,
      canvas:()=>canvas,
      runtime:()=>runtime,
      remote:()=>remote,
      canonical,
      bytesToB64
    }
  };

  window.DrawOnMyFace=Object.assign(window.DrawOnMyFace||{},{animations:api});

  remote.start().catch(err=>console.warn("[DOF ANIM] remote control unavailable",err));
  console.log("[DOF ANIM] same-page Canvas2D animation layer ready",api.status());
  return api;
}

if (document.readyState==="loading") {
  document.addEventListener("DOMContentLoaded",install,{once:true});
} else {
  install();
}
})();