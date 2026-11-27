// node scripts/lock-check.mjs: the device lock's rules, against a temp data dir. Exits non-zero on failure.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquire, holders, release } from "../src/device-lock.mjs";

const dir = await mkdtemp(join(tmpdir(), "lock-check-"));
const A = { id: "/repo/a", name: "a" }, A2 = { ...A, session: "other-agent" }, B = { id: "/repo/b", name: "b" };
const fast = { poll: 20 };

// same project shares the lock, any agent of it
assert.equal(await acquire(dir, "emulator-5554", A, fast), true);
assert.equal(await acquire(dir, "emulator-5554", A2, fast), true);
assert.deepEqual(Object.keys(await holders(dir)), ["emulator-5554"]);
assert.equal((await holders(dir))["emulator-5554"].project, "a");

// another project waits (and is told who), then gets the device once the owner releases
let told = null;
const waiting = acquire(dir, "emulator-5554", B, { ...fast, onWait: (l) => (told = l.project.name) });
await new Promise((r) => setTimeout(r, 100));
assert.equal(told, "a");
assert.deepEqual(await release(dir, B, "emulator-5554"), []); // a non-owner cannot release
assert.deepEqual(await release(dir, A), ["emulator-5554"]);
assert.equal(await waiting, true);
assert.equal((await holders(dir))["emulator-5554"].project, "b");

// a stale lock is taken over
const path = join(dir, "locks", "emulator-5554.json");
const lock = JSON.parse(await readFile(path, "utf8"));
await writeFile(path, JSON.stringify({ ...lock, project: B, used: Date.now() - 4 * 60 * 1000 }));
assert.deepEqual(await holders(dir), {}); // stale locks are not shown
assert.equal(await acquire(dir, "emulator-5554", A, fast), true);
assert.equal((await holders(dir))["emulator-5554"].project, "a");

// a busy device times out with the documented error
await assert.rejects(acquire(dir, "emulator-5554", B, { ...fast, wait: 0.1 }), /^Error: device emulator-5554 is busy: in use by project a since \d{4}-/);

// a cancelled wait gives up quietly
assert.equal(await acquire(dir, "emulator-5554", B, { ...fast, cancelled: () => true }), false);

// two different devices do not interfere
assert.equal(await acquire(dir, "192.168.1.20:37123", B, fast), true);

console.log("lock-check: ok");
