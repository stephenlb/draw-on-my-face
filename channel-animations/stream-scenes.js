(() => {
"use strict";

const VERSION="0.4.1-alpha2";
const Z_INDEX=82;
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const easeOutCubic=t=>1-Math.pow(1-t,3);
const easeInCubic=t=>t*t*t;
const easeOutBack=t=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);};
const easeOutExpo=t=>t===1?1:1-Math.pow(2,-10*t);

let canvas=null,ctx=null,dpr=1;
let raf=0,current=null;
let particles=[];
let resizeHandler=null;

const registry=new Map();

function randomRange(a,b){return a+Math.random()*(b-a);}
function randomSign(){return Math.random()<.5?-1:1;}

function ensureCanvas(){
  if(canvas)return canvas;
  canvas=document.getElementById("dof-stream-scene-canvas");
  if(!canvas){
    canvas=document.createElement("canvas");
    canvas.id="dof-stream-scene-canvas";
    canvas.setAttribute("aria-hidden","true");
    Object.assign(canvas.style,{
      position:"fixed",inset:"0",width:"100%",height:"100%",
      zIndex:String(Z_INDEX),pointerEvents:"none",background:"transparent"
    });
    document.body.appendChild(canvas);
  }
  ctx=canvas.getContext("2d",{alpha:true,desynchronized:true});
  resizeHandler=resize;
  window.addEventListener("resize",resizeHandler,{passive:true});
  resize();
  return canvas;
}

function resize(){
  if(!canvas)return;
  dpr=window.devicePixelRatio||1;
  canvas.width=Math.max(1,Math.round(innerWidth*dpr));
  canvas.height=Math.max(1,Math.round(innerHeight*dpr));
  ctx.setTransform(dpr,0,0,dpr,0,0);
}

function clear(){
  if(!ctx)return;
  ctx.save();
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,innerWidth,innerHeight);
  ctx.restore();
}

function setGlow(color,blur){
  ctx.shadowColor=color;
  ctx.shadowBlur=blur;
}

function clearGlow(){
  ctx.shadowBlur=0;
  ctx.shadowColor="transparent";
}

function addBurst(x,y,count,opts={}){
  for(let i=0;i<count;i++){
    const angle=randomRange(-Math.PI,Math.PI);
    const speed=randomRange(opts.minSpeed||80,opts.maxSpeed||420);
    particles.push({
      x,y,
      vx:Math.cos(angle)*speed,
      vy:Math.sin(angle)*speed,
      life:randomRange(.45,1.05),
      age:0,
      size:randomRange(opts.minSize||2,opts.maxSize||7),
      shape:opts.shape||"square",
      color:opts.color||"#ff3d4f",
      drag:randomRange(.90,.96),
      gravity:opts.gravity??120,
      spin:randomRange(-7,7),
      rot:randomRange(0,TAU)
    });
  }
}

function updateParticles(dt){
  for(const p of particles){
    p.age+=dt;
    p.vx*=Math.pow(p.drag,dt*60);
    p.vy*=Math.pow(p.drag,dt*60);
    p.vy+=p.gravity*dt;
    p.x+=p.vx*dt;
    p.y+=p.vy*dt;
    p.rot+=p.spin*dt;
  }
  particles=particles.filter(p=>p.age<p.life);
}

function drawParticles(){
  for(const p of particles){
    const a=1-p.age/p.life;
    ctx.save();
    ctx.globalAlpha=a*a;
    ctx.translate(p.x,p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle=p.color;
    if(p.shape==="circle"){
      ctx.beginPath();ctx.arc(0,0,p.size,0,TAU);ctx.fill();
    }else{
      ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size);
    }
    ctx.restore();
  }
}

function fitText(text,maxWidth,fontBase,min=28){
  let size=fontBase;
  while(size>min){
    ctx.font=`900 ${size}px Arial Black,Arial,sans-serif`;
    if(ctx.measureText(text).width<=maxWidth)break;
    size-=2;
  }
  return size;
}

