import { _electron } from 'playwright';
import { processRef } from '../../scripts/dev/io.ts';
import { measure, recordResource } from '../../scripts/dev/telemetry.ts';

export async function launchElectron(options: Parameters<typeof _electron.launch>[0]) {
  return measure('electron.launch', async () => {
    const app = await _electron.launch(options);
    try {
      const ref = await processRef(app.process().pid!);
      recordResource('processes', String(ref.pid), ref);
      return app;
    } catch (error) { await app.close(); throw error; }
  });
}
