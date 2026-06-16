import React, { useEffect, useRef, useState } from 'react';

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_DPR            = 2;
const BASE_ALPHA         = 0.07;
const REVEAL_ALPHA_BOOST = 0.45;

const POINTER_RADIUS_BASE  = 120;
const POINTER_RADIUS_EXTRA = 38;
const SPEED_TO_RADIUS      = 1.8;
const VEL_EMA              = 0.28;

const TRAIL_LIFE_MS    = 700;
const TRAIL_SPAWN_DIST = 14;
const TRAIL_MAX_POINTS = 80;
const RIPPLE_EXPAND    = 0.18;

const SCENE_COUNT    = 7;
const SCENE_BLEND_MS = 800;

const SHADOW_DARK  = 'rgba(86, 68, 44, 0.82)';
const SHADOW_LIGHT = 'rgba(255, 252, 247, 0.88)';
const STROKE_BASE  = 'rgba(160, 150, 134, 0.42)';

const SCENE_SEEDS = [0x7b7f3a1c, 0x3e4d2a91, 0xaf2c8b05, 0x5f1d9c73, 0xc8e03b2f, 0x82a14d6e, 0xd7390e54];

// ── Interfaces ─────────────────────────────────────────────────────────────
interface PointerState { x: number; y: number; vx: number; vy: number; radius: number; active: boolean; }
interface TrailPoint   { x: number; y: number; radius: number; born: number; }

// ── Utilities ──────────────────────────────────────────────────────────────
function seededRand(seed: number): () => number {
  let s = seed | 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}

function drawEmbossStroke(ctx: CanvasRenderingContext2D, draw: () => void, lw: number): void {
  ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = STROKE_BASE;
  ctx.shadowColor = SHADOW_DARK; ctx.shadowOffsetX = 1.8; ctx.shadowOffsetY = 1.8; ctx.shadowBlur = 2.5;
  draw(); ctx.stroke();
  ctx.shadowColor = SHADOW_LIGHT; ctx.shadowOffsetX = -1.2; ctx.shadowOffsetY = -1.2; ctx.shadowBlur = 2.0;
  draw(); ctx.stroke();
  ctx.shadowColor = 'transparent'; ctx.shadowOffsetX = ctx.shadowOffsetY = ctx.shadowBlur = 0;
}

// ── Scene 0: Natural Garden (branches + leaves + small blossoms) ────────────
function drawScene0(ctx: CanvasRenderingContext2D, W: number, H: number, rand: () => number): void {
  const branches = [
    { sx:0.05,sy:0.18,ex:0.58,ey:0.88 }, { sx:0.42,sy:0.04,ex:0.92,ey:0.62 },
    { sx:0.72,sy:0.22,ex:0.20,ey:0.92 }, { sx:0.15,sy:0.52,ex:0.88,ey:0.32 },
  ];
  for (const b of branches) {
    const sx=b.sx*W,sy=b.sy*H,ex=b.ex*W,ey=b.ey*H;
    const cp1x=sx+(rand()-0.4)*W*0.38,cp1y=sy+rand()*H*0.28;
    const cp2x=ex+(rand()-0.6)*W*0.28,cp2y=ey-rand()*H*0.20;
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(sx,sy); ctx.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,ex,ey); },1.7+rand()*0.6);
    const secCount=3+Math.floor(rand()*4);
    for(let j=0;j<secCount;j++){
      const t=0.15+rand()*0.70,mt=1-t;
      const bx=sx*mt**3+3*cp1x*t*mt**2+3*cp2x*t**2*mt+ex*t**3;
      const by=sy*mt**3+3*cp1y*t*mt**2+3*cp2y*t**2*mt+ey*t**3;
      const ang=rand()*Math.PI*2,len=W*(0.04+rand()*0.07);
      const tipX=bx+Math.cos(ang)*len,tipY=by+Math.sin(ang)*len;
      drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(bx,by); ctx.quadraticCurveTo(bx+Math.cos(ang)*len*0.5+(rand()-0.5)*len*0.3,by+Math.sin(ang)*len*0.5+(rand()-0.5)*len*0.3,tipX,tipY); },0.8+rand()*0.45);
      const lw=4+rand()*5,lh=lw*(0.38+rand()*0.28);
      ctx.save(); ctx.translate(tipX,tipY); ctx.rotate(ang+rand()*0.5-0.25);
      drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,lw,lh,0,0,Math.PI*2); },0.7);
      ctx.restore();
    }
  }
  const fp:[number,number][]=[[0.22,0.30],[0.68,0.18],[0.50,0.62],[0.12,0.72],[0.82,0.55],[0.38,0.88]];
  for(const [nx,ny] of fp){
    const fx=nx*W+(rand()-0.5)*W*0.06,fy=ny*H+(rand()-0.5)*H*0.06;
    const pr=5+rand()*6,pc=5+Math.floor(rand()*2);
    for(let p=0;p<pc;p++){
      const pa=(p/pc)*Math.PI*2,pcx=fx+Math.cos(pa)*pr*1.55,pcy=fy+Math.sin(pa)*pr*1.55;
      ctx.save(); ctx.translate(pcx,pcy); ctx.rotate(pa+Math.PI/2);
      drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,pr*0.42,pr*0.82,0,0,Math.PI*2); },0.7);
      ctx.restore();
    }
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(fx,fy,pr*0.40,0,Math.PI*2); },1.0);
  }
  for(let i=0;i<28;i++){
    const dx=rand()*W,dy=rand()*H,dr=1.5+rand()*2.5;
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(dx,dy,dr,0,Math.PI*2); },0.8);
  }
}

