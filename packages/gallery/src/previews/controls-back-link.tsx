import { BackLink } from '@better-giving/operator/components/controls/BackLink';

/*
 * every state BackLink offers: the resting link, the two pointer states pinned by class rather
 * than triggered (PointerState in packages/operator/src/components/closed-sets.js), a label long
 * enough to wrap past the arrow, and `href` left off, which is the component's own '#' default.
 *
 * the two are the whole of what a back link draws: packages/operator/src/styles/adm.css gives
 * `.adm-back` a hover twin and packages/operator/src/styles/base.css gives it a focus twin, and a
 * link is not a control that can be pressed shut or taken away.
 *
 * one per row rather than flowed inline: a back link is an arrow followed by a run of words, and
 * two of them on one line read as one link with a stray arrow after it. each row is a plain block
 * around the link rather than the link itself, because the focused treatment in
 * packages/operator/src/styles/base.css is a tint bled past the link's own box — placed straight
 * into the stack the link is blockified, and the tint runs the width of the page.
 */
export default function ControlsBackLinkPreview() {
	return (
		<div className="adm-stack">
			<div>
				<BackLink href="#">Back to donation forms</BackLink>
			</div>
			<div>
				<BackLink href="#" state="hover">
					hover
				</BackLink>
			</div>
			<div>
				<BackLink href="#" state="focus">
					focus
				</BackLink>
			</div>
			<div>
				<BackLink>href absent</BackLink>
			</div>
			<div>
				<BackLink href="#">
					Back to the recurring gift from Margarethe Van Der Aalst-Whitmore
				</BackLink>
			</div>
		</div>
	);
}
