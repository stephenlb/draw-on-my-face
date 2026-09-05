(() => {
"use strict";

const VERSION="0.4.2-alpha3";
const CONFIG=Object.assign({
  blockerPhotoUrl:"channel-animations/assets/stephen-nefarious-local.jpg",
  blockerPhotoPosition:"100% 50%",
  blockerPhotoSize:"500% 100%",
  promptDurationMs:3200
},window.DOF_STREAM_CONFIG||{});

const STREAM_HOLD="stream-director";
let mode="normal";
let previousMode="normal";
let promptState=null;
let promptRaf=0;
let promptResizeHandler=null;

const api=()=>window.DrawOnMyFace||{};
const drawingCanvas=()=>document.getElementById("canvas");
const animationCanvas=()=>document.getElementById("dof-animation-canvas");

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function easeOutBack(t){const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);}
function easeOutCubic(t){return 1-Math.pow(1-t,3);}
function easeInCubic(t){return t*t*t;}

function ensureStyle(){
  if(document.getElementById("dof-stream-director-style"))return;

  const style=document.createElement("style");
  style.id="dof-stream-director-style";
  style.textContent=`
body.dof-stream-presentation #canvas{visibility:hidden!important}
body.dof-stream-presentation .sticker{visibility:hidden!important}
body.dof-stream-quiet #dof-animation-canvas{visibility:hidden!important}
body.dof-stream-quiet #dof-stream-prompt-canvas{visibility:hidden!important}

#dof-stream-prompt-canvas{
  position:fixed;
  inset:0;
  width:100%;
  height:100%;
  z-index:70;
  pointer-events:none;
  background:transparent;
}

#draw-on-my-face-lock-overlay.dof-stream-branded{
  background:radial-gradient(circle at 52% 40%,#350810 0,#0b0c11 50%,#030406 100%)!important;
  overflow:hidden;
}

#draw-on-my-face-lock-overlay.dof-stream-branded:before{
  content:"";
  position:absolute;
  inset:-35%;
  background:repeating-conic-gradient(from 0deg,rgba(217,39,64,.17) 0 7deg,transparent 7deg 14deg);
  animation:dof-stream-spin 18s linear infinite;
}

#draw-on-my-face-lock-overlay .dof-nefarious,
#draw-on-my-face-lock-overlay .dof-nefarious *{
  box-sizing:border-box;
}

#draw-on-my-face-lock-overlay .dof-nefarious{
  position:absolute;
  inset:0;
  z-index:5;
  display:flex!important;
  align-items:center;
  justify-content:center;
  gap:clamp(34px,5vw,86px);
  padding:clamp(34px,6vh,78px) clamp(34px,6vw,110px);
  width:100%!important;
  height:100%!important;
  min-height:0!important;
  overflow:hidden!important;
  color:#fff;
  font-family:Inter,Segoe UI,Arial,sans-serif;
}

#draw-on-my-face-lock-overlay .dof-nefarious > *,
#draw-on-my-face-lock-overlay .dof-nefarious-copy > *{
  height:auto!important;
  min-height:0!important;
  max-height:none!important;
  overflow:visible!important;
}

#draw-on-my-face-lock-overlay .dof-nefarious-photo-wrap{
  position:relative;
  flex:0 0 auto;
  width:clamp(240px,27vw,405px)!important;
  height:auto!important;
  aspect-ratio:3/4;
  border-radius:28px;
  padding:7px;
  overflow:hidden!important;
  background:linear-gradient(145deg,#ff4355,#8a1021 56%,#17080b);
  box-shadow:0 0 0 2px rgba(255,255,255,.13) inset,0 24px 64px rgba(0,0,0,.42),0 0 55px rgba(217,39,64,.22);
  transform:rotate(-1.5deg);
}

#draw-on-my-face-lock-overlay .dof-nefarious-photo{
  width:100%!important;
  height:100%!important;
  min-height:0!important;
  border-radius:22px;
  background-color:#151920;
  background-repeat:no-repeat;
  background-position:center center!important;
  background-size:cover!important;
  box-shadow:0 0 0 3px rgba(6,9,13,.9) inset;
}

#draw-on-my-face-lock-overlay .dof-nefarious-copy{
  position:relative;
  z-index:2;
  flex:0 1 min(720px,52vw);
  width:min(720px,52vw)!important;
  height:auto!important;
  min-height:0!important;
  overflow:visible!important;
}

#draw-on-my-face-lock-overlay .dof-nefarious-kicker{
  display:block;
  width:auto!important;
  height:auto!important;
  padding:0;
  border:0;
  border-radius:0;
  background:none;
  color:#ff6577;
  font-size:clamp(12px,1.1vw,17px);
  font-weight:900;
  letter-spacing:.18em;
  line-height:1.25;
  text-transform:uppercase;
}

#draw-on-my-face-lock-overlay .dof-nefarious-kicker:after{
  content:"";
  display:block;
  width:min(170px,40%);
  height:4px!important;
  margin-top:12px;
  background:#e22943;
  box-shadow:0 0 18px rgba(226,41,67,.28);
}

#draw-on-my-face-lock-overlay .dof-nefarious-title{
  display:block;
  width:auto!important;
  height:auto!important;
  margin:20px 0 16px;
  color:#fff;
  font-size:clamp(54px,7.1vw,118px);
  line-height:.82;
  font-weight:1000;
  letter-spacing:-.055em;
  text-transform:uppercase;
  text-shadow:0 3px 0 #710b18,0 0 34px rgba(217,39,64,.28);
}

#draw-on-my-face-lock-overlay .dof-nefarious-sub{
  display:block;
  width:auto!important;
  height:auto!important;
  color:#ff7787;
  font-size:clamp(16px,1.65vw,27px);
  line-height:1.18;
  font-weight:850;
  letter-spacing:.08em;
  text-transform:uppercase;
}

#draw-on-my-face-lock-overlay .dof-nefarious-foot{
  display:block;
  width:auto!important;
  height:auto!important;
  margin-top:24px;
  color:#b9c2ce;
  font:700 clamp(11px,1vw,15px)/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;
  letter-spacing:.11em;
  text-transform:uppercase;
}

@keyframes dof-stream-spin{to{transform:rotate(360deg)}}

@media(max-width:900px), (max-aspect-ratio:4/5){
  #draw-on-my-face-lock-overlay .dof-nefarious{
    flex-direction:column;
    justify-content:center;
    gap:22px;
    padding:5vh 7vw;
    text-align:center;
  }

  #draw-on-my-face-lock-overlay .dof-nefarious-photo-wrap{
    width:min(42vw,280px)!important;
  }

  #draw-on-my-face-lock-overlay .dof-nefarious-copy{
    flex:0 0 auto;
    width:min(88vw,680px)!important;
  }

  #draw-on-my-face-lock-overlay .dof-nefarious-kicker:after{
    margin-left:auto;
    margin-right:auto;
  }

  #draw-on-my-face-lock-overlay .dof-nefarious-title{
    font-size:clamp(44px,11vw,84px);
  }
}`;

  document.head.appendChild(style);
}

function ensurePromptCanvas(){
  let canvas=document.getElementById("dof-stream-prompt-canvas");
  if(canvas)return canvas;

  canvas=document.createElement("canvas");
  canvas.id="dof-stream-prompt-canvas";
  canvas.setAttribute("aria-hidden","true");
  document.body.appendChild(canvas);

  const resize=()=>{
    const dpr=window.devicePixelRatio||1;
    canvas.width=Math.max(1,Math.round(innerWidth*dpr));
    canvas.height=Math.max(1,Math.round(innerHeight*dpr));
    canvas.style.width=innerWidth+"px";
    canvas.style.height=innerHeight+"px";
  };

  resize();
  promptResizeHandler=resize;
  window.addEventListener("resize",resize,{passive:true});
  return canvas;
}

function promptContext(){
  const canvas=ensurePromptCanvas();
  const ctx=canvas.getContext("2d",{alpha:true});
  const dpr=window.devicePixelRatio||1;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return {canvas,ctx,dpr,w:innerWidth,h:innerHeight};
}

function clearPromptCanvas(){
  const {ctx,w,h}=promptContext();
  ctx.clearRect(0,0,w,h);
}

function drawBell(ctx,x,y,size,alpha=1,ring=0){
  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(Math.sin(ring)*.15);
  ctx.globalAlpha=alpha;
  ctx.lineWidth=Math.max(2,size*.08);
  ctx.strokeStyle="#ff3d4f";
  ctx.fillStyle="#ff3d4f";
  ctx.beginPath();
  ctx.arc(0,0,size*.34,Math.PI,0);
  ctx.lineTo(size*.34,size*.24);
  ctx.lineTo(-size*.34,size*.24);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0,size*.34,size*.07,0,Math.PI*2);
  ctx.fill();
  ctx.restore();
}

