import type { OrgProfileField } from '@better-giving/operator/console/org';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { ReactNode } from 'react';
import { CONNECT_ELSEWHERE, WhyNot } from './deployment-states';
import { ORG_FIELDS, boxFold } from './org-fields';
import { listed } from './org-form';
import type { OrgWrite } from '../api/types';

// what a press that stored the organisation's profile ended as, drawn under the button that made
// it.
//
// **it is one module because the profile is one row and two folds edit it.** ./org-fold.tsx holds
// the identity and ./notifications-fold.tsx where the deployment reaches the operator, and the
// deployment reads the profile whole — so either press can be refused over a box the other fold
// draws, and both meet the same five states of the same write (`OrgWrite` in ../api/types.ts). two
// copies
// of these sentences is how two folds come to explain one refusal differently.
//
// **where to go is read off the refusal and not off the fold that was pressed.** two folds draw the
// one profile, so a press can be turned down over boxes the other one draws — the row to open is
// whichever one draws the box that was named (`boxFold` in ./org-fields.ts), which is a reading no
// caller is in a position to make and none is asked to.

/** the fields one fold draws a box for, which is what decides where a refusal landed. */
export type OrgWriteOutcomeProps = {
	/** how the last press in this fold went, or `null` where none has been made. */
	write: OrgWrite | null;
	drawn: readonly OrgProfileField[];
};

export function OrgWriteOutcome({ write, drawn }: OrgWriteOutcomeProps): ReactNode {
	if (write === null || write.kind === 'saved') return null;
	if (write.kind === 'unwritten') {
		return <WhyNot answer={write.read} what="nothing was saved" where={CONNECT_ELSEWHERE} />;
	}

	const keys = Object.keys(write.errors) as OrgProfileField[];
	const marked = keys.filter((field) => drawn.includes(field)).length;
	// a box the console draws and this fold does not: the profile is one row, so a press made here
	// is refused by the other fold's blanks too. counted separately from `unread`, which is a key
	// this console draws no box for anywhere.
	const away = keys.filter((field) => !drawn.includes(field));
	/** the rows those boxes are on, which is what the way out names. */
	const rows = [...new Set(away.map(boxFold))];

	return (
		<>
			{/* no sentence of its own under the button: a marked box already says the press was
			    refused, and the profile being stored whole is what the paragraph below says where it
			    matters — a refusal over boxes this fold does not draw. */}
			{away.length > 0 ? (
				// the way out, and it names rows rather than describing them: the profile is stored whole,
				// so this press cannot land while a box on another row is the one being turned down.
				<p className="adm-prose">
					Refused under {listed(rows)}: {listed(away.map((field) => ORG_FIELDS[field].label))}. The
					profile is stored whole, so open {rows.length === 1 ? 'that fold' : 'those folds'} and
					save from there first.
				</p>
			) : null}
			{marked === 0 && away.length === 0 && write.message !== null ? (
				// the deployment's own account of what it turned down, drawn where nothing on the page
				// carries a sentence. beside marked boxes it is those same sentences a second time and
				// names each field as a column, which is a vocabulary no screen here uses (CLAUDE.md);
				// where nothing was marked it is the only account of the refusal there is.
				<p className="adm-prose">
					<MarkedText text={write.message} />
				</p>
			) : null}
			{write.unread > 0 ? (
				// counted rather than dropped: a refusal with nothing on screen to show for it is a save
				// that failed silently. a deployment newer than this console is the ordinary way it
				// happens.
				<p className="adm-hint">
					{/* `more` only where something else was named: it is the whole of what says these are
					    beside the ones above rather than instead of them. */}
					{write.unread} {marked === 0 && away.length === 0 ? '' : 'more '}
					{write.unread === 1 ? 'field was' : 'fields were'} named that this console draws no box
					for. Your deployment is probably newer than this console. Update this copy and deploy it
					again.
				</p>
			) : null}
			{/* the refusal's `fix` is carried and never drawn. a 4xx body from the deployment is
			    written for the agent reading it (CLAUDE.md), so that sentence names the `errors`
			    key of the body it came in — a thing no operator has on their screen. what to do
			    about the refusal is at the boxes it named and in the sentence above; a second way
			    out addressed to somebody else is one more thing to read and nothing to act on. */}
		</>
	);
}
