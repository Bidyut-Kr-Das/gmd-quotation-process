// Links the root .env into every app and package so there is one file to maintain.
// Runs on `pnpm install` (root postinstall). Safe to rerun.
// Symlink first; on Windows without Developer Mode symlinks need admin, so fall back to a hardlink.
// Never overwrites a real .env that is not already linked to the root one.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const rootEnv = path.join(root, ".env");

// CI/Vercel set env vars in the dashboard and have no root .env.
if (!fs.existsSync(rootEnv)) process.exit(0);

const rootIno = fs.statSync(rootEnv).ino;

for (const group of ["apps", "packages"]) {
  const groupDir = path.join(root, group);
  if (!fs.existsSync(groupDir)) continue;

  for (const name of fs.readdirSync(groupDir)) {
    const dir = path.join(groupDir, name);
    if (!fs.existsSync(path.join(dir, "package.json"))) continue;

    const target = path.join(dir, ".env");
    const rel = path.relative(root, target);
    const existing = fs.lstatSync(target, { throwIfNoEntry: false });

    if (existing?.isSymbolicLink()) fs.unlinkSync(target); // refresh, may be stale
    else if (existing && existing.ino === rootIno) continue; // hardlink already in place
    else if (existing) {
      console.warn(`link-env: skipped ${rel} (real file). Move its values into the root .env and delete it.`);
      continue;
    }

    try {
      fs.symlinkSync(path.relative(dir, rootEnv), target, "file");
      console.log(`link-env: ${rel} -> .env (symlink)`);
    } catch {
      fs.linkSync(rootEnv, target);
      console.log(`link-env: ${rel} -> .env (hardlink)`);
    }
  }
}
