import { GLYPHS, type GlyphName } from '@better-giving/form/glyph';

// a mark from the donation form's own set, drawn as react so the server render carries it. it
// stands beside words that name what it means, so it is hidden from a screen reader.

export function Glyph({
	name,
	className
}: {
	readonly name: GlyphName;
	readonly className: string;
}) {
	return (
		<svg
			className={className}
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
