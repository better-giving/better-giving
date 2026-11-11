import { GLYPHS as FORM_GLYPHS } from '@better-giving/form/glyph';

// the marks the supporter's screens draw, beside words that name what each means, so every one is
// out of the accessibility tree. the donor page takes its marks from the form's set
// (packages/form/src/glyph.ts) and so do these where that set has the mark; the rest are lucide's
// `log-out`, `external-link`, `pencil`, `plus`, `trash-2`, `image-up`, `triangle-alert`, `info`,
// `circle-check` and `arrow-left` (https://lucide.dev, ISC), which the form's set does not carry —
// that set is the element's public contract, and widening it is not this screen's call.

const OWN_GLYPHS = {
	'log-out': ['m16 17 5-5-5-5', 'M21 12H9', 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'],
	'external-link': [
		'M15 3h6v6',
		'M10 14 21 3',
		'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'
	],
	pencil: [
		'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
		'm15 5 4 4'
	],
	plus: ['M5 12h14', 'M12 5v14'],
	trash: [
		'M10 11v6',
		'M14 11v6',
		'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
		'M3 6h18',
		'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'
	],
	'image-up': [
		'M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21',
		'm14 19.5 3-3 3 3',
		'M17 22v-5.5',
		'M7 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'
	],
	warning: [
		'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
		'M12 9v4',
		'M12 17h.01'
	],
	info: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'M12 16v-4', 'M12 8h.01'],
	done: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'm9 12 2 2 4-4'],
	back: ['m12 19-7-7 7-7', 'M19 12H5']
} as const;

const GLYPHS = { ...FORM_GLYPHS, ...OWN_GLYPHS };

export type MarkName = keyof typeof GLYPHS;

export function Mark({ name }: { readonly name: MarkName }) {
	return (
		<svg
			className="sa-mark"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{GLYPHS[name].map((d) => (
				<path key={d} d={d} />
			))}
		</svg>
	);
}
