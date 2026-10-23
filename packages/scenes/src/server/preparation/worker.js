import {parentPort,workerData} from 'node:worker_threads';
import {prepareWithInference} from './core.js';

// A missing local model cannot fall through to a download, even if a dependency regresses.
globalThis.fetch=async()=>{throw new Error('Network access is disabled in the scene preparation worker. Install pinned models separately.');};
const onProgress=stage=>parentPort.postMessage({type:'progress',stage});
let inference;
try{
  const module=await import(workerData.inferenceModule??new URL('./transformers.js',import.meta.url).href);
  inference=await module.createInference({installation:workerData.installation,onProgress});
  const result=await prepareWithInference(workerData.source,inference,{models:workerData.installation?.models??[],injected:!!workerData.inferenceModule,onProgress});
  await inference.dispose?.();inference=null;
  parentPort.postMessage({type:'result',result});
}catch(error){
  try{await inference?.dispose?.();}catch{}
  parentPort.postMessage({type:'error',message:error instanceof Error?error.message:'Scene preparation failed.'});
}finally{parentPort.close();}