// ── Scene 1: Peony Blooms ──────────────────────────────────────────────────
function drawScene1(ctx: CanvasRenderingContext2D, W: number, H: number, rand: () => number): void {
  const flowers:[number,number,number][]= [[0.28,0.35,0.12],[0.70,0.62,0.10],[0.52,0.18,0.085],[0.15,0.72,0.075]];
  for(const [nx,ny,nr] of flowers){
    const cx=nx*W+(rand()-0.5)*W*0.04,cy=ny*H+(rand()-0.5)*H*0.04,baseR=nr*W;
    for(let layer=4;layer>=1;layer--){
      const pc=5+layer,pr=baseR*layer/4,angOff=(4-layer)*0.28;
      for(let p=0;p<pc;p++){
        const ang=(p/pc)*Math.PI*2+angOff,ox=cx+Math.cos(ang)*pr*0.52,oy=cy+Math.sin(ang)*pr*0.52;
        ctx.save(); ctx.translate(ox,oy); ctx.rotate(ang+Math.PI/2);
        drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,pr*(0.38+rand()*0.1),pr*0.82,0,0,Math.PI*2); },0.65+rand()*0.25);
        ctx.restore();
      }
    }
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(cx,cy,baseR*0.13,0,Math.PI*2); },1.2);
  }
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(W*0.28,H*0.35); ctx.bezierCurveTo(W*0.35,H*0.55,W*0.55,H*0.60,W*0.70,H*0.62); },2.2);
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(W*0.38,H*0.42); ctx.quadraticCurveTo(W*0.44,H*0.28,W*0.52,H*0.18); },1.6);
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(W*0.22,H*0.48); ctx.quadraticCurveTo(W*0.18,H*0.62,W*0.15,H*0.72); },1.4);
  const leafPts:[number,number,number][]= [[0.38,0.46,0.8],[0.45,0.36,-0.6],[0.58,0.52,2.2],[0.62,0.42,-2.4],[0.24,0.56,1.5],[0.19,0.65,-1.8]];
  for(const [lnx,lny,lang] of leafPts){
    ctx.save(); ctx.translate(lnx*W,lny*H); ctx.rotate(lang);
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,W*0.025,H*0.055,0,0,Math.PI*2); },0.8);
    ctx.restore();
  }
  for(let i=0;i<5;i++){
    ctx.save(); ctx.translate((0.1+rand()*0.8)*W,(0.1+rand()*0.8)*H); ctx.rotate(rand()*Math.PI);
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,W*0.012,H*0.022,0,0,Math.PI*2); },0.7);
    ctx.restore();
  }
}

