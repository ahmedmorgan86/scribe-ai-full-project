import fs from 'fs';
import path from 'path';

function getDbPath(): string {
  const envPath = process.env.SQLITE_DB_PATH;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  return path.resolve(process.cwd(), 'data', 'ai-social-engine.db');
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function backupDatabase(): void {
  const dbPath = getDbPath();
  const backupDir = path.resolve(process.cwd(), 'backups');

  if (!fs.existsSync(dbPath)) {
    console.log(`Database file not found at: ${dbPath}`);
    console.log('No backup needed - database does not exist yet.');
    process.exit(0);
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log(`Created backup directory: ${backupDir}`);
  }

  const timestamp = formatTimestamp(new Date());
  const backupFilename = `ai-social-engine-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFilename);

  fs.copyFileSync(dbPath, backupPath);
  console.log(`Database backed up to: ${backupPath}`);

  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';

  if (fs.existsSync(walPath)) {
    fs.copyFileSync(walPath, backupPath + '-wal');
    console.log(`WAL file backed up to: ${backupPath}-wal`);
  }

  if (fs.existsSync(shmPath)) {
    fs.copyFileSync(shmPath, backupPath + '-shm');
    console.log(`SHM file backed up to: ${backupPath}-shm`);
  }

  const stats = fs.statSync(backupPath);
  console.log(`Backup size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log('Backup complete.');
}

backupDatabase();
