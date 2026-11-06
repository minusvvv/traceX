// Explicit maintenance command. Creates declared indexes; never drops indexes or records.
// Review and back up production before running this against a live database.
import mongoose from "mongoose";
import {connectDb, disconnectDb} from "./db.js";

try {
  await connectDb();
  for (const model of Object.values(mongoose.models)) {
    await model.createIndexes();
    console.log(`[indexes] ${model.modelName}: declared indexes ready`);
  }
} catch {
  console.error("[indexes] Index creation failed. Check database access and existing duplicate keys; no records were removed.");
  process.exitCode = 1;
} finally { await disconnectDb(); }
