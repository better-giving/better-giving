import { CopyControl } from '@better-giving/operator/components/controls/CopyControl';

/*
 * the copy control at rest, which is the only one of its three states a prop reaches: `copied` and
 * `blocked` are set inside the component from what the clipboard did, so pressing it here is how
 * you see the tick, and `blocked` needs a refused permission or an insecure origin and cannot be
 * staged from this page at all.
 *
 * what is worth the line is the second specimen. at rest the control is a mark and no words, so
 * two of them on one screen are indistinguishable to anyone not reading what they sit beside —
 * `label` is the whole of what tells them apart to a screen reader, and it is never drawn.
 *
 * the third is the control off its own row: packages/operator/src/styles/adm.css draws it as a
 * quiet button at the small height because it stands in a slab's label row, and standing alone it
 * is a bare mark with nothing around it.
 */
export default function ControlsCopyControlPreview() {
	return (
		<>
			<CopyControl text="pnpm run deploy" />
			<CopyControl
				label="Copy the webhook signing secret"
				text="whsec_9Ld2rQx4TfKp7VnB3sJwZmYc6HgA1eUo"
			/>
			<CopyControl text="https://give.riverside-shelter.org/embed.js" />
		</>
	);
}
