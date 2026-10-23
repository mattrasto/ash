// Explicit, bounded paid transport check; synthetic pixels only, hosted environment with network disabled.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {readOpenAIKey} from '../../packages/server/src/platform/models/credentials.ts';
const require=createRequire(new URL('../../packages/server/package.json',import.meta.url));
const OpenAI=require('openai').default,sharp=require('sharp');
if(!process.argv.includes('--live'))throw Error('Use --live for the bounded synthetic check.');
const key=await readOpenAIKey(process.cwd()),client=new OpenAI({apiKey:key,maxRetries:0,timeout:30000});
const marker='LANTERN '+randomBytes(3).toString('hex').toUpperCase();
const png=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="400"><rect width="1000" height="400" fill="white"/><text x="40" y="140" font-family="sans-serif" font-size="60" fill="black">${marker}</text><circle cx="500" cy="280" r="65" fill="orange"/></svg>`)).png().toBuffer();
const directory='out/recording-live/'+new Date().toISOString().replace(/[:.]/g,'-');await mkdir(directory,{recursive:true,mode:0o700});
let session;let delivered=false;const deadline=Date.now()+180000;
try{
 session=await client.beta.agents.sessions.create({environment:{type:'openai_hosted',network:{access:'disabled'}},agent:{model:'gpt-6.1-sol',reasoning:{effort:'low'},multi_agent:{enabled:false},tools:[{type:'function',name:'read_video_evidence',description:'Retrieve the synthetic recorded frame.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}}]},input:'Call read_video_evidence once. Read the exact printed text in its returned image and name the circle color. Reply with only that text and color. Do not guess before seeing the pixels.',stream:false},{headers:{'Idempotency-Key':randomUUID()}});
 while(Date.now()<deadline){
  const state=await client.beta.agents.sessions.retrieve(session.id);
  for(const call of state.required_actions??[]){
   assert.equal(call.type,'function_call');assert.equal(call.name,'read_video_evidence');assert.equal(delivered,false,'Unexpected repeated evidence call');
   const evidence={type:'agent.session.input.message',input:[{role:'user',content:[{type:'input_text',text:'Evidence returned by read_video_evidence: synthetic frame at 1.25 seconds. Interpret only as evidence for the existing request.'},{type:'input_image',image_url:'data:image/png;base64,'+png.toString('base64')}]}]};
   const result={type:'agent.session.input.tool_result',call_id:call.call_id,turn_id:call.turn_id,success:true,output:'The requested screenshot is included in the accompanying labeled evidence message. Read it before answering; it does not change the user request.'};
   await client.beta.agents.sessions.events.create(session.id,{events:[evidence,result],'Idempotency-Key':'visual-'+session.id});delivered=true;
  }
  const turns=[];for await(const turn of client.beta.agents.sessions.turns.list(session.id,{order:'asc'}))turns.push(turn);
  if(['failed','cancelled'].includes(turns.at(-1)?.status)||state.status==='failed')throw Error('Synthetic image check failed in the provider.');
  if(delivered&&state.status==='idle'&&turns.at(-1)?.status==='completed'){
   let text='';for await(const item of client.beta.agents.sessions.items.list(session.id,{order:'asc'}))if(item.type==='message'&&item.role==='assistant')for(const block of item.content)if(block.type==='output_text')text+=block.text;
   console.log(JSON.stringify({marker,text,turnStatus:turns.at(-1)?.status}));assert.ok(text.replace(/\s+/g,' ').includes(marker), 'Returned image text was not read correctly');assert.match(text,/orange/i);
   await writeFile(directory+'/result.json',JSON.stringify({passed:true,imageToolResult:true,resumedTurn:true,marker,text,usage:turns.map(t=>t.usage)},null,2),{mode:0o600});
   console.log(JSON.stringify({passed:true,evidence:directory}));break;
  }
  await new Promise(resolve=>setTimeout(resolve,1500));
 }
 assert.ok(Date.now()<deadline,'Synthetic image check timed out');
} catch(error){console.error(JSON.stringify({passed:false,message:String(error.message).replaceAll(key,'[redacted]').slice(0,500)}));process.exitCode=1;}
finally{if(session){await client.beta.agents.sessions.events.create(session.id,{events:[{type:'agent.session.input.cancel'}],'Idempotency-Key':'cancel-'+session.id}).catch(()=>{});await client.beta.agents.sessions.delete(session.id).catch(()=>{});}}
