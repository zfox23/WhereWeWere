# WhereWeWere

- Unit tests: `npm test`. Integration tests: `npm run test:integration`.
- Integration tests TRUNCATE their database. They read `TEST_DATABASE_URL` (from root `.env` or the shell), never `DATABASE_URL`. If it is missing, add it to `.env` using the same credentials/port as `DATABASE_URL` with a `*_test` database name (see `.env.example`). Never point tests at the real database.
