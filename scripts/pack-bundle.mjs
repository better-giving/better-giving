// packs the worker bundle the console's deploy press uploads, out of this checkout.
//
// a binary built from a checkout is version `dev` and every release address it derives points at a
// tag that was never cut, so its press can only reach a bundle named to it by
// `BETTER_GIVING_BUNDLE` (packages/console/internal/release/bundle.go). `pnpm console` names the
// file this writes; until this has been run there is none, and the press says so.
//
// the bundle is this app as it is right now. an app change after a pack is not in it, and the press
// keeps uploading the older one until this is run again.
//
// the app's build is invoked rather than reproduced: its three steps put the embed into the client
// build, and a step done here instead is one CLAUDE.md's contract on that chain would not cover.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const consoleDir = join(root, 'packages', 'console');

// named for the version a binary built from this checkout carries, so the file an operator's
// release would hold and the one a contributor packs are spelled the same.
const out = join('bundle', 'worker-dev.tar.gz');

const run = (command, args, cwd) => {
	console.log(`\n$ ${command} ${args.join(' ')}`);
	execFileSync(command, args, { cwd, stdio: 'inherit' });
};

// wrangler writes the worker's entry and every module it imports; nothing reads the directory after
// this script, so it is the platform's temporary one rather than a path in the tree.
const worker = mkdtempSync(join(tmpdir(), 'better-giving-worker-'));

try {
	run('pnpm', ['--filter', '@better-giving/app', 'build'], root);
	run('pnpm', ['wrangler', 'deploy', '--dry-run', '--outdir', worker], root);

	mkdirSync(join(consoleDir, 'bundle'), { recursive: true });
	// pack's other inputs — the assets, the migrations and the baked config — default to where this
	// repository keeps them, and it reads the archive back with the operator's own reader before it
	// exits.
	run('go', ['run', './cmd/pack', '--worker', worker, '--out', out], consoleDir);
} finally {
	rmSync(worker, { recursive: true, force: true });
}