// ── Scene 2: Bird on Branch ────────────────────────────────────────────────
function drawScene2(ctx: CanvasRenderingContext2D, W: number, H: number, rand: () => number): void {
  // Main branch
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(W*0.02,H*0.88); ctx.bezierCurveTo(W*0.22,H*0.68,W*0.55,H*0.50,W*0.92,H*0.28); },3.8);
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(W*0.30,H*0.63); ctx.quadraticCurveTo(W*0.18,H*0.40,W*0.12,H*0.18); },2.2);
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(W*0.62,H*0.46); ctx.quadraticCurveTo(W*0.78,H*0.28,W*0.82,H*0.08); },1.8);
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(W*0.45,H*0.55); ctx.quadraticCurveTo(W*0.52,H*0.72,W*0.48,H*0.90); },1.5);
  // Bird body
  const bx=W*0.48,by=H*0.41;
  ctx.save(); ctx.translate(bx,by); ctx.rotate(-0.25);
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,W*0.075,H*0.052,0,0,Math.PI*2); },1.3);
  ctx.restore();
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(bx-W*0.052,by-H*0.042,W*0.030,0,Math.PI*2); },1.0);
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(bx-W*0.082,by-H*0.042); ctx.lineTo(bx-W*0.118,by-H*0.036); },0.9);
  for(let w=0;w<6;w++){
    const wA=-1.0+w*0.32;
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(bx+W*0.005,by-H*0.005); ctx.quadraticCurveTo(bx+Math.cos(wA)*W*0.045,by+Math.sin(wA)*H*0.045,bx+Math.cos(wA)*W*0.088,by+Math.sin(wA)*H*0.088); },0.7-w*0.05);
  }
  for(let t=0;t<5;t++){
    const tA=0.15+t*0.18;
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(bx+W*0.065,by+H*0.008); ctx.lineTo(bx+W*0.065+Math.cos(tA)*W*0.060,by+H*0.008+Math.sin(tA)*H*0.068); },0.55);
  }
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(bx-W*0.060,by-H*0.046,W*0.006,0,Math.PI*2); },0.5);
  // Bamboo leaves
  const grass:[number,number,number][]= [[0.10,0.20,0.8],[0.17,0.12,0.9],[0.25,0.08,1.1],[0.72,0.12,0.85],[0.80,0.06,0.95],[0.88,0.14,0.8],[0.85,0.82,-1.2],[0.92,0.75,-0.9]];
  for(const [gnx,gny,gA] of grass){
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(gnx*W,gny*H); ctx.quadraticCurveTo(gnx*W+Math.sin(gA)*W*0.04,gny*H+Math.cos(gA)*H*0.10,gnx*W+Math.sin(gA)*W*0.06,gny*H+H*(0.18+rand()*0.12)); },0.9);
  }
  // Small flowers
  const fp:[number,number][]= [[0.08,0.55],[0.20,0.38],[0.72,0.60],[0.88,0.50],[0.40,0.82],[0.60,0.75]];
  for(const [fnx,fny] of fp){
    const fx=fnx*W,fy=fny*H,fr=W*0.016;
    for(let p=0;p<5;p++){ const pa=(p/5)*Math.PI*2; ctx.save(); ctx.translate(fx+Math.cos(pa)*fr*1.5,fy+Math.sin(pa)*fr*1.5); ctx.rotate(pa+Math.PI/2); drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,fr*0.38,fr*0.78,0,0,Math.PI*2); },0.6); ctx.restore(); }
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(fx,fy,fr*0.32,0,Math.PI*2); },0.7);
  }
}

