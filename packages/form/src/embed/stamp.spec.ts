import { describe, expect, it } from 'vitest';
import { RUNTIME_PATH_PLACEHOLDER, runtimeAssetPath, stampLoader } from './stamp';

// the build's two pure steps, asserted here rather than through a build.
//
// `test` runs at commit time with no build ordered ahead of it, so at the moment these run there
// is no bundle on disk to look at — the same reason vitest.workers.config.ts declares its bindings
// instead of pointing at wrangler.jsonc's `main`. so the work worth asserting is lifted out of the
// build script into functions that take strings and return strings, and the build calls them.

describe('the runtime path', () => {
	it('is the hashed file under /embed', () => {
		expect(runtimeAssetPath(['9f2a1c4e.js'])).toBe('/embed/9f2a1c4e.js');
	});

	it('ignores everything that is not a script', () => {
		expect(runtimeAssetPath(['9f2a1c4e.js', '.DS_Store', 'notes.txt'])).toBe('/embed/9f2a1c4e.js');
	});

	// a second file is a build that did not clean up after itself, and the loader would then be
	// stamped with whichever name the filesystem happened to list first — pinning every already
	// pasted snippet to an arbitrary one of two runtimes.
	it('refuses a directory holding more than one runtime', () => {
		expect(() => runtimeAssetPath(['9f2a1c4e.js', '3b70d155.js'])).toThrow(/one/);
	});

	it('refuses a directory holding none', () => {
		expect(() => runtimeAssetPath([])).toThrow(/one/);
	});
});

describe('stamping the loader', () => {
	it('replaces the placeholder with the runtime path', () => {
		const source = `var p=${JSON.stringify(RUNTIME_PATH_PLACEHOLDER)};load(p);`;
		expect(stampLoader(source, '/embed/9f2a1c4e.js')).toBe('var p="/embed/9f2a1c4e.js";load(p);');
	});

	// the same two inputs give the same output every time, which is what lets the emitted loader be
	// compared across builds and what keeps this assertable without running one.
	it('is deterministic', () => {
		const source = `send(${JSON.stringify(RUNTIME_PATH_PLACEHOLDER)})`;
		expect(stampLoader(source, '/embed/aa.js')).toBe(stampLoader(source, '/embed/aa.js'));
		expect(stampLoader(source, '/embed/aa.js')).not.toBe(stampLoader(source, '/embed/bb.js'));
	});

	// a minifier is free to inline the constant at more than one use site, so every occurrence is
	// replaced rather than the first.
	it('replaces every occurrence', () => {
		const source = `a(${JSON.stringify(RUNTIME_PATH_PLACEHOLDER)});b(${JSON.stringify(RUNTIME_PATH_PLACEHOLDER)});`;
		expect(stampLoader(source, '/embed/aa.js')).toBe('a("/embed/aa.js");b("/embed/aa.js");');
	});

	// an unstamped loader is one that asks the deployment for a file called by the placeholder's
	// own name, which is a 404 on every donor page load and nothing on screen. the build stops
	// instead.
	it('refuses source the placeholder is missing from', () => {
		expect(() => stampLoader('load("/embed/hand-written.js")', '/embed/aa.js')).toThrow(
			/placeholder/
		);
	});

	// the path is written into a string literal in output that has already been minified, and which
	// quoting that literal uses is the minifier's choice — vite emits template literals, so the two
	// characters that actually end one are a backtick and `${`, not a quote. the guard therefore
	// checks the one shape a path may have rather than a list of characters it may not, which is
	// what makes it hold when the minifier changes its mind.
	it.each([
		['a backtick', '/embed/a`.js'],
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal substring under test, not an unclosed template
		['a template substitution', '/embed/a${x}.js'],
		['a double quote', '/embed/a".js'],
		['a single quote', "/embed/a'.js"],
		['a backslash', '/embed/a\\b.js'],
		['a line break', '/embed/a\nb.js'],
		['a path outside the runtime directory', '/elsewhere/a.js'],
		['something that is not a script', '/embed/a.css'],
		['a directory and no file', '/embed/']
	])('refuses a runtime path carrying %s', (_case, path) => {
		expect(() => stampLoader(`x(${JSON.stringify(RUNTIME_PATH_PLACEHOLDER)})`, path)).toThrow(
			/must be/
		);
	});

	it('accepts the shape a rollup hash actually takes', () => {
		const source = `x(${JSON.stringify(RUNTIME_PATH_PLACEHOLDER)})`;
		expect(stampLoader(source, '/embed/BO3BHuQD.js')).toContain('/embed/BO3BHuQD.js');
		expect(stampLoader(source, '/embed/a_b-c9.js')).toContain('/embed/a_b-c9.js');
	});
});
