import { MARK_NAMES, Mark } from '@better-giving/operator/components/status/Mark';

/*
 * every glyph the operator surfaces have, at both sizes.
 *
 * the set is read off `MARK_NAMES` rather than listed, so a glyph added to
 * packages/operator/src/components/status/glyphs.js appears here without this file changing. a
 * hand-written list is the half that gets forgotten, and a mark nobody can see is a mark the next
 * screen imports a second time from lucide rather than finds here.
 *
 * both sizes for all of them, not just for the banner's. `lg` is documented as the banner's mark
 * and the only second size the sheets draw, and drawing every glyph at it is what shows which ones
 * hold up scaled — lucide draws every one of these at a stroke of 2 in a 24 viewBox, so the weight
 * grows with the box and a glyph carrying more detail thickens up faster than a plain one.
 *
 * the labelled and unlabelled shapes are two different elements and not one with an attribute
 * toggled: with a label the mark is `role="img"` carrying that name, and without one it is out of
 * the accessibility tree entirely. nothing on the screen tells them apart, which is exactly why
 * both are drawn — the row of names below each grid is this page's own text and not the mark's.
 *
 * there is no state here for a name with no glyph behind it, and there is none to draw: `name` is
 * typed to the keys of packages/operator/src/components/status/glyphs.js and the value it reaches
 * is a component, so an unknown name is a type error rather than an empty box.
 *
 * `style` and `className` are pass-throughs a screen uses to place a mark inside something else,
 * and both are exercised where they matter — inside a setting row and a status line, in
 * src/previews/data-setting-row.tsx and src/previews/status-status-line.tsx — rather than here,
 * where a mark on its own has nothing to sit against.
 */
export default function StatusMarkPreview() {
	return (
		<div className="adm-stack">
			<div className="adm-stack adm-stack--tight">
				{MARK_NAMES.map((name) => (
					<p key={name}>
						<Mark name={name} /> <Mark name={name} size="lg" /> {name}
					</p>
				))}
			</div>
			<p>
				<Mark name="circle-check" label="Done" /> A labelled mark, which is an image carrying that
				name.
			</p>
			<p>
				<Mark name="circle-check" /> The same mark unlabelled, which is out of the accessibility
				tree.
			</p>
			<p>
				<Mark name="triangle-alert" size="lg" label="Attention" /> A labelled mark at the banner
				size.
			</p>
			<p>
				<Mark name="info" /> A mark beside a sentence long enough to wrap onto a second and a third
				line, which is what says whether the mark sits on the first line of the text or in the
				middle of the block — the rule that decides it belongs to whatever the mark is standing
				inside, and here it is standing in a bare paragraph with no rule of its own.
			</p>
		</div>
	);
}
