import path from 'path';
import dotenv from 'dotenv';

// Integration tests TRUNCATE tables, so they must never inherit the app's
// DATABASE_URL. Point them at TEST_DATABASE_URL (shell or root .env) instead.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests wipe their database, so set it to a dedicated ' +
      'test database (same credentials/port as DATABASE_URL, e.g. ' +
      'postgres://wherewewere:wherewewere@localhost:5432/wherewewere_test) in .env or your shell. ' +
      'The database is created automatically if it does not exist.'
  );
}
process.env.DATABASE_URL = testUrl;
