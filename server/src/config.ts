import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://wherewewere:wherewewere@localhost:5432/wherewewere',
  photosDir: process.env.PHOTOS_DIR || path.resolve(__dirname, '../../uploads'),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  baseUrl: process.env.BASE_URL || 'http://localhost:3001',
  nodeEnv: process.env.NODE_ENV || 'development',
};
