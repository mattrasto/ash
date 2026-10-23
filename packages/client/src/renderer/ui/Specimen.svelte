<script lang="ts">
  import {dialogDismiss} from './dismiss.ts';
  import {tick} from 'svelte';
  import Scene from './Scene.svelte';
  import Icon from './Icon.svelte';
  import Search from './Search.svelte';
  import NumberField from './NumberField.svelte';
  import Status from './Status.svelte';
  import {surface,mist} from './surface.ts';
  import {scrollArea} from './scroll.ts';
  import {selectField} from './select.ts';
  import {rangeField} from './range.ts';
  import {replaceContent} from './replacement.ts';
  import Menu from '../features/threads/Menu.svelte';
  let shown=$state(true),dialogOpen=$state(false),expanded=$state(false),page=$state(0),count=$state(1),search=$state('');
  let dialog=$state<HTMLDialogElement>(null!);let frame:HTMLElement;
  let menu=$state<{x:number;y:number;anchor:HTMLElement}|null>(null);
  const paragraphs=['A calm place to work.','Longer content changes the measured height while the glass keeps its identity. Your draft and scroll position belong to this view.'];
  async function change(){await replaceContent(frame,()=>{page=1-page;});}
  async function openDialog(){dialogOpen=true;await tick();dialog.showModal();}
  function menuAt(event:MouseEvent){const anchor=event.currentTarget as HTMLElement,rect=anchor.getBoundingClientRect();menu={x:rect.left,y:rect.bottom,anchor};}