// ── Scene 3: Ornate Scrollwork ─────────────────────────────────────────────
function drawScene3(ctx: CanvasRenderingContext2D, W: number, H: number, rand: () => number): void {
  // Corner scroll clusters
  const corners:[number,number,number,number][]= [[0.12,0.12,1,1],[0.88,0.12,-1,1],[0.12,0.88,1,-1],[0.88,0.88,-1,-1]];
  for(const [cx,cy,fx,fy] of corners){
    for(let i=0;i<4;i++){
      const r=(0.03+i*0.025)*W;
      const sA=fx>0?(fy>0?0:-Math.PI*0.5):(fy>0?Math.PI*0.5:Math.PI);
      drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(cx*W,cy*H,r,sA,sA+Math.PI,fy<0); },1.2-i*0.15);
      const tA=sA+Math.PI,tx=cx*W+Math.cos(tA)*r,ty=cy*H+Math.sin(tA)*r;
      ctx.save(); ctx.translate(tx,ty); ctx.rotate(tA);
      drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,r*0.18,r*0.45,0,0,Math.PI*2); },0.7);
      ctx.restore();
    }
  }
  // S-curve ribbons
  const sCurves=[
    [0.05,0.40,0.30,0.10,0.70,0.90,0.95,0.60],
    [0.05,0.60,0.30,0.85,0.70,0.15,0.95,0.40],
    [0.20,0.05,0.10,0.50,0.90,0.50,0.80,0.95],
    [0.50,0.02,0.85,0.30,0.15,0.70,0.50,0.98],
  ];
  for(const [sx,sy,cp1x,cp1y,cp2x,cp2y,ex,ey] of sCurves){
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(sx*W,sy*H); ctx.bezierCurveTo(cp1x*W,cp1y*H,cp2x*W,cp2y*H,ex*W,ey*H); },1.0+rand()*0.5);
  }
  // Central rosette
  const rx=W*0.5,ry=H*0.5,rr=W*0.075;
  for(let p=0;p<8;p++){
    const pa=(p/8)*Math.PI*2,ox=rx+Math.cos(pa)*rr,oy=ry+Math.sin(pa)*rr;
    ctx.save(); ctx.translate(ox,oy); ctx.rotate(pa+Math.PI/2);
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,rr*0.28,rr*0.68,0,0,Math.PI*2); },0.8);
    ctx.restore();
  }
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(rx,ry,rr*0.28,0,Math.PI*2); },1.3);
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(rx,ry,rr*1.35,0,Math.PI*2); },0.7);
  for(let i=0;i<10;i++){
    const fx=(0.15+rand()*0.70)*W,fy=(0.15+rand()*0.70)*H,fr=(0.022+rand()*0.018)*W;
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(fx,fy,fr,0,Math.PI*(1.2+rand()*0.8)); },0.7+rand()*0.4);
  }
  for(let i=0;i<20;i++) drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(rand()*W,rand()*H,1.5+rand()*2,0,Math.PI*2); },0.6);
}

// ── Scene 4: Geometric Medallion ───────────────────────────────────────────
function drawScene4(ctx: CanvasRenderingContext2D, W: number, H: number, rand: () => number): void {
  const cx=W*0.5,cy=H*0.5,R=Math.min(W,H)*0.36;
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); },1.8);
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(cx,cy,R*0.88,0,Math.PI*2); },0.7);
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(cx,cy,R*0.20,0,Math.PI*2); },1.5);
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(cx,cy,R*0.12,0,Math.PI*2); },0.8);
  const SC=16;
  for(let s=0;s<SC;s++){
    const ang=(s/SC)*Math.PI*2;
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(cx+Math.cos(ang)*R*0.22,cy+Math.sin(ang)*R*0.22); ctx.lineTo(cx+Math.cos(ang)*R*0.86,cy+Math.sin(ang)*R*0.86); },s%2===0?1.3:0.6);
  }
  for(let s=0;s<SC;s+=2){
    const ang=(s/SC)*Math.PI*2+Math.PI/SC,lx=cx+Math.cos(ang)*R*0.54,ly=cy+Math.sin(ang)*R*0.54;
    ctx.save(); ctx.translate(lx,ly); ctx.rotate(ang+Math.PI/2);
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,R*0.065,R*0.185,0,0,Math.PI*2); },0.9);
    ctx.restore();
  }
  for(let d=0;d<32;d++){
    const ang=(d/32)*Math.PI*2,dx=cx+Math.cos(ang)*R*0.94,dy=cy+Math.sin(ang)*R*0.94;
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(dx,dy,W*0.005,0,Math.PI*2); },0.5);
  }
  const corners:[number,number][]= [[0.08,0.08],[0.92,0.08],[0.08,0.92],[0.92,0.92]];
  for(const [ax,ay] of corners){
    const baseA=(ax<0.5?0:Math.PI)+(ay<0.5?0:Math.PI)*0.5+Math.PI*0.25;
    for(let lobe=-2;lobe<=2;lobe++){
      const ang=baseA+lobe*0.30;
      drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(ax*W,ay*H); ctx.quadraticCurveTo(ax*W+Math.cos(ang)*W*0.038,ay*H+Math.sin(ang)*H*0.038,ax*W+Math.cos(ang)*W*0.078,ay*H+Math.sin(ang)*H*0.078); },1.3-Math.abs(lobe)*0.18);
    }
  }
}

