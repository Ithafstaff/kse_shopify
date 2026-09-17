const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { Pool } = require('pg');

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const sql = await readFile(
      resolve(__dirname, '..', 'migrations', 'linendipity', '001_sessions_and_draft_attempts.sql'),
      'utf8',
    );
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exitCode = 1;
});
