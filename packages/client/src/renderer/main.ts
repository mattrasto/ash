import { mount } from 'svelte';
import App from './App.svelte';
import './tooltips.css';
mount(App, { target: document.getElementById('app')! });
