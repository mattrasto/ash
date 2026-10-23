import {build} from 'vite';
import {rendererConfig} from './renderer-config.ts';
if(!process.permission?.has('fs.read')&&process.permission?.has('fs.write',process.argv[3])){
  await build(rendererConfig(process.argv[2],process.argv[3],process.argv[4]));
}else throw Error('Protected renderer compilation requires restricted filesystem permissions.');
