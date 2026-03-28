import '../env';
import { runMigrations, closePool } from './deployment.model';

async function main(): Promise<void> {
  console.log('Running migrations...');
  await runMigrations();
  console.log('Migrations complete.');
  await closePool();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
