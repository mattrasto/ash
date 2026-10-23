function random(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
// Scheduling uses visible, moving night seconds, independent of day-play speed.
export class SkyEvents{
  constructor(seed=137){this.random=random(seed);this.remaining=this.interval();this.active=null;this.clock=0;}
  interval(){return 300+this.random()*600;}
  trigger(){
    const reverse=this.random()>.5;
    this.active={age:0,duration:.65+this.random()*.35,x:.22+this.random()*.5,y:.06+this.random()*.10,dx:(reverse?-1:1)*(.13+this.random()*.08),dy:.05+this.random()*.04};
    this.remaining=this.interval();
  }
  advance(dt,{eligible,moving,meteors}){
    if(!eligible){this.active=null;return;}
    if(!meteors)this.active=null;
    if(!moving)return;
    this.clock+=dt;
    if(!meteors)return;
    if(this.active){this.active.age+=dt;if(this.active.age>=this.active.duration)this.active=null;}
    else if((this.remaining-=dt)<=0)this.trigger();
  }
}
export function drawMeteor(ctx,event,width,height){
  if(!event)return;
  const t=event.age/event.duration,tail=Math.max(0,t-.24),fade=Math.sin(Math.PI*t);
  const x=(event.x+event.dx*t)*width,y=(event.y+event.dy*t)*height;
  const tx=(event.x+event.dx*tail)*width,ty=(event.y+event.dy*tail)*height;
  if(t===0)return;
  const gradient=ctx.createLinearGradient(tx,ty,x,y);gradient.addColorStop(0,'rgba(232,239,255,0)');gradient.addColorStop(1,`rgba(247,244,219,${fade*.85})`);
  ctx.strokeStyle=gradient;ctx.lineWidth=Math.max(.6,width/1024);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(x,y);ctx.stroke();
}
