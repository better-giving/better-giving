import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRAND_TOKENS } from './brand';

// the element's brand sheet sets only `BRAND_TOKENS` (./brand.ts), so a rule anywhere in the package
// that reads another step of the scale would read nothing on the element. this holds the list to
// every name the package's sheets and scripts spend, comments aside, and the two modules that write
// the scale aside.

const SRC = new URL('../', import.meta.url);
const WRITERS = ['styles/radix-scale.ts', 'styles/brand.ts'];

/** every stylesheet and script under src/, by path relative to it, specs and the scale's writers aside. */
function sources(dir = ''): string[] {
	return readdirSync(new URL(dir, SRC), { withFileTypes: true }).flatMap((entry) => {
		const path = `${dir}${entry.name}`;
		if (entry.isDirectory()) return sources(`${path}/`);
		if (!/\.(css|ts)$/.test(entry.name) || /\.(spec|testing)\.ts$/.test(entry.name)) return [];
		return WRITERS.includes(path) ? [] : [path];
	});
}

/** the brand scale's private names a source spends, with its comments taken out. */
function spent(path: string): string[] {
	const code = readFileSync(new URL(path, SRC), 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '');
	return [...code.matchAll(/--_(a\d+|p-hover|on-p|p)(?![\w-])/g)].map(([name]) => name);
}

describe('the brand sheet sets what the card reads', () => {
	it('names every step of the scale the package spends, and no other', () => {
		const names = new Set(sources().flatMap(spent));
		expect([...names].sort()).toEqual([...BRAND_TOKENS].sort());
	});
});