// ── Scene 5: Grand Symmetric Floral ────────────────────────────────────────
function drawScene5(ctx: CanvasRenderingContext2D, W: number, H: number, rand: () => number): void {
  const cx=W*0.5,cy=H*0.5,bigR=Math.min(W,H)*0.16;
  for(let layer=3;layer>=1;layer--){
    const pc=6+layer*2,pr=bigR*layer/3,angOff=(3-layer)*(Math.PI/(pc*0.5));
    for(let p=0;p<pc;p++){
      const ang=(p/pc)*Math.PI*2+angOff,ox=cx+Math.cos(ang)*pr*0.52,oy=cy+Math.sin(ang)*pr*0.52;
      ctx.save(); ctx.translate(ox,oy); ctx.rotate(ang+Math.PI/2);
      drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,pr*0.35,pr*0.72,0,0,Math.PI*2); },0.85);
      ctx.restore();
    }
  }
  drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(cx,cy,bigR*0.18,0,Math.PI*2); },1.5);
  // 4-directional acanthus sprays
  for(let d=0;d<4;d++){
    const dir=(d/4)*Math.PI*2;
    const sx=cx+Math.cos(dir)*bigR*0.55,sy=cy+Math.sin(dir)*bigR*0.55;
    for(let lobe=-2;lobe<=2;lobe++){
      const lA=dir+lobe*0.22,ex=cx+Math.cos(lA)*bigR*1.95,ey=cy+Math.sin(lA)*bigR*1.95;
      const mx=(sx+ex)/2+Math.sin(lA)*W*0.035,my=(sy+ey)/2-Math.cos(lA)*H*0.035;
      drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(sx,sy); ctx.quadraticCurveTo(mx,my,ex,ey); },Math.abs(lobe)===0?1.5:1.0-Math.abs(lobe)*0.18);
    }
  }
  // Corner flowers
  const diagR=bigR*2.8;
  for(let d=0;d<4;d++){
    const ang=(d/4)*Math.PI*2+Math.PI/4,fx=cx+Math.cos(ang)*diagR,fy=cy+Math.sin(ang)*diagR;
    if(fx<0||fx>W||fy<0||fy>H) continue;
    const fr=bigR*0.55;
    for(let p=0;p<6;p++){
      const pa=(p/6)*Math.PI*2,ox=fx+Math.cos(pa)*fr*0.5,oy=fy+Math.sin(pa)*fr*0.5;
      ctx.save(); ctx.translate(ox,oy); ctx.rotate(pa+Math.PI/2);
      drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.ellipse(0,0,fr*0.32,fr*0.68,0,0,Math.PI*2); },0.75);
      ctx.restore();
    }
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(fx,fy,fr*0.18,0,Math.PI*2); },0.9);
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(cx+Math.cos(ang)*bigR*0.8,cy+Math.sin(ang)*bigR*0.8); ctx.lineTo(fx,fy); },1.2);
  }
  for(let i=0;i<20;i++) drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(rand()*W,rand()*H,1.5+rand()*2,0,Math.PI*2); },0.6);
}