</script>
<Scene/>
<main class="specimen" aria-label="Design specimen">
  <header><h1>Ash design specimen</h1><p>Shared components and interaction checks. Development only.</p></header>
  <div class="specimen-grid">
    <section use:surface class="specimen-panel"><div class="surface-content">
      <h2>Controls</h2>
      <label for="specimen-text">Editable field</label><input id="specimen-text" class="ash-field" value="A draft that stays yours"/>
      <label for="specimen-readonly">Read-only field</label><input id="specimen-readonly" class="ash-field" value="Selectable, without editing" readonly/>
      <label for="specimen-disabled">Disabled field</label><input id="specimen-disabled" class="ash-field" value="Unavailable" disabled/>
      <label for="specimen-invalid">Invalid field</label><div class="invalid-field"><input id="specimen-invalid" class="ash-field" value="Incomplete" aria-invalid="true" aria-describedby="specimen-error"/><span aria-hidden="true"><Icon name="danger"/></span></div><p id="specimen-error" class="ash-danger">Add a complete value before continuing.</p>
      <label for="specimen-select">Grouped select</label><select id="specimen-select" class="ash-field" use:selectField><optgroup label="Everyday"><option>Morning</option><option disabled>Unavailable</option><option>Afternoon</option></optgroup><optgroup label="Later"><option>Evening</option><option>Night</option></optgroup></select>
      <p class="field-label">Search</p><Search bind:value={search}/>
      <p class="field-label">Number</p><NumberField label="Count" bind:value={count} min={0} max={3}/>
      <div class="choice-row"><label><input type="checkbox" class="ash-choice" checked/> Checkbox</label><label><input type="checkbox" role="switch" class="ash-choice" checked/> Switch</label></div>
      <div class="choice-row"><label><input type="radio" name="specimen-radio" class="ash-choice" checked/> First</label><label><input type="radio" name="specimen-radio" class="ash-choice"/> Second</label><label><input type="checkbox" class="ash-choice" checked disabled/> Disabled</label></div>
      <label for="specimen-range">Range</label><input id="specimen-range" class="ash-range" use:rangeField type="range" min="0" max="100" value="40"/>
      <div class="actions"><button class="ash-button ash-primary">Primary action</button><button class="ash-button">Secondary action</button><button class="ash-button ash-ghost">Ghost action</button><button class="ash-button" disabled>Disabled action</button></div>
    </div></section>
    <div class="specimen-stack">
      <section use:surface class="specimen-panel"><div class="surface-content"><h2>Presence and popups</h2><div class="actions"><button class="ash-button" onclick={()=>shown=!shown}>Toggle surface</button><button class="ash-button" onclick={openDialog}>Open dialog</button><button class="ash-button" onclick={menuAt}>Open actions</button></div></div></section>
      {#if shown}<section class="specimen-panel reversible" data-testid="reversible-surface" use:surface transition:mist={{role:'large'}}><div class="surface-content"><h2>Material formation</h2><p>Opening and closing share one spatial pattern. Reversing keeps the visible state.</p><textarea class="ash-field" aria-label="Surface draft">Draft stays in the live tree</textarea></div></section>{/if}
      <section class="specimen-panel" use:surface bind:this={frame} data-testid="replacement-frame"><div class="surface-content"><h2>Content replacement</h2><p>{paragraphs[page]}</p><input class="ash-field" aria-label="Replacement draft" value="Keep this draft"/><div class="nested-scroll" use:scrollArea role="region" aria-label="Replacement scroll">{#each Array(8) as _,i}<p>Reading position {i+1}</p>{/each}</div><button class="ash-button" onclick={change}>Replace content</button></div></section>
      <section class="specimen-panel" use:surface><div class="surface-content"><Status kind="warning" label="Review this caution">The explanation uses the shared text color.</Status><Status label="Action failed">The saved content remains available.</Status><button class="ash-button ash-ghost" aria-expanded={expanded} aria-controls="specimen-expansion" onclick={()=>expanded=!expanded}>More detail</button><div class="expansion" class:expanded><div id="specimen-expansion" inert={!expanded}><p>Expansion changes layout without replaying its surface.</p></div></div></div></section>
    </div>
  </div>
</main>
{#if dialogOpen}<dialog class="specimen-dialog" bind:this={dialog} aria-label="Specimen dialog" use:dialogDismiss={()=>dialogOpen=false} use:surface={{dense:true}} transition:mist={{role:'large'}} oncancel={event=>{event.preventDefault();dialogOpen=false;}}><div class="surface-content"><header><h2>Popup inside a dialog</h2><button class="ash-button ash-ghost ash-icon" aria-label="Close specimen dialog" onclick={()=>dialogOpen=false}><Icon name="close"/></button></header><label for="dialog-select">Dialog choice</label><select id="dialog-select" class="ash-field" use:selectField><option>First option</option><option>Second option</option></select><button class="ash-button" onclick={menuAt}>Open dialog actions</button><p>Escape dismisses the popup before the dialog. Focus stays in its owning context.</p>{#if menu}<Menu anchor={menu.anchor} x={menu.x} y={menu.y} onClose={()=>menu=null} items={[{label:'First action',action:()=>menu=null},{label:'Unavailable action',disabled:true},{label:'Nested actions',submenu:{onOpen:()=>{},items:[{label:'Choice one',checked:true},{label:'Choice two',checked:false}]}}]}/>{/if}</div></dialog>{:else if menu}<Menu anchor={menu.anchor} x={menu.x} y={menu.y} onClose={()=>menu=null} items={[{label:'First action',action:()=>menu=null},{label:'Unavailable action',disabled:true},{label:'Nested actions',submenu:{onOpen:()=>{},items:[{label:'Choice one',checked:true},{label:'Choice two',checked:false}]}}]}/>{/if}
<style>
.specimen{padding:24px;max-width:1200px;margin:auto}.specimen>header{margin-bottom:24px}.specimen h1{margin:0}.specimen header p{margin:6px 0;color:var(--muted)}.specimen-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.specimen-stack{display:flex;flex-direction:column;gap:20px}.specimen-panel>.surface-content{padding:24px}.specimen h2{margin:0 0 14px}.specimen label{display:block;font-size:.9rem;margin-top:14px;margin-bottom:7px}.specimen .ash-field{width:100%}.choice-row{display:flex;gap:14px;flex-wrap:wrap}.choice-row label{display:flex;align-items:center;gap:7px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.nested-scroll{height:75px;overflow:auto;margin:12px 0;padding:0 12px}.invalid-field{position:relative}.invalid-field input{padding-right:36px}.invalid-field>span{position:absolute;right:12px;top:13px;color:var(--danger)}#specimen-error{font-size:.9rem;font-weight:525;margin:7px 0}.specimen-dialog{width:min(540px,calc(100vw - 32px));padding:0;overflow:hidden}.specimen-dialog>.surface-content{padding:24px}.specimen-dialog header{display:flex;justify-content:space-between;align-items:center;gap:12px}.specimen-dialog .ash-field{width:100%;margin:7px 0 16px}.specimen-dialog label{font-size:.9rem}.expansion{display:grid;grid-template-rows:0fr;transition:grid-template-rows 110ms cubic-bezier(.2,.7,.2,1)}.expansion.expanded{grid-template-rows:1fr;transition-duration:170ms}.expansion>div{overflow:hidden;min-height:0;opacity:0;transition:opacity 90ms linear}.expansion.expanded>div{opacity:1;transition-delay:20ms}@media(max-width:800px){.specimen-grid{grid-template-columns:1fr}.specimen{padding:18px}}
</style>
