// the few glyphs the card draws, each an inline svg in `currentColor`, so a glyph takes the ink of the
// control it stands in and a host's `::part()` colour reaches it with the words around it.

const SVG = 'http://www.w3.org/2000/svg';

/**
 * lucide's `chevron-down`, `search`, `check`, `copy`, `circle-alert`, `circle-help`, `arrow-right`,
 * `mail` and `link` (https://lucide.dev, ISC), each drawn in `currentColor` at its source's own
 * stroke. a circle or a rect is written as the path it describes.
 *
 * exported as data as well as through `glyph` below: the deployment's donor page draws its blocks
 * in react, on the server, where there is no document to build a node in, and it takes its marks
 * from this one set rather than drawing its own.
 */
export const GLYPHS = {
	chevron: ['m6 9 6 6 6-6'],
	search: ['m21 21-4.34-4.34', 'M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0'],
	tick: ['M20 6 9 17l-5-5'],
	copy: [
		'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
		'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
	],
	alert: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'M12 8v4', 'M12 16h.01'],
	// the question the mark on the network row answers, which is not the danger mark: the caution it
	// opens is there to be read, and the danger mark on a row nothing has gone wrong on reads as a
	// failure already on the card.
	help: [
		'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
		'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3',
		'M12 17h.01'
	],
	// the last three are the donor page's (the share buttons and the ended campaign's link); the
	// card draws none of them.
	'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
	mail: [
		'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
		'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'
	],
	link: [
		'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
		'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
	]
} as const;

export type GlyphName = keyof typeof GLYPHS;

export function glyph(doc: Document, name: GlyphName, className: string): SVGElement {
	const svg = doc.createElementNS(SVG, 'svg');
	svg.setAttribute('class', className);
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	for (const d of GLYPHS[name]) {
		const path = doc.createElementNS(SVG, 'path');
		path.setAttribute('d', d);
		svg.appendChild(path);
	}
	return svg;
}
