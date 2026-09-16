import { Press } from '@better-giving/operator/components/data/Press';

/*
 * the press at the foot of a record card, in both readings and every state a pointer reaches.
 *
 * the literal is the default and is the common one: a site a form is served on, pressed to open
 * the embed card aimed at that site. it is drawn as the default button here, and the code face and
 * the ground under it are `.adm-chip`'s — what is pressed is still the literal.
 *
 * the words reading is the other, and the arrow rides with it rather than standing as a prop of its
 * own: a press said in words is a destination, and the arrow is what says the destination is a page.
 * the two are drawn side by side here because the pair is the whole of the distinction — one is in
 * the mono face at the code size and the other in the document's at the caption size, and a reader
 * who cannot tell them apart at a glance is a reader for whom the modifier does nothing.
 *
 * `as` is stated on the words specimen and never defaulted there, because a press that navigates
 * inside a mounted screen takes that screen's router link. the gallery has no router, so the
 * specimen is the plain tag — which is exactly the case `as` exists for, and drawing it as an anchor
 * here is what shows the link and the button are one drawing.
 *
 * hover and focus are pinned rather than reached, which is the whole of what `state` is for: a
 * pointer cannot be put on an element by a page. focus is the state worth looking hardest at — a
 * link and a button take different treatments from packages/operator/src/styles/base.css, and
 * `.adm-press` restates the ring so the two land in the same place.
 *
 * a literal long enough to wrap is here because an origin is an operator's own host and can be
 * longer than the card: `.adm-chip` breaks at any glyph, and what that does to a press is only
 * visible with one in it.
 *
 * every specimen stands in a `<ul>` because this part is the `<li>`. a press outside a list is
 * markup no screen draws, and a specimen of one would be a specimen of nothing.
 */
export default function DataPressPreview() {
	return (
		<div className="adm-stack">
			<ul className="adm-record__origins adm-record__foot">
				<Press>riverside-shelter.org</Press>
				<Press as="a" href="#form-page" words>
					form page
				</Press>
			</ul>
			<ul className="adm-record__origins adm-record__foot">
				<Press state="hover">riverside-shelter.org</Press>
				<Press as="a" href="#form-page-hover" words state="hover">
					form page
				</Press>
			</ul>
			<ul className="adm-record__origins adm-record__foot">
				<Press state="focus">riverside-shelter.org</Press>
				<Press as="a" href="#form-page-focus" words state="focus">
					form page
				</Press>
			</ul>
			<ul className="adm-record__origins adm-record__foot">
				<Press>donate.riverside-shelter-and-community-kitchen.example.org.uk</Press>
			</ul>
		</div>
	);
}
