import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDb() {
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  console.log('[db] Connected to MongoDB');
}

export function closeDb() {
  return mongoose.connection.close();
}
