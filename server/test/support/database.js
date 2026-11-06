import crypto from "node:crypto";

// Never reuse an environment-supplied database name for seeding or cleanup.
export function temporaryDatabase(prefix) {
  const name = `${prefix}_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`;
  const base = process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017";
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?#]+)(?:\/[^?#]*)?(\?[^#]*)?$/.exec(base);
  if (!match) throw new Error("MONGO_URI_TEST must be a valid MongoDB URI for a dedicated test server.");
  return {name, uri: `${match[1]}/${name}${match[2] || ""}`};
}

export async function dropTemporaryDatabase(M, name) {
  if (M.dbName() !== name || !/^tracex_.*_\d+_[a-f0-9]{32}$/.test(name)) throw new Error("Refusing to drop a non-test database.");
  await M.dropDatabase();
}