function drawWord(text,x,y,size,alpha=1,scale=1,fill="#fff",stroke="#ff3d4f",strokeW=2){
  ctx.save();
  ctx.translate(x,y);ctx.scale(scale,scale);ctx.globalAlpha=alpha;
  ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.font=`900 ${size}px Arial Black,Arial,sans-serif`;
  setGlow("rgba(255,48,72,.35)",18);
  if(strokeW>0){
    ctx.lineWidth=strokeW;ctx.strokeStyle=stroke;ctx.strokeText(text,0,0);
  }
  ctx.fillStyle=fill;ctx.fillText(text,0,0);
  clearGlow();
  ctx.restore();
}

function drawUnderline(x,y,w,alpha,color="#ff3d4f"){
  ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=color;
  ctx.fillRect(x-w/2,y,w,6);
  ctx.restore();
}

function drawThumb(x,y,size,alpha=1,scale=1){
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.globalAlpha=alpha;
  ctx.fillStyle="#fff";setGlow("rgba(255,255,255,.25)",14);
  ctx.beginPath();
  ctx.moveTo(-size*.34,size*.08);
  ctx.lineTo(-size*.11,size*.08);
  ctx.lineTo(size*.04,-size*.34);
  ctx.quadraticCurveTo(size*.09,-size*.48,size*.23,-size*.40);
  ctx.quadraticCurveTo(size*.34,-size*.34,size*.29,-size*.18);
  ctx.lineTo(size*.26,-size*.04);
  ctx.lineTo(size*.42,-size*.04);
  ctx.quadraticCurveTo(size*.53,-size*.04,size*.49,size*.08);
  ctx.lineTo(size*.39,size*.35);
  ctx.quadraticCurveTo(size*.35,size*.47,size*.22,size*.47);
  ctx.lineTo(-size*.10,size*.47);
  ctx.lineTo(-size*.34,size*.36);
  ctx.closePath();ctx.fill();clearGlow();ctx.restore();
}

function drawBell(x,y,size,alpha=1,ring=0){
  ctx.save();ctx.translate(x,y);ctx.rotate(Math.sin(ring)*.17);ctx.globalAlpha=alpha;
  ctx.strokeStyle="#ff3d4f";ctx.fillStyle="#ff3d4f";ctx.lineWidth=Math.max(3,size*.07);
  setGlow("rgba(255,48,72,.35)",12);
  ctx.beginPath();ctx.arc(0,0,size*.30,Math.PI,0);
  ctx.lineTo(size*.30,size*.20);ctx.lineTo(-size*.30,size*.20);ctx.closePath();ctx.stroke();
  ctx.beginPath();ctx.arc(0,size*.31,size*.065,0,TAU);ctx.fill();
  clearGlow();ctx.restore();
}

function drawSweep(y,progress,alpha){
  const w=innerWidth*1.2;
  const x=lerp(-w,innerWidth+w,progress);
  const grad=ctx.createLinearGradient(x-220,0,x+220,0);
  grad.addColorStop(0,"rgba(255,61,79,0)");
  grad.addColorStop(.5,`rgba(255,61,79,${.22*alpha})`);
  grad.addColorStop(1,"rgba(255,61,79,0)");
  ctx.fillStyle=grad;ctx.fillRect(x-220,y-4,440,8);
}

function portraitFrame(){
  const w=innerWidth,h=innerHeight;
  const margin=Math.min(w,h)*.055;
  let frameW=Math.min(w-margin*2,(h-margin*2)*(9/16));
  let frameH=frameW*(16/9);
  if(frameH>h-margin*2){
    frameH=h-margin*2;
    frameW=frameH*(9/16);
  }
  return {
    x:(w-frameW)/2,
    y:(h-frameH)/2,
    w:frameW,
    h:frameH,
    cx:w/2,
    cy:h/2
  };
}

