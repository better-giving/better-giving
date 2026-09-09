import { ADMIN_USERNAME, MIN_ADMIN_PASSWORD_LENGTH } from '@better-giving/operator/admin-password';
import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { Said } from './said';
import { heldValues } from './held-values';
import type { GroupReport } from './secret-group-form';
import { SecretGroupForm } from './secret-group-form';
import { MINTED_BY_CONSOLE, SECRET_GROUPS, SIGN_IN_GROUP, groupIntent } from './secret-groups';
import { secretTrouble } from './secret-trouble';
import { FREE_INTENT } from './withheld-values';
import type { AddressRead, DeployedValues, VarsWritten } from '../api/types';

/**
 * how the operator who set the deployment up reaches /admin: the credential that opens the
 * dashboard for them, changed in the first fold of the page. colleagues are invited from the
 * dashboard's own members screen and set their own password there; this fold names none of them.
 *
 * **it opens the ledger and is not one of the five jobs under it.** those five are what a gift
 * needs, in the order they have to be true (./home-sections.ts holds the reading); this is how the
 * operator gets into the dashboard at all and answers to nothing in that run. so it stands in front
 * of the run rather than at a position inside it, where it would read as a step towards a donation.
 *
 * **the boxes stand open the moment the fold does.** the fold holds this one act and nothing beside
 * it — no rows and no note — so a shut group would leave whoever opened the fold looking at a single
 * button that opens the thing they came for. `startOpen` is what says so, and ./secret-group-form.tsx
 * argues the closed state it turns off.
 *
 * **the pair is one group because the two are one subject, and neither name is stated here.** the
 * password is what a staff member types and `BETTER_AUTH_SECRET` is what signs the session they get
 * back — both are this console's own machinery rather than anything an operator chose, and the
 * second is minted by `packages/console/internal/first` and cannot be written from this fold at all. so
 * `rows` is off and `generated` leaves the minted one no box: what the fold holds is the one act,
 * and nothing to read.
 *
 * **the one box is named after the password rather than after the slot it is stored in, and the
 * word it uses is dashboard.** `boxLabel` is what carries that, and it has to stand without the
 * fold's own label over it because a screen reader reaches a box on its own. dashboard is what this
 * console calls the one page on the deployment a human signs in to, and the path it is served at is
 * not what an operator is changing here.
 *
 * **the username and the minimum are over the box and not only in what a refusal says.** the
 * sign-in screen asks for a username and never says what the deployer's is, so the hint names
 * `ADMIN_USERNAME` first; the one rule the deployment states about the value is a length, and
 * `boxHint` in ./secret-group-form.tsx is what puts both there. `readAdminPassword` in
 * packages/operator/src/admin-password.ts holds the rule and argues why it is stated in both
 * places.
 *
 * **the box holds the stored password.** every value a deployment is configured with is a plain var
 * and reads back off the account (`DEPLOY_VARS` in packages/operator/src/deploy-split.ts), and this
 * one is drawn like the rest: the console opens only to the holder of the cloudflare account that
 * holds it, so a box that withheld it from them would protect nobody and cost them the one thing
 * they opened the fold to do. the rule against echoing a password back is the dashboard's own form
 * rule and is about a screen a donor's browser can reach (CLAUDE.md → Forms).
 *
 * **the box cannot be emptied, which is the one place this form differs from every other group's.**
 * emptying a box is how a value is taken off a deployment everywhere else on this console; here it
 * would leave staff sign-in refused outright (`readStaffCredential` in
 * `packages/app/src/lib/server/auth/credential.ts`) with this same box as the only way back. so the
 * press is refused at the box the way a short password is, and no confirm is drawn for a gesture
 * nobody makes on purpose — `irremovable` in ./secret-edits.ts holds it.
 */
export type PasswordFoldProps = {
	values: DeployedValues;
	secrets: GroupReport | null;
	/** how the last press that frees a value held in a form nothing can read back went, or `null`. */
	freed: VarsWritten | null;
	workerName: string;
	accountName: string;
	/** something else on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
	/**
	 * the router is re-reading the page over the answer to that press, which is what keeps this
	 * fold's one box open while a refusal stands in it (./secret-group-form.tsx).
	 */
	revalidating: boolean;
};

export function PasswordFold({
	values,
	secrets,
	freed,
	workerName,
	accountName,
	busy,
	pending,
	revalidating
}: PasswordFoldProps) {
	/* the race every other press on this page meets, met by this one: the Worker answered this
	   console a moment ago and is not in the account now. the way out is the page read again, which
	   draws the state it is actually in. */
	const nowhere = (address: AddressRead) =>
		address.kind === 'not-deployed' ? (
			<FieldMessage>
				No Worker called {workerName} is in {accountName} any more, so there was nowhere to store
				this. Nothing was stored. Reload this page.
			</FieldMessage>
		) : address.kind === 'deployed' ? (
			<FieldMessage>
				This deployment answers on no address at all, so there's nowhere to reach it. Turn its{' '}
				<InlineCode>workers.dev</InlineCode> address back on, or attach a domain, then try again.
			</FieldMessage>
		) : (
			<>
				<FieldMessage>
					Nothing was stored, because this console could not find out where this deployment answers.
				</FieldMessage>
				<Said answer={address} />
			</>
		);

	const held = heldValues(values.vars.kind === 'read' ? values.vars.vars : []);

	/* a list of one, mapped rather than found: an id that stops matching draws no boxes rather than
	   throwing at an operator who came to read the rows. it is ./smtp-fold.tsx's idiom. */
	return (
		<>
			{SECRET_GROUPS.filter((group) => group.id === SIGN_IN_GROUP).map((group) => (
				<SecretGroupForm
					key={group.id}
					group={group}
					values={held}
					report={secrets?.group === group.id ? secrets : null}
					busy={busy}
					pending={pending === groupIntent(group)}
					revalidating={revalidating}
					trouble={secretTrouble({ workerName, accountName, nowhere })}
					rows={false}
					boxLabel={() => 'Dashboard password'}
					boxHint={() => (
						<>
							Signs in as <InlineCode>{ADMIN_USERNAME}</InlineCode>. At least{' '}
							{MIN_ADMIN_PASSWORD_LENGTH} characters.
						</>
					)}
					generated={MINTED_BY_CONSOLE}
					withheldSays="Nobody can sign in to /admin until you set a new password here."
					withheldWritten={freed}
					freeing={pending === FREE_INTENT}
					startOpen
					consequence={
						<p className="adm-prose">
							Storing this replaces the dashboard password at once, so a staff member without the
							new one cannot sign in until you give it to them.
						</p>
					}
				/>
			))}
		</>
	);
}
