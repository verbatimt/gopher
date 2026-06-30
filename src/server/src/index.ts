// API entrypoint. Builds the app (app.ts) and starts the HTTP listener when run directly.

import { createApp } from './app.ts';
import { config } from './config.ts';
import { logger } from './observability/logger.ts';
import { startBus } from './realtime/bus.ts';
import { registerAllowanceScheduler } from './workers/allowance-granter.ts';
import { registerMedicationScanScheduler } from './workers/medication-reminders.ts';
import { registerGenerationScheduler } from './workers/recurring-task-generator.ts';

export const app = createApp();

if (import.meta.main) {
  // Start the Redis pub/sub bus so WebSocket fan-out works across instances.
  startBus();
  // Background worker: materialize recurring-task instances within the horizon.
  registerGenerationScheduler();
  // Background worker: medication reminders, missed-dose transitions, refill alerts.
  registerMedicationScanScheduler();
  // Background worker: grant recurring point allowances on schedule.
  registerAllowanceScheduler();
  app.listen(config.port, () => {
    logger.info('gopher-api started', { port: config.port, env: config.nodeEnv });
  });
}
