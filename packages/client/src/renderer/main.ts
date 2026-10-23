import { mount } from 'svelte';
import {applyTheme} from './ui/theme.ts';
import App from './App.svelte';
import './ui/theme.css';
import './ui/surface.css';
import './ui/features.css';
import './tooltips.css';
applyTheme();
mount(App, { target: document.getElementById('app')! });
