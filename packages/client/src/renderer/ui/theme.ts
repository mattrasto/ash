/** Canonical opaque palette intent. Scene resolution must not overwrite it. */
export const palette=Object.freeze({text:'#34464d',muted:'#6e7e80',accent:'#72aeee',panel:'#f6f7e6',message:'#6c98c1',control:'#fffff8',shadow:'#405a68',warning:'#80612c',danger:'#9b4f55'});
function blend(a:string,b:string,weight:number){return '#'+[1,3,5].map(index=>Math.round(parseInt(a.slice(index,index+2),16)*weight+parseInt(b.slice(index,index+2),16)*(1-weight)).toString(16).padStart(2,'0')).join('');}
export function applyTheme(root=document.documentElement){
  const derived={'accent-feedback':blend(palette.accent,palette.control,.8),selection:blend(palette.accent,palette.control,.35),choice:blend(palette.accent,palette.control,.5),slate:blend(palette.accent,palette.text,.25),'range-thumb':blend(palette.accent,palette.control,.7)};
  for(const [name,value] of Object.entries({...palette,...derived}))root.style.setProperty(`--${name}`,value);
}
