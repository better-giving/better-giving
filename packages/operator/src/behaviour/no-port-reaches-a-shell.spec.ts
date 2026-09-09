import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// the line between the two entry points, as a fact a passing suite has checked rather than a
// sentence in a header.
//
// ../components/** is a port: `packages/app/src/entry.server.tsx` renders every screen with
// `renderToReadableStream` before any of it reaches a browser, so a port has to produce markup
// with no document under it. this directory is on the other side of that line — it needs a
// document (see ./Dialog.tsx), and it is `.tsx` where every port is `.jsx`, so a glob over the
// ports never reaches it.
//
// what none of that stops is an import: a port reaching in here would compile and bundle, and then
// break server rendering the moment a real request hits the screen it sits on — silently, because
// the failure only shows up under `renderToReadableStream`, never in a browser where a document is
// already there. that is the case below.
//
// the direction is one-way on purpose and the reverse is the whole design — the shells here import
// the interiors, which is what keeps one interior.

const PORTS = globSync('src/components/*/*.jsx');
const SHELLS = globSync('src/behaviour/*.tsx').filter((file) => !file.includes('.spec.'));

/** an import naming this directory, in either spelling a port could reach it by. */
const REACHES = /from\s*['"][^'"]*(?:\.\.\/behaviour\/|@better-giving\/operator\/behaviour\/)/;

describe('the behaviour shells', () => {
	it('finds the trees it is meant to be guarding', () => {
		// a glob that quietly stopped matching would read as a passing gate forever.
		expect(PORTS.length).toBeGreaterThan(20);
		expect(SHELLS.length).toBeGreaterThan(0);
	});

	it('are reached by no port in ../components/**', () => {
		const hits = PORTS.flatMap((file) =>
			readFileSync(file, 'utf8')
				.split('\n')
				.map((text, i) => ({ file, line: i + 1, text }))
				.filter((hit) => REACHES.test(hit.text))
		);
		expect(hits).toEqual([]);
	});

	it('are each named by an entry in this package exports', () => {
		// the shells are reached by the app and the console and by nothing else, and a package with
		// no wildcard in its `exports` is what makes that a resolution failure rather than a rule.
		const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
			exports: Record<string, string>;
		};
		const published = new Set(Object.values(manifest.exports));
		expect(SHELLS.map((file) => `./${file}`).filter((file) => !published.has(file))).toEqual([]);
	});
});
