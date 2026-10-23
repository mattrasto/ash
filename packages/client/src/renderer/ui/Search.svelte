<script lang="ts">
  import Icon from './Icon.svelte';
  let {value=$bindable(''),label='Search',placeholder='Search…',disabled=false,suggestions,onKeyDown,onFocus,onBlur}:{value?:string;label?:string;placeholder?:string;disabled?:boolean;suggestions?:{expanded:boolean;controls:string;activeDescendant?:string};onKeyDown?:(event:KeyboardEvent)=>void;onFocus?:()=>void;onBlur?:()=>void}=$props();
  let input:HTMLInputElement;
  function clear(){value='';input.focus();}
</script>
<div class="ash-search"><input class="ash-field" type="search" role={suggestions?'combobox':undefined} aria-autocomplete={suggestions?'list':undefined} aria-expanded={suggestions?.expanded} aria-controls={suggestions?.expanded?suggestions.controls:undefined} aria-activedescendant={suggestions?.activeDescendant} aria-label={label} {placeholder} {disabled} bind:value bind:this={input} onfocus={onFocus} onblur={onBlur} onkeydown={event=>{if(event.key==='Escape'&&value){event.preventDefault();event.stopPropagation();clear();}else onKeyDown?.(event);}}/><button type="button" class="ash-menu-row" aria-label={`Clear ${label.toLowerCase()}`} disabled={disabled||!value} aria-hidden={!value} tabindex={value?0:-1} onclick={clear} style:opacity={value?1:0}><Icon name="close"/></button></div>
<style>.ash-search{position:relative}.ash-search input{width:100%;padding-right:42px!important}.ash-search button{position:absolute;right:4px;top:4px;bottom:4px;display:grid;place-items:center;min-height:30px;width:30px;padding:0;transition:opacity 100ms}.ash-search input::-webkit-search-cancel-button{display:none}</style>
