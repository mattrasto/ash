<script lang="ts">
  import Icon from './Icon.svelte';
  let {value=$bindable(0),label,min=0,max=100,step=1,disabled=false}:{value?:number;label:string;min?:number;max?:number;step?:number;disabled?:boolean}=$props();
  let input:HTMLInputElement;
  function change(direction:number){if(direction>0)input.stepUp();else input.stepDown();value=input.valueAsNumber;input.focus();}
</script>
<div class="ash-number"><input class="ash-field" type="number" aria-label={label} bind:value bind:this={input} {min} {max} {step} {disabled}/><div><button type="button" class="ash-menu-row" aria-label={`Decrease ${label.toLowerCase()}`} aria-disabled={disabled||value<=min} disabled={disabled} onclick={()=>{if(value>min)change(-1);}}><Icon name="minus"/></button><button type="button" class="ash-menu-row" aria-label={`Increase ${label.toLowerCase()}`} aria-disabled={disabled||value>=max} disabled={disabled} onclick={()=>{if(value<max)change(1);}}><Icon name="new"/></button></div></div>
<style>.ash-number{position:relative}.ash-number input{width:100%;padding-right:78px!important;appearance:textfield}.ash-number input::-webkit-inner-spin-button{appearance:none}.ash-number>div{position:absolute;right:4px;top:4px;bottom:4px;display:flex;gap:2px}.ash-number button{display:grid;place-items:center;min-height:30px;width:30px;padding:0}.ash-number button[aria-disabled=true]{opacity:.4;cursor:default}</style>