// ── Scene 6: Constellation / Minimal Stars ─────────────────────────────────
function drawScene6(ctx: CanvasRenderingContext2D, W: number, H: number, rand: () => number): void {
  const nodes:[number,number,number][]= [
    [0.12,0.18,14],[0.50,0.10,10],[0.85,0.22,16],[0.22,0.48,12],[0.65,0.38,8],
    [0.90,0.55,12],[0.35,0.72,14],[0.70,0.80,10],[0.10,0.82,8],[0.50,0.58,18],
    [0.78,0.12,8],[0.15,0.35,8],[0.42,0.30,6],[0.60,0.65,7],
  ];
  for(let i=0;i<nodes.length;i++){
    for(let j=i+1;j<nodes.length;j++){
      const dx=(nodes[i][0]-nodes[j][0])*W,dy=(nodes[i][1]-nodes[j][1])*H;
      if(Math.hypot(dx,dy)<W*0.35){
        drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(nodes[i][0]*W,nodes[i][1]*H); ctx.lineTo(nodes[j][0]*W,nodes[j][1]*H); },0.38);
      }
    }
  }
  for(const [nx,ny,r] of nodes){
    const sx=nx*W,sy=ny*H;
    for(let ray=0;ray<4;ray++){
      const ang=(ray/4)*Math.PI;
      drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(sx-Math.cos(ang)*r*0.9,sy-Math.sin(ang)*r*0.9); ctx.lineTo(sx+Math.cos(ang)*r*0.9,sy+Math.sin(ang)*r*0.9); },0.6);
    }
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(sx,sy,r*0.42,0,Math.PI*2); },0.7);
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.arc(sx,sy,r*0.14,0,Math.PI*2); },0.5);
  }
  for(let c=0;c<6;c++){
    const pts=[rand()*W,rand()*H,rand()*W,rand()*H,rand()*W,rand()*H,rand()*W,rand()*H];
    drawEmbossStroke(ctx,()=>{ ctx.beginPath(); ctx.moveTo(pts[0],pts[1]); ctx.bezierCurveTo(pts[2],pts[3],pts[4],pts[5],pts[6],pts[7]); },0.35+rand()*0.2);
  }
}

// ── Scene dispatch ──────────────────────────────────────────────────────────
const SCENE_FNS = [drawScene0,drawScene1,drawScene2,drawScene3,drawScene4,drawScene5,drawScene6];

function buildEmbossBuffer(W: number, H: number, sceneIndex: number): HTMLCanvasElement {
  const buf=document.createElement('canvas'); buf.width=W; buf.height=H;
  const ctx=buf.getContext('2d')!; ctx.clearRect(0,0,W,H);
  SCENE_FNS[sceneIndex](ctx,W,H,seededRand(SCENE_SEEDS[sceneIndex]));
  return buf;
}

// ── Quality tier ───────────────────────────────────────────────────────────
type QualityTier = 'desktop' | 'mobile';
function detectQualityTier(): QualityTier {
  if(typeof window==='undefined') return 'desktop';
  const coarse=window.matchMedia?.('(pointer: coarse)').matches??false;
  const narrow=window.matchMedia?.('(max-width: 768px)').matches??false;
  const noHov =window.matchMedia?.('(hover: none)').matches??false;
  return (coarse||narrow||noHov)?'mobile':'desktop';
}

interface Props { className?: string; style?: React.CSSProperties; }

