import { nativePreview } from './adapt-preview.ts';
  try{
    const action=process.argv[2],input=action==='perform'?{workspaceId:process.argv[4]}:JSON.parse(await new Promise<string>((resolve,reject)=>{let text='';process.stdin.on('data',chunk=>{text+=chunk;if(text.length>8*1024*1024)reject(new Error('Preview request too large.'));});process.stdin.on('end',()=>resolve(text));}));
    console.log(JSON.stringify(await nativePreview(action,process.argv[3],input)));
  }catch(error){console.error(error instanceof Error?error.message:'Preview controller failed.');process.exitCode=1;}
