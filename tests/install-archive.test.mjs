/* [INPUT]: Disposable application image and local process identity probe.
 * [OUTPUT]: Upgrade archive preserves the live executable inode/path; failures retain the old App.
 * [POS]: Isolated installer regression; no user App, host, permissions or business data.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveApplication } from '../scripts/install-archive.mjs';

test(
  'archiving a running App retains its native executable identity',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'palboo-install-archive-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const previous = join(root, 'previous.app'),
      next = join(root, 'backups/previous.app');
    const executable = 'Contents/MacOS/Launcher';
    mkdirSync(join(previous, 'Contents/MacOS'), { recursive: true });
    execFileSync('xcrun', ['clang', '-x', 'c', '-o', join(previous, executable), '-'], {
      input: '#include <unistd.h>\nint main(void){sleep(30);return 0;}\n',
    });
    const original = statSync(join(previous, executable));
    const probe = join(root, 'identity');
    execFileSync('xcrun', ['clang', '-x', 'c', '-o', probe, '-'], {
      input:
        '#include <libproc.h>\n#include <stdio.h>\n#include <stdlib.h>\nint main(int argc,char**argv){char p[PROC_PIDPATHINFO_MAXSIZE];if(proc_pidpath(atoi(argv[1]),p,sizeof(p))<=0){perror("proc_pidpath");return 1;}puts(p);return 0;}\n',
    });
    const child = spawn(join(previous, executable), ['30'], { stdio: 'ignore' });
    await once(child, 'spawn');
    try {
      const before = execFileSync(probe, [String(child.pid)], { encoding: 'utf8' }).trim();
      assert.equal(statSync(before).ino, original.ino);
      archiveApplication(previous, next);
      const moved = statSync(join(next, executable));
      assert.equal(moved.ino, original.ino);
      assert.equal(moved.dev, original.dev);
      const actual = execFileSync(probe, [String(child.pid)], { encoding: 'utf8' }).trim();
      assert.equal(statSync(actual).ino, original.ino, 'macOS can still resolve the live image');
      assert.equal(existsSync(previous), false);
      const blocked = join(root, 'blocked');
      copyFileSync('/bin/sleep', blocked);
      assert.throws(() => archiveApplication(next, join(blocked, 'previous.app')));
      assert.equal(statSync(join(next, executable)).ino, original.ino);
    } finally {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
  },
);
