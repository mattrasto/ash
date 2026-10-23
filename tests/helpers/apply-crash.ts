import {Instance} from '../../packages/shared/src/index.ts';
import {json} from '../../scripts/dev/io.ts';
import {RendererReleaseHost} from '../../scripts/dev/renderer-release-host.ts';
const instance=Instance.parse(await json(process.argv[2]));
const host=new RendererReleaseHost(instance,async()=>{process.exit(78);});
await host.initialize();await host.install(process.argv[3],process.argv[4]);
throw Error('Crash injection was not reached.');