function sceneLike(t,d,payload){
  const frame=portraitFrame();
  const enter=clamp(t/.55,0,1),exit=clamp((d-t)/.45,0,1);
  const a=Math.min(easeOutCubic(enter),easeInCubic(exit));
  const pop=easeOutBack(enter);
  const iconY=frame.y+frame.h*.58;
  const wordY=frame.y+frame.h*.69;
  const lineY=frame.y+frame.h*.77;
  const subY=frame.y+frame.h*.845;
  const size=fitText("LIKE",frame.w*.72,Math.min(154,frame.w*.36+48),40);
  const lineW=Math.min(frame.w*.76,440)*easeOutExpo(enter);

  if(t<.04&&particles.length===0)addBurst(frame.cx,wordY-20,38,{color:"#ffffff",gravity:70,minSpeed:90,maxSpeed:360});
  drawSweep(lineY,clamp(t/.82,0,1),a);
  drawThumb(frame.cx,iconY,Math.min(frame.w*.20,110),a,pop);
  drawWord("LIKE",frame.cx,wordY,size,a,.86+.14*pop,"#fff","#ff3d4f",3);
  drawUnderline(frame.cx,lineY,lineW,a);
  if(payload.subtext)drawWord(payload.subtext.toUpperCase(),frame.cx,subY,Math.min(26,frame.w*.07),a,1,"#ff6677","transparent",0);
}

function sceneSubscribe(t,d,payload){
  const frame=portraitFrame();
  const enter=clamp(t/.62,0,1),exit=clamp((d-t)/.48,0,1);
  const a=Math.min(easeOutCubic(enter),easeInCubic(exit));
  const pop=easeOutBack(enter);
  const iconY=frame.y+frame.h*.57;
  const wordY=frame.y+frame.h*.69;
  const lineY=frame.y+frame.h*.77;
  const subY=frame.y+frame.h*.845;
  const size=fitText("SUBSCRIBE",frame.w*.92,Math.min(136,frame.w*.24+50),34);
  const lineW=Math.min(frame.w*.90,560)*easeOutExpo(enter);

  if(t<.04&&particles.length===0)addBurst(frame.cx,wordY-10,54,{color:"#ff3d4f",gravity:70,minSpeed:80,maxSpeed:430});
  drawSweep(lineY,clamp(t/.78,0,1),a);
  drawBell(frame.cx,iconY,Math.min(frame.w*.18,92),a,t*9);
  drawWord("SUBSCRIBE",frame.cx,wordY,size,a,.84+.16*pop,"#fff","#ff3d4f",3);
  drawUnderline(frame.cx,lineY,lineW,a);
  if(payload.subtext)drawWord(payload.subtext.toUpperCase(),frame.cx,subY,Math.min(26,frame.w*.07),a,1,"#ff6677","transparent",0);
}

function sceneLikeSub(t,d,payload){
  const frame=portraitFrame();
  const enter=clamp(t/.72,0,1),exit=clamp((d-t)/.52,0,1);
  const a=Math.min(easeOutCubic(enter),easeInCubic(exit));
  const pop=easeOutBack(enter);

  const likeIconY=frame.y+frame.h*.52;
  const likeWordY=frame.y+frame.h*.60;
  const subWordY=frame.y+frame.h*.71;
  const bellY=frame.y+frame.h*.775;
  const lineY=frame.y+frame.h*.825;
  const subY=frame.y+frame.h*.885;

  const likeSize=fitText("LIKE",frame.w*.58,Math.min(110,frame.w*.22+34),34);
  const subSize=fitText("SUBSCRIBE",frame.w*.90,Math.min(128,frame.w*.22+48),34);
  const bellX=frame.cx;
  const lineW=Math.min(frame.w*.92,580)*easeOutExpo(enter);

  if(t<.04&&particles.length===0){
    addBurst(frame.cx,likeWordY-30,26,{color:"#ffffff",gravity:70,minSpeed:70,maxSpeed:300});
    addBurst(frame.cx,subWordY,34,{color:"#ff3d4f",gravity:70,minSpeed:70,maxSpeed:360});
  }

  drawSweep(lineY,clamp(t/.86,0,1),a);
  drawThumb(frame.cx,likeIconY,Math.min(frame.w*.15,82),a,pop);
  drawWord("LIKE",frame.cx,likeWordY,likeSize,a,.92+.08*pop,"#fff","#ff3d4f",2);
  drawWord("SUBSCRIBE",frame.cx,subWordY,subSize,a,.84+.16*pop,"#fff","#ff3d4f",3);
  drawBell(bellX,bellY,Math.min(frame.w*.13,64),a,t*9);
  drawUnderline(frame.cx,lineY,lineW,a);
  if(payload.subtext)drawWord(payload.subtext.toUpperCase(),frame.cx,subY,Math.min(25,frame.w*.068),a,1,"#ff6677","transparent",0);
}

