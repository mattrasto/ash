export interface ScrollPosition {top:number;following:boolean}
// The spacer lets a submitted user message sit near the top without forcing
// the reader to follow every streamed word. Only user scrolling changes follow mode.
export class ThreadScroll {
  private following=true;
  private programmatic=false;
  private frame=0;
  private observer:ResizeObserver;
  constructor(private viewport:HTMLElement,private content:HTMLElement,private spacer:HTMLElement,private onJump:(visible:boolean)=>void){
    this.observer=new ResizeObserver(()=>this.layout());this.observer.observe(content);this.observer.observe(viewport);
  }
  private offset(element:Element,bottom=false){const box=element.getBoundingClientRect();return (bottom?box.bottom:box.top)-this.viewport.getBoundingClientRect().top+this.viewport.scrollTop;}
  private end(){const last=this.content.lastElementChild;return last?this.offset(last,true):0;}
  private target(){return Math.max(0,this.end()-this.viewport.clientHeight*.8);}
  private move(top:number){this.programmatic=true;this.viewport.scrollTop=top;cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>{this.programmatic=false;});}
  private jump(){this.onJump(this.end()>this.viewport.scrollTop+this.viewport.clientHeight-24);}
  layout(){
    if(!this.viewport.clientHeight)return;
    const users=this.content.querySelectorAll('.user');const last=users[users.length-1];
    const anchor=last?Math.max(0,this.offset(last)-this.viewport.clientHeight*.2):0;
    this.spacer.style.height=`${Math.max(this.viewport.clientHeight*.2,anchor+this.viewport.clientHeight-this.end())}px`;
    if(this.following)this.move(this.target());this.jump();
  }
  scroll(){if(!this.programmatic)this.following=this.viewport.scrollTop>=this.target()-32;this.jump();}
  intent(up:boolean){if(up)this.following=false;}
  latest(){this.following=true;this.layout();}
  anchor(){this.following=false;this.layout();const users=this.content.querySelectorAll('.user');const last=users[users.length-1];if(last)this.move(Math.max(0,this.offset(last)-this.viewport.clientHeight*.2));this.jump();}
  position():ScrollPosition{return {top:this.viewport.scrollTop,following:this.following};}
  restore(position?:ScrollPosition){this.following=position?.following??true;this.layout();if(position&&!position.following)this.move(position.top);this.jump();}
  dispose(){this.observer.disconnect();cancelAnimationFrame(this.frame);}
}
