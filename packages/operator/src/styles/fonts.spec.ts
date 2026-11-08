import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from './raw-values';

// a face whose file is missing falls back to the stack ./tokens.css gives its role without a word.
// this reads ./fonts.css and the directory beside it and holds them to each other.

const SHEET = new URL('./fonts.css', import.meta.url);
const DIR = new URL('./fonts/', import.meta.url);

type Face = { family: string; file: string; weight: number; style: string };

/** every `@font-face` in the sheet, as the family, file, weight and style it declares. */
function facesOf(css: string): Face[] {
	return [...stripComments(css).matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body = '']) => {
		const read = (property: string) =>
			new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? '';
		return {
			family: read('font-family').replace(/^['"]|['"]$/g, ''),
			file: /url\(\s*['"]?\.\/fonts\/([^'")]+)['"]?\s*\)/.exec(read('src'))?.[1] ?? '',
			weight: Number(read('font-weight')),
			style: read('font-style')
		};
	});
}

const NAMED_WEIGHT: Record<string, number> = {
	Regular: 400,
	Italic: 400,
	Medium: 500,
	SemiBold: 600,
	Bold: 700
};

/** what a shipped file's own name says it is: `RedHatText-SemiBold.woff2` is Red Hat Text at 600. */
function faceNamedBy(file: string): Omit<Face, 'file'> {
	const [, family = '', style = ''] = /^RedHat([A-Za-z]+)-([A-Za-z]+)\.woff2$/.exec(file) ?? [];
	return {
		family: `Red Hat ${family}`,
		weight: NAMED_WEIGHT[style] ?? Number.NaN,
		style: style === 'Italic' ? 'italic' : 'normal'
	};
}

const faces = facesOf(readFileSync(SHEET, 'utf8'));
const shipped = readdirSync(DIR).filter((name) => name.endsWith('.woff2'));

describe('the face sheet and the files beside it', () => {
	it('reads blocks from the sheet in the shape facesOf reads', () => {
		expect(
			facesOf(
				`/* @font-face { font-family: 'Gone'; } */
				@layer tokens { @font-face {
					font-family: "Red Hat Mono";
					src: url('./fonts/RedHatMono-Medium.woff2') format('woff2');
					font-weight: 500;
					font-style: normal;
				} }`
			)
		).toEqual([
			{ family: 'Red Hat Mono', file: 'RedHatMono-Medium.woff2', weight: 500, style: 'normal' }
		]);
	});

	it('declares the three Red Hat families and no other', () => {
		expect([...new Set(faces.map((face) => face.family))].sort()).toEqual([
			'Red Hat Display',
			'Red Hat Mono',
			'Red Hat Text'
		]);
	});

	it('names a file that is in fonts/ for every block', () => {
		const missing = faces.filter((face) => !existsSync(new URL(face.file, DIR)));
		expect(faces.length).toBeGreaterThan(0);
		expect(missing.map((face) => face.file || '(no ./fonts/ url)')).toEqual([]);
	});

	it('has a block for every woff2 in fonts/', () => {
		expect(shipped.length).toBeGreaterThan(0);
		expect(shipped.filter((name) => !faces.some((face) => face.file === name))).toEqual([]);
	});

	it('names each file once', () => {
		const files = faces.map((face) => face.file);
		expect(files.filter((file, at) => files.indexOf(file) !== at)).toEqual([]);
	});

	it('declares each block at the family, weight and style its file is named for', () => {
		const wrong = faces
			.filter((face) => {
				const named = faceNamedBy(face.file);
				return (
					named.family !== face.family || named.weight !== face.weight || named.style !== face.style
				);
			})
			.map((face) => `${face.file}: ${face.family} ${face.weight} ${face.style}`);
		expect(wrong).toEqual([]);
	});

	it('carries the licence beside the binaries', () => {
		expect(existsSync(new URL('OFL.txt', DIR))).toBe(true);
	});
});