// ── Component ──────────────────────────────────────────────────────────────
const EmbossRevealCanvas: React.FC<Props> = ({ className, style }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qualityTier] = useState<QualityTier>(detectQualityTier);

  useEffect(() => {
    if(qualityTier==='mobile') return;
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext('2d'); if(!ctx) return;

    let rafId=0;
    let resizeTimer: ReturnType<typeof setTimeout>|null=null;

    const tmpCanvas=document.createElement('canvas'),tmpCtx=tmpCanvas.getContext('2d')!;
    const mskCanvas=document.createElement('canvas'),mskCtx=mskCanvas.getContext('2d')!;

    // Scene crossfade state
    let buffers: HTMLCanvasElement[]=[];
    let fromIdx=0,toIdx=0,transitionStart=-1;

    const syncSize=()=>{
      const dpr=Math.min(window.devicePixelRatio||1,MAX_DPR);
      const cssW=canvas.clientWidth,cssH=canvas.clientHeight;
      canvas.width=Math.round(cssW*dpr); canvas.height=Math.round(cssH*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      tmpCanvas.width=canvas.width; tmpCanvas.height=canvas.height; tmpCtx.setTransform(dpr,0,0,dpr,0,0);
      mskCanvas.width=canvas.width; mskCanvas.height=canvas.height; mskCtx.setTransform(dpr,0,0,dpr,0,0);
    };
    syncSize();

    const W0=canvas.clientWidth,H0=canvas.clientHeight;
    if(W0>0&&H0>0) for(let i=0;i<SCENE_COUNT;i++) buffers.push(buildEmbossBuffer(W0,H0,i));

    const ptr:PointerState={x:-1,y:-1,vx:0,vy:0,radius:POINTER_RADIUS_BASE,active:false};
    const trails:TrailPoint[]=[];
    let lastTrailX=-1,lastTrailY=-1;

    const onPointerMove=(e:PointerEvent)=>{
      const rect=canvas.getBoundingClientRect(),nx=e.clientX-rect.left,ny=e.clientY-rect.top;
      if(ptr.active){
        const dx=nx-ptr.x,dy=ny-ptr.y;
        ptr.vx=VEL_EMA*dx+(1-VEL_EMA)*ptr.vx; ptr.vy=VEL_EMA*dy+(1-VEL_EMA)*ptr.vy;
        ptr.radius=POINTER_RADIUS_BASE+Math.min(Math.hypot(ptr.vx,ptr.vy)*SPEED_TO_RADIUS,POINTER_RADIUS_EXTRA);
      }
      ptr.x=nx; ptr.y=ny; ptr.active=true;
      if(Math.hypot(nx-lastTrailX,ny-lastTrailY)>=TRAIL_SPAWN_DIST||lastTrailX<0){
        trails.push({x:nx,y:ny,radius:ptr.radius,born:performance.now()});
        if(trails.length>TRAIL_MAX_POINTS) trails.shift();
        lastTrailX=nx; lastTrailY=ny;
      }
    };
    const parkPointer=()=>{ ptr.active=false; ptr.vx=0; ptr.vy=0; };

    window.addEventListener('pointermove',onPointerMove);
    document.addEventListener('mouseleave',parkPointer);
    window.addEventListener('blur',parkPointer);

    const onResize=()=>{
      syncSize();
      if(resizeTimer!==null) clearTimeout(resizeTimer);
      resizeTimer=setTimeout(()=>{
        const w=canvas.clientWidth,h=canvas.clientHeight;
        if(w>0&&h>0){ buffers=[]; for(let i=0;i<SCENE_COUNT;i++) buffers.push(buildEmbossBuffer(w,h,i)); }
        resizeTimer=null;
      },300);
    };
    window.addEventListener('resize',onResize);

    const onVisChange=()=>{ if(document.hidden) cancelAnimationFrame(rafId); else{ cancelAnimationFrame(rafId); rafId=requestAnimationFrame(tick); } };
    document.addEventListener('visibilitychange',onVisChange);

    const onSceneChange=(e:Event)=>{
      const newIdx=Math.max(0,Math.min(SCENE_COUNT-1,(e as CustomEvent<{sceneIndex:number}>).detail.sceneIndex));
      if(newIdx!==toIdx){ fromIdx=toIdx; toIdx=newIdx; transitionStart=performance.now(); }
    };
    window.addEventListener('emboss-scene-change',onSceneChange);

    const drawMaskCircle=(x:number,y:number,r:number,strength:number,age=0)=>{
      const dR=r*(1+age*RIPPLE_EXPAND);
      const g=mskCtx.createRadialGradient(x,y,0,x,y,dR);
      g.addColorStop(0.00,`rgba(0,0,0,${strength.toFixed(3)})`);
      g.addColorStop(0.50,`rgba(0,0,0,${(strength*0.85).toFixed(3)})`);
      g.addColorStop(0.80,`rgba(0,0,0,${(strength*0.20).toFixed(3)})`);
      g.addColorStop(1.00,'rgba(0,0,0,0)');
      mskCtx.fillStyle=g; mskCtx.fillRect(0,0,canvas.clientWidth,canvas.clientHeight);
    };

    const tick=()=>{
      const now=performance.now(),cssW=canvas.clientWidth,cssH=canvas.clientHeight;
      ctx.clearRect(0,0,cssW,cssH);
      while(trails.length>0&&now-trails[0].born>=TRAIL_LIFE_MS) trails.shift();

      const fromBuf=buffers[fromIdx],toBuf=buffers[toIdx];
      if(toBuf){
        const blendT=(transitionStart<0||fromIdx===toIdx)?1:Math.min(1,(now-transitionStart)/SCENE_BLEND_MS);

        // Base emboss layer with crossfade
        if(blendT>=1||!fromBuf){
          ctx.globalAlpha=BASE_ALPHA; ctx.drawImage(toBuf,0,0,cssW,cssH);
        } else {
          ctx.globalAlpha=BASE_ALPHA*(1-blendT); ctx.drawImage(fromBuf,0,0,cssW,cssH);
          ctx.globalAlpha=BASE_ALPHA*blendT;     ctx.drawImage(toBuf,0,0,cssW,cssH);
        }
        ctx.globalAlpha=1.0;

        // Reveal layer (use dominant buffer)
        const revealBuf=blendT>=0.5?toBuf:(fromBuf??toBuf);
        if(ptr.active||trails.length>0){
          mskCtx.clearRect(0,0,cssW,cssH);
          mskCtx.globalCompositeOperation='lighter';
          for(const tp of trails){
            const age=(now-tp.born)/TRAIL_LIFE_MS,strength=Math.max(0,1-age);
            if(strength>0.005) drawMaskCircle(tp.x,tp.y,tp.radius,strength,age);
          }
          if(ptr.active) drawMaskCircle(ptr.x,ptr.y,ptr.radius,1.0);
          mskCtx.globalCompositeOperation='source-over';

          tmpCtx.clearRect(0,0,cssW,cssH);
          tmpCtx.globalAlpha=REVEAL_ALPHA_BOOST; tmpCtx.drawImage(revealBuf,0,0,cssW,cssH);
          tmpCtx.globalAlpha=1.0;
          tmpCtx.globalCompositeOperation='destination-in'; tmpCtx.drawImage(mskCanvas,0,0,cssW,cssH);
          tmpCtx.globalCompositeOperation='source-over';
          ctx.drawImage(tmpCanvas,0,0,cssW,cssH);
        }
      }
      rafId=requestAnimationFrame(tick);
    };
    rafId=requestAnimationFrame(tick);

    return ()=>{
      cancelAnimationFrame(rafId);
      if(resizeTimer!==null) clearTimeout(resizeTimer);
      window.removeEventListener('pointermove',onPointerMove);
      document.removeEventListener('mouseleave',parkPointer);
      window.removeEventListener('blur',parkPointer);
      window.removeEventListener('resize',onResize);
      document.removeEventListener('visibilitychange',onVisChange);
      window.removeEventListener('emboss-scene-change',onSceneChange);
    };
  },[qualityTier]);

  if(qualityTier==='mobile') return null;

  return (
    <canvas ref={canvasRef} className={className} aria-hidden
      style={{ position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',display:'block',...style }}
    />
  );
};

export default EmbossRevealCanvas;
