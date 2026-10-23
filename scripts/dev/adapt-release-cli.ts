import {localRelease} from './adapt-release.ts';
try{
  const input=JSON.parse(await new Promise<string>((resolve,reject)=>{let value='';process.stdin.on('data',chunk=>{value+=chunk;if(value.length>8*1024*1024)reject(Error('Application input too large.'));});process.stdin.on('end',()=>resolve(value||'{}'));}));
  console.log(JSON.stringify(await localRelease(process.argv[2],process.argv[3],input)));
}catch(error){console.error(error instanceof Error?error.message:'Application control failed.');process.exitCode=1;}