function drawLikeMark(ctx,x,y,size,alpha=1){
  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.translate(x,y);
  ctx.strokeStyle="#ffffff";
  ctx.fillStyle="#ffffff";
  ctx.lineWidth=Math.max(2,size*.07);
  ctx.lineJoin="round";
  ctx.beginPath();
  ctx.moveTo(-size*.30,size*.18);
  ctx.lineTo(-size*.05,size*.18);
  ctx.lineTo(size*.08,-size*.28);
  ctx.quadraticCurveTo(size*.14,-size*.42,size*.26,-size*.34);
  ctx.quadraticCurveTo(size*.34,-size*.29,size*.30,-size*.15);
  ctx.lineTo(size*.27,-size*.02);
  ctx.lineTo(size*.40,-size*.02);
  ctx.quadraticCurveTo(size*.49,-size*.02,size*.46,size*.08);
  ctx.lineTo(size*.37,size*.33);
  ctx.quadraticCurveTo(size*.34,size*.42,size*.23,size*.42);
  ctx.lineTo(-size*.05,size*.42);
  ctx.lineTo(-size*.30,size*.34);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPromptScene(){
  promptRaf=0;
  if(!promptState){clearPromptCanvas();return;}

  const now=performance.now();
  const elapsed=now-promptState.start;
  const duration=promptState.duration;

  if(elapsed>=duration){
    promptState=null;
    clearPromptCanvas();
    return;
  }

  const {ctx,w,h}=promptContext();
  ctx.clearRect(0,0,w,h);

  const enter=clamp(elapsed/420,0,1);
  const exit=clamp((duration-elapsed)/420,0,1);
  const alpha=Math.min(easeOutCubic(enter),easeInCubic(exit));
  const enterBack=easeOutBack(enter);
  const kind=promptState.kind;

  const centerY=h*.76;
  const maxHeadline=Math.min(94,Math.max(42,w*.063));
  const subSize=Math.min(28,Math.max(16,w*.018));

  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.textAlign="center";
  ctx.textBaseline="middle";
  ctx.font=`900 ${maxHeadline}px Arial, sans-serif`;
  ctx.shadowColor="rgba(255,45,75,.32)";
  ctx.shadowBlur=20;

  if(kind==="likesub"){
    const gap=Math.min(210,w*.15);
    const leftX=w*.5-gap;
    const rightX=w*.5+gap;

    const lx=(-w*.18)*(1-enterBack);
    const rx=(w*.18)*(1-enterBack);

    drawLikeMark(ctx,leftX-120+lx,centerY-4,82,alpha);
    ctx.fillStyle="#ffffff";
    ctx.fillText("LIKE",leftX+lx,centerY);

    ctx.fillStyle="#ff3d4f";
    ctx.fillText("SUBSCRIBE",rightX+rx,centerY);

    const underlineW=Math.min(330,w*.23)*easeOutCubic(enter);
    ctx.shadowBlur=0;
    ctx.fillStyle="#ff3d4f";
    ctx.fillRect(rightX-underlineW/2+rx,centerY+58,underlineW,6);

    drawBell(ctx,rightX+190+rx,centerY-4,70,alpha,elapsed/110);
  } else if(kind==="subscribe"){
    const y=centerY+(1-enterBack)*80;
    ctx.fillStyle="#ffffff";
    ctx.fillText("SUBSCRIBE",w*.5,y);
    ctx.shadowBlur=0;
    const lineW=Math.min(520,w*.44)*easeOutCubic(enter);
    ctx.fillStyle="#ff3d4f";
    ctx.fillRect(w*.5-lineW/2,y+58,lineW,7);
    drawBell(ctx,w*.5+Math.min(330,w*.31),y-2,74,alpha,elapsed/100);
  } else if(kind==="like"){
    const y=centerY+(1-enterBack)*70;
    drawLikeMark(ctx,w*.5-185,y,90,alpha);
    ctx.fillStyle="#ffffff";
    ctx.fillText("LIKE THE STREAM",w*.5+45,y);
  } else {
    const y=centerY+(1-enterBack)*70;
    ctx.fillStyle="#ffffff";
    ctx.fillText(promptState.text.toUpperCase(),w*.5,y);
  }

  if(promptState.subtext){
    ctx.shadowBlur=0;
    ctx.font=`800 ${subSize}px Arial, sans-serif`;
    ctx.letterSpacing="0";
    ctx.fillStyle="#ff5265";
    ctx.fillText(promptState.subtext.toUpperCase(),w*.5,centerY+96);
  }

  ctx.restore();

  promptRaf=requestAnimationFrame(drawPromptScene);
}

function prompt(text,subtext="",options={}){
  const scenes=api().streamScenes;
  if(scenes&&typeof scenes.play==="function"){
    const durationSec=Math.max(1,(Number(options.durationMs)||CONFIG.promptDurationMs)/1000);
    scenes.play("text",{text:String(text||""),subtext:String(subtext||""),durationSec});
    return true;
  }

  // Fallback only if scene engine has not loaded yet.
  ensureStyle();
  ensurePromptCanvas();
  promptState={
    kind:String(options.kind||"custom"),
    text:String(text||""),
    subtext:String(subtext||""),
    duration:Math.max(1000,Number(options.durationMs)||CONFIG.promptDurationMs),
    start:performance.now()
  };
  if(!promptRaf)promptRaf=requestAnimationFrame(drawPromptScene);
  return true;
}

function promptPreset(name,options={}){
  name=String(name||"").toLowerCase();
  const scenes=api().streamScenes;
  const durationSec=Math.max(1,(Number(options.durationMs)||0)/1000)||undefined;

  if(scenes&&typeof scenes.play==="function"){
    if(name==="likesub")return !!scenes.play("like-sub",{subtext:"JOIN THE CHAOS",durationSec});
    if(name==="subscribe")return !!scenes.play("subscribe",{subtext:"TURN ON NOTIFICATIONS",durationSec});
    if(name==="like")return !!scenes.play("like",{subtext:"IT HELPS MORE THAN YOU THINK",durationSec});
    if(name==="live")return !!scenes.play("text",{text:"STEPHEN IS LIVE",subtext:"STAY AWHILE"});
    if(name==="pubnub")return !!scenes.play("text",{text:"POWERED BY PUBNUB",subtext:"REAL-TIME, OBVIOUSLY"});
  }

  if(name==="likesub")return prompt("LIKE + SUBSCRIBE","JOIN THE CHAOS",{kind:"likesub"});
  if(name==="subscribe")return prompt("SUBSCRIBE","TURN ON NOTIFICATIONS",{kind:"subscribe"});
  if(name==="like")return prompt("LIKE THE STREAM","IT HELPS MORE THAN YOU THINK",{kind:"like"});
  if(name==="live")return prompt("STEPHEN IS LIVE","STAY AWHILE",{kind:"custom"});
  if(name==="pubnub")return prompt("POWERED BY PUBNUB","REAL-TIME, OBVIOUSLY",{kind:"custom"});
  throw new Error("Unknown prompt preset: "+name);
}

function clearPrompt(){
  promptState=null;
  if(promptRaf)cancelAnimationFrame(promptRaf);
  promptRaf=0;
  clearPromptCanvas();
  api().streamScenes?.stop?.("clear-prompt");
}

function applyMode(next){
  ensureStyle();
  next=String(next||"normal").toLowerCase();

  if(next==="animations-only")next="presentation";
  if(next==="drawing-only")next="quiet";
  if(!["normal","presentation","quiet"].includes(next))throw new Error("Unknown stream mode: "+next);

  document.body.classList.remove("dof-stream-presentation","dof-stream-quiet");

  if(next==="presentation")document.body.classList.add("dof-stream-presentation");

  if(next==="quiet"){
    document.body.classList.add("dof-stream-quiet");
    api().animations?.stop?.();
    clearPrompt();
  }

  mode=next;
  return status();
}

function setDrawPublish(enabled){
  const d=api();
  if(typeof d.setDrawPublishEnabled!=="function")throw new Error("Drawing publish control unavailable on this page.");
  d.setDrawPublishEnabled(!!enabled);
  return status();
}

function brandBlocker(){
  ensureStyle();
  const d=api();
  const overlay=typeof d.getBlackoutOverlay==="function"
    ? d.getBlackoutOverlay()
    : document.getElementById("draw-on-my-face-lock-overlay");

  if(!overlay)return false;

  if(overlay.dataset.dofStreamBrand!==VERSION){
    overlay.dataset.dofStreamBrand=VERSION;
    overlay.classList.add("dof-stream-branded");
    overlay.innerHTML='<div class="dof-nefarious"><div class="dof-nefarious-photo-wrap"><div class="dof-nefarious-photo"></div></div><div class="dof-nefarious-copy"><div class="dof-nefarious-kicker">stream protection active</div><div class="dof-nefarious-title">Nefarious<br>Activity!</div><div class="dof-nefarious-sub">drawing temporarily blocked</div><div class="dof-nefarious-foot">DOF // PUBNUB // safety lock engaged</div></div></div>';
  }

  const photo=overlay.querySelector(".dof-nefarious-photo");
  if(photo)photo.style.backgroundImage=`url("${CONFIG.blockerPhotoUrl}")`;
  return true;
}

function blocker(active,reason="stream-director"){
  const d=api();
  if(typeof d.setBlackoutHold!=="function")throw new Error("Blackout write API unavailable.");

  if(active){
    previousMode=mode;
    brandBlocker();
    clearPrompt();
    d.animations?.panic?.();
  }

  d.setBlackoutHold(STREAM_HOLD,!!active,reason);

  if(!active)applyMode(previousMode||"normal");
  return status();
}

function status(){
  const d=api();
  const draw=drawingCanvas();
  const anim=animationCanvas();
  const promptCanvas=document.getElementById("dof-stream-prompt-canvas");

  return {
    version:VERSION,
    mode,
    blockerActive:!!d.isBlackoutActive?.(),
    blackoutHolds:typeof d.getBlackoutHolds==="function"?d.getBlackoutHolds():[],
    drawingVisible:!!draw&&getComputedStyle(draw).visibility!=="hidden",
    drawPublishEnabled:typeof d.isDrawPublishEnabled==="function"?d.isDrawPublishEnabled():null,
    animationVisible:!!anim&&getComputedStyle(anim).visibility!=="hidden",
    promptActive:!!promptState || !!api().streamScenes?.status?.().playing,
    promptCanvasVisible:!!promptCanvas&&getComputedStyle(promptCanvas).visibility!=="hidden",
    streamScene:api().streamScenes?.status?.()||null
  };
}

async function handleRemote(cmd){
  if(!cmd||typeof cmd.action!=="string")return false;

  if(cmd.action==="stream-mode"){applyMode(cmd.mode);return true;}
  if(cmd.action==="draw-publish"){setDrawPublish(!!cmd.enabled);return true;}
  if(cmd.action==="blocker"){blocker(!!cmd.active,cmd.reason||"remote");return true;}
  if(cmd.action==="prompt"){prompt(cmd.text||"",cmd.subtext||"",cmd.options||{kind:"custom"});return true;}
  if(cmd.action==="prompt-preset"){promptPreset(cmd.name,cmd.options||{});return true;}

  return false;
}

function install(){
  ensureStyle();
  ensurePromptCanvas();
  brandBlocker();

  window.DrawOnMyFace=Object.assign(window.DrawOnMyFace||{},{
    stream:{
      version:VERSION,
      mode:applyMode,
      normal:()=>applyMode("normal"),
      presentation:()=>applyMode("presentation"),
      quiet:()=>applyMode("quiet"),
      animationsOnly:()=>applyMode("presentation"),
      drawingOnly:()=>applyMode("quiet"),
      setDrawPublish,
      blocker,
      prompt,
      promptPreset,
      clearPrompt,
      status,
      handleRemote,
      brandBlocker
    }
  });

  window.dispatchEvent(new CustomEvent("dof:stream-ready",{detail:status()}));
  console.log("[DOF STREAM] ready",status());
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});
else install();

})();
