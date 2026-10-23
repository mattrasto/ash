import {MODEL_IDS,RUNTIME_VERSION} from './constants.js';

export async function createInference({installation,onProgress=()=>{}}){
  const {pipeline,RawImage,env}=await import('@huggingface/transformers');
  if(env.version!==RUNTIME_VERSION)throw new Error('The installed Transformers.js runtime differs from the pinned preparation version.');
  env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath=installation.cacheRoot.replace(/\/$/,'')+'/';env.cacheDir=installation.cacheRoot;
  // Every local request is pinned and offline. Model installation is never a playback/preparation side effect.
  const options=role=>({dtype:'fp32',device:'cpu',revision:installation.models.find(model=>model.role===role).revision,local_files_only:true,session_options:{intraOpNumThreads:2,interOpNumThreads:1}});
  const loaded=new Map(),image=(pixels,width,height)=>new RawImage(new Uint8ClampedArray(pixels),width,height,3);
  const load=role=>{
    if(!loaded.has(role)){onProgress(`Loading installed ${role} model`);loaded.set(role,pipeline(role==='depth'?'depth-estimation':'image-segmentation',MODEL_IDS[role],options(role)));}
    return loaded.get(role);
  };
  return {sky:async(pixels,width,height)=>(await load('sky'))(image(pixels,width,height)),surfaces:async(pixels,width,height)=>(await load('surfaces'))(image(pixels,width,height)),depth:async(pixels,width,height)=>(await(await load('depth'))(image(pixels,width,height))).predicted_depth.data,
    dispose:async()=>{await Promise.allSettled([...loaded.values()].map(async pending=>(await pending).dispose()));}};
}
