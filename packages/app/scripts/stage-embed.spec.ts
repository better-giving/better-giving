import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from './stage-embed.js';

/**
 * every case runs against a temp directory and never against this checkout's own
 * `packages/form/dist/` or `static/` — see scripts/preflight-deploy.spec.js for the same reason.
 */
const roots: string[] = [];

afterEach(() => {
	while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/**
 * a checkout with a form build already sitting in `packages/form/dist/`, or none at all.
 *
 * a whole workspace rather than one directory, because the form's output is a sibling package's
 * and reaching it is the thing under test — what comes back is `packages/app/`, which is where
 * every build runs and therefore what `main` is handed.
 */
function workspace({
	dist,
	runtimeFiles = ['a1b2c3d4.js']
}: {
	dist?: boolean;
	runtimeFiles?: string[];
} = {}): string {
	const root = mkdtempSync(join(tmpdir(), 'stage-embed-'));
	roots.push(root);

	const app = join(root, 'packages', 'app');
	mkdirSync(app, { recursive: true });
	if (dist === false) return app;

	const distDir = join(root, 'packages', 'form', 'dist');
	mkdirSync(distDir, { recursive: true });
	writeFileSync(join(distDir, 'embed.js'), '// the loader half\n');

	const runtimeDir = join(distDir, 'embed');
	mkdirSync(runtimeDir, { recursive: true });
	for (const name of runtimeFiles) writeFileSync(join(runtimeDir, name), '// the runtime half\n');

	return app;
}

describe('staging the embed into static/', () => {
	it('refuses when the form has not been built, naming the fix', () => {
		const app = workspace({ dist: false });
		expect(() => main(app)).toThrow(/build:embed/);
	});

	it('copies both halves to where vite build expects them', () => {
		const app = workspace();
		main(app);
		expect(readdirSync(join(app, 'static'))).toContain('embed.js');
		expect(readdirSync(join(app, 'static', 'embed'))).toEqual(['a1b2c3d4.js']);
	});

	// the same guard packages/form/vite.embed.config.ts's loader pass already trusts is true by the
	// time it stamps a path into the loader — read here off the form build's own output, before
	// anything is cleared or copied, which is what tells a broken form build apart from a broken
	// staging step.
	it('refuses a form build that left anything but exactly one runtime, blaming the form build', () => {
		const app = workspace({ runtimeFiles: ['a1b2c3d4.js', 'e5f6a7b8.js'] });
		expect(() => main(app)).toThrow(/the form build.*left 2/);
	});

	// `cpSync` is additive, and the runtime carries a content hash in its name — so a previous
	// build's file is a different name from the current one and a plain copy would leave both
	// sitting in static/embed/ forever. every case above this one starts from an empty static/,
	// which is exactly why the suite could not see this: the destination has to already hold
	// something for "clears" and "merges into" to give different answers.
	it('clears a previous build’s runtime rather than merging into it', () => {
		const app = workspace({ runtimeFiles: ['e5f6a7b8.js'] });
		mkdirSync(join(app, 'static', 'embed'), { recursive: true });
		writeFileSync(join(app, 'static', 'embed', 'a1b2c3d4.js'), '// a previous build’s runtime\n');

		main(app);

		expect(readdirSync(join(app, 'static', 'embed'))).toEqual(['e5f6a7b8.js']);
	});
});
