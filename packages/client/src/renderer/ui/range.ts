export function rangeField(node:HTMLInputElement,value?:number){
  function update(value?:number){const min=Number(node.min)||0,max=Number(node.max)||100;node.style.setProperty('--range-fill',`${Math.max(0,Math.min(100,((value??node.valueAsNumber)-min)/(max-min)*100))}%`);}
  const input=()=>update(),observer=new MutationObserver(()=>update());
  node.addEventListener('input',input);observer.observe(node,{attributes:true,attributeFilter:['min','max','value']});update(value);
  return {update,destroy(){observer.disconnect();node.removeEventListener('input',input);}};
}
