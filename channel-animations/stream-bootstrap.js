(() => {
"use strict";
const VERSION="0.4.0-alpha1";
const script=document.currentScript;
const base=script&&script.src?new URL(".",script.src):new URL("./channel-animations/",location.href);
const overlayMode=new URLSearchParams(location.search).get("overlay")==="true";
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function waitFor(test,timeoutMs,label){
  const end=performance.now()+timeoutMs;
  while(performance.now()<end){try{if(test())return true}catch(_){}await sleep(25)}
  console.warn("[STREAM BOOT] timeout waiting for",label);
  return false;
}
function load(src,id){
  return new Promise((resolve,reject)=>{
    if(id&&document.getElementById(id)){resolve();return}
    const s=document.createElement("script");
    if(id)s.id=id;
    s.src=src;
    s.onload=resolve;
    s.onerror=()=>reject(new Error("Failed to load "+src));
    document.body.appendChild(s);
  });
}
async function boot(){
  const colorReady=await waitFor(()=>window.DrawOnMyFace&&typeof DrawOnMyFace.setDrawColor==="function"&&typeof DrawOnMyFace.getDrawColor==="function",3000,"canonical draw-colour API");
  if(colorReady){
    const before=DrawOnMyFace.getDrawColor();
    if(typeof before==="string"&&before){
      DrawOnMyFace.setDrawColor(before);
      if(DrawOnMyFace.getDrawColor()!==before)console.error("[STREAM BOOT] draw colour API failed round-trip");
      else console.log("[STREAM BOOT] draw colour API ready",before);
    }
  }
  if(!overlayMode&&!window.__DOF_CANVAS_LITE__){
    try{
      await load(new URL("../canvas-lite.js",base).href,"dof-stream-canvas-lite-loader");
      await waitFor(()=>!!window.__DOF_CANVAS_LITE__,3500,"Canvas Lite ready");
    }catch(err){console.warn("[STREAM BOOT] Canvas Lite unavailable; stream animations can still run",err)}
  }
  if(!(window.DrawOnMyFace&&window.DrawOnMyFace.animations))await load(new URL("animation-layer.js",base).href,"dof-stream-animation-loader");
  await waitFor(()=>window.DrawOnMyFace&&window.DrawOnMyFace.animations,3500,"animation API");
  if(!(window.DrawOnMyFace&&window.DrawOnMyFace.streamScenes))await load(new URL("stream-scenes.js",base).href,"dof-stream-scenes-loader");
  await waitFor(()=>window.DrawOnMyFace&&window.DrawOnMyFace.streamScenes,3500,"stream scene engine");

  if(!(window.DrawOnMyFace&&window.DrawOnMyFace.stream))await load(new URL("stream-director.js",base).href,"dof-stream-director-loader");
  await waitFor(()=>window.DrawOnMyFace&&window.DrawOnMyFace.stream,3500,"stream director");
  window.dispatchEvent(new CustomEvent("dof:stream-bootstrap-ready",{detail:{version:VERSION,colorReady,overlayMode}}));
  console.log("[STREAM BOOT] ready",{version:VERSION,colorReady,overlayMode});
}
boot().catch(err=>console.error("[STREAM BOOT] failed",err));
})();