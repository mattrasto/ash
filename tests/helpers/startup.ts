import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Instance } from '../../packages/shared/src/index.ts';
import { alive, id, sleep, type ProcessRef } from '../../scripts/dev/io.ts';
import { runtime, startInstance } from '../../scripts/dev/lifecycle.ts';
import type { Workspace } from '../../scripts/dev/workspace.ts';

// Only call in a disposable source checkout with a stopped or crashed instance.
export async function checkStartupPreparationFailure(ws: Workspace, instance: Instance) {
  const path = join(ws.checkout,'scripts/dev/build.ts'),original = await readFile(path,'utf8');
  const release = join(instance.root,`startup-${id()}.release`),prior = (await runtime(instance))?.supervisor.pid;
  await writeFile(path,original+`\nimport {existsSync as startupProbeReleased} from 'node:fs';\nwhile(!startupProbeReleased(${JSON.stringify(release)}))await new Promise(resolve=>setTimeout(resolve,10));\nthrow new Error('Controlled frontend preparation failure');\n`);
  let failure: unknown, children: ProcessRef[] = [];
  const attempt = startInstance(ws,instance.id,{headless:true}).then(()=>{},error=>{failure=error;});
  try {
    for (let n=0;n<1500;n++) {
      const current=await runtime(instance);
      if (current && current.supervisor.pid!==prior && current.children.length) {children=current.children;break;}
      await sleep(10);
    }
    assert.ok(children.length,'A real backend starts while frontend preparation waits');
  } finally {
    await writeFile(release,'');
    try {await attempt;} finally {await writeFile(path,original);await rm(release,{force:true});}
  }
  assert.match(String(failure),/Controlled frontend preparation failure/);
  assert.equal((await runtime(instance))?.phase,'failed');
  for (const child of children) assert.equal(await alive(child),false,'Failed preparation cleans its already-started backend');
}
