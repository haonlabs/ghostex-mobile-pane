// One lock per device, so an agent (or the Run panel) of one project does not tap, install or launch
// over another project's test session. The lock is a JSON file in the data dir; agents of the same
// project share it, other projects wait. It frees itself after STALE_MS without an action from the owner.
import { execFile } from "node:child_process";
import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const STALE_MS = 3 * 60 * 1000;
export const WAIT_S = 10 * 60;
const POLL_MS = 2000;

const dirOf = (dataDir) => join(dataDir, "locks");
const fileOf = (dataDir, device) => join(dirOf(dataDir), `${String(device).replace(/[^\w.-]/g, "_")}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Who is calling: the git repository of `dir`, so every checkout and worktree of one repository counts as one project
 * (the Run panel and an agent inside that repository agree without asking Ghostex). Outside git: `dir` itself.
 */
export async function projectOf(dir = process.cwd()) {
  const git = await new Promise((resolve) =>
    execFile("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, timeout: 5000 }, (e, out) => resolve(e ? "" : out.trim())));
  const root = git.endsWith("/.git") ? dirname(git) : dir;
  const ref = process.env.GHOSTEX_GLOBAL_SESSION_REF;
  return { id: root, name: basename(root), ...(ref ? { session: ref } : {}) };
}

async function read(dataDir, device) {
  try {
    return JSON.parse(await readFile(fileOf(dataDir, device), "utf8"));
  } catch (e) {
    return e.code === "ENOENT" ? null : { project: { id: "?", name: "unknown" }, since: "", used: 0 }; // unreadable = stale
  }
}

const fresh = (lock, stale = STALE_MS) => lock && Date.now() - lock.used < stale;

/** Creates the lock file complete or not at all: write a temp file, then hard-link it into place (fails if it exists). */
async function create(dataDir, device, owner, since) {
  await mkdir(dirOf(dataDir), { recursive: true });
  const path = fileOf(dataDir, device);
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, JSON.stringify({ device, project: { id: owner.id, name: owner.name }, session: owner.session ?? null, since, used: Date.now() }));
  try {
    await link(tmp, path);
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/**
 * Takes or refreshes the device lock for `owner` ({id, name, session?}). While another project holds it, waits
 * (polling) up to `wait` seconds, then throws "device <id> is busy: …". `onWait(lock)` is called when the holder
 * changes; `cancelled()` ends the wait early (returns false). Returns true once held.
 */
export async function acquire(dataDir, device, owner, { wait = WAIT_S, onWait, cancelled, stale = STALE_MS, poll = POLL_MS } = {}) {
  const deadline = Date.now() + Number(wait) * 1000;
  let seen = null;
  for (;;) {
    const lock = await read(dataDir, device);
    if (lock && fresh(lock, stale) && lock.project.id === owner.id) {
      // Same project: refresh the clock (temp file + rename, so a reader never sees half a file).
      const tmp = `${fileOf(dataDir, device)}.${process.pid}.t`;
      await writeFile(tmp, JSON.stringify({ ...lock, session: owner.session ?? lock.session, used: Date.now() }));
      await rename(tmp, fileOf(dataDir, device));
      return true;
    }
    // ponytail: two callers seeing the same stale lock at the same instant can both take it over; fine for a 2 s poll.
    if (lock && !fresh(lock, stale)) await unlink(fileOf(dataDir, device)).catch(() => {});
    if (!lock || !fresh(lock, stale)) {
      if (await create(dataDir, device, owner, new Date().toISOString())) return true;
      continue; // lost the race: read who won
    }
    if (cancelled?.()) return false;
    if (Date.now() >= deadline) throw new Error(`device ${device} is busy: in use by project ${lock.project.name} since ${lock.since}`);
    if (seen !== lock.project.id) onWait?.(lock), (seen = lock.project.id);
    await sleep(Math.min(poll, Math.max(deadline - Date.now(), 0)));
  }
}

/** Frees the lock if `owner`'s project holds it. Without `device`: every lock of that project. Returns the device ids freed. */
export async function release(dataDir, owner, device) {
  const names = device ? [basename(fileOf(dataDir, device))] : await readdir(dirOf(dataDir)).catch(() => []);
  const freed = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const lock = JSON.parse(await readFile(join(dirOf(dataDir), name), "utf8").catch(() => "null"));
    if (lock?.project.id === owner.id && (await unlink(join(dirOf(dataDir), name)).then(() => true, () => false))) freed.push(lock.device);
  }
  return freed;
}

/** { <device id>: {project, since, used} } for every lock that has not gone stale. */
export async function holders(dataDir) {
  const out = {};
  for (const name of await readdir(dirOf(dataDir)).catch(() => [])) {
    const lock = name.endsWith(".json") && JSON.parse(await readFile(join(dirOf(dataDir), name), "utf8").catch(() => "null"));
    if (fresh(lock)) out[lock.device] = { project: lock.project.name, since: lock.since };
  }
  return out;
}
