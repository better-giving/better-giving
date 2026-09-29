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
 *
 * the fourth is the control given `wording`, for a row of presses with nothing on its line saying
 * what it copies — the API page's agent prompt. the words are drawn after the mark and are the
 * whole of its name at rest; pressed, it reports with the tick alone, as the other three do, drawn
 * over its words held in place so the control keeps its width. `onBlocked` is the page's answer to
 * a refusal — the API page links the served prompt — and `wayOut` is what the refusal says of that
 * link. a refusal cannot be staged here, so the specimen answers nothing.
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
			<CopyControl
				wording="Copy agent prompt"
				text="You are integrating with the Riverside Shelter donations API. Read the reference first."
				wayOut="Open agent prompt, after this button, opens it to copy by hand."
				onBlocked={() => {}}
			/>
		</>
	);
}