function sceneText(t,d,payload){
  const frame=portraitFrame();
  const text=String(payload.text||"STREAM MESSAGE").toUpperCase();
  const sub=String(payload.subtext||"");
  const enter=clamp(t/.72,0,1),exit=clamp((d-t)/.55,0,1);
  const a=Math.min(easeOutCubic(enter),easeInCubic(exit));
  const pop=easeOutBack(enter);
  const wordY=frame.y+frame.h*.68;
  const lineY=frame.y+frame.h*.77;
  const subY=frame.y+frame.h*.845;
  const size=fitText(text,frame.w*.94,Math.min(138,frame.w*.24+54),32);
  const lineW=Math.min(frame.w*.94,620)*easeOutExpo(enter);

  if(t<.04&&particles.length===0)addBurst(frame.cx,wordY,42,{color:"#ff3d4f",gravity:60,minSpeed:70,maxSpeed:390});
  drawSweep(lineY,clamp(t/.85,0,1),a);
  drawWord(text,frame.cx,wordY,size,a,.82+.18*pop,"#fff","#ff3d4f",3);
  drawUnderline(frame.cx,lineY,lineW,a);
  if(sub)drawWord(sub.toUpperCase(),frame.cx,subY,Math.min(26,frame.w*.07),a,1,"#ff6677","transparent",0);
}

function register(id,spec){registry.set(id,Object.freeze({id,...spec}));return true;}

register("like",{duration:3.0,render:sceneLike});
register("subscribe",{duration:3.4,render:sceneSubscribe});
register("like-sub",{duration:3.7,render:sceneLikeSub});
register("text",{duration:3.4,render:sceneText});

function stop(reason="stop"){
  current=null;particles=[];if(raf)cancelAnimationFrame(raf);raf=0;clear();
  return {playing:false,reason};
}

function play(id,payload={}){
  ensureCanvas();
  const scene=registry.get(id);
  if(!scene)throw new Error("Unknown stream scene: "+id);
  stop("superseded");
  current={scene,payload,start:performance.now(),last:performance.now(),duration:(Number(payload&&payload.durationSec)>0?Number(payload.durationSec):scene.duration)};
  raf=requestAnimationFrame(tick);
  return status();
}

function tick(now){
  raf=0;
  if(!current){clear();return;}

  const t=(now-current.start)/1000;
  const dt=Math.min(.05,(now-current.last)/1000);
  current.last=now;

  clear();
  updateParticles(dt);
  current.scene.render(t,current.duration,current.payload||{});
  drawParticles();

  if(t>=current.duration){
    stop("complete");
    return;
  }

  raf=requestAnimationFrame(tick);
}

function status(){
  return {
    version:VERSION,
    playing:!!current,
    scene:current?current.scene.id:null,
    scenes:[...registry.keys()],
    particleCount:particles.length
  };
}

function install(){
  ensureCanvas();
  window.DrawOnMyFace=Object.assign(window.DrawOnMyFace||{},{
    streamScenes:{version:VERSION,play,stop,status,register,scenes:()=>[...registry.keys()]}
  });
  window.dispatchEvent(new CustomEvent("dof:stream-scenes-ready",{detail:status()}));
  console.log("[DOF STREAM SCENES] ready",status());
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});
else install();

})();