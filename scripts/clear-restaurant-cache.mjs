import { rmSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const configuredPath = process.env.RESTAURANT_CACHE_DB_PATH?.trim();
const databasePath = configuredPath
  ? isAbsolute(configuredPath)
    ? configuredPath
    : resolve(process.cwd(), configuredPath)
  : join(process.cwd(), ".data", "restaurant-cache.sqlite");

const targets = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
for (const target of targets) {
  rmSync(target, { force: true });
}

console.log(`Cleared restaurant cache: ${databasePath}`);
