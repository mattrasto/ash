import {writable} from 'svelte/store';
const debugKey='ash-debug-mode-v1';
function readDebug(){try{return localStorage.getItem(debugKey)==='true';}catch{return false;}}
export const debugMode=writable(readDebug());
export function setDebugMode(value:boolean){debugMode.set(value);try{localStorage.setItem(debugKey,String(value));}catch{}}
