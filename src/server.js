import { buildApp } from './app.js';
import { scheduleNightlyMaintenance } from './lib/backup.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DB_PATH = process.env.SWITCHBOARD_DB_PATH ?? './data/switchboard.db';
const BACKUP_PATH = process.env.SWITCHBOARD_BACKUP_PATH ?? './data/backups/switchboard-backup.db';

const app = buildApp({ dbPath: DB_PATH });

const stopMaintenance = scheduleNightlyMaintenance(app.rawDb, { backupPath: BACKUP_PATH });

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    stopMaintenance();
    await app.close();
    process.exit(0);
  });
}
