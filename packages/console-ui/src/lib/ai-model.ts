import { AI_MODELS, DEFAULT_MODEL, modelById } from '@better-giving/operator/ai-models';
import type { DeployVarName, DeployedVar, ModelCredits, VarsWritten } from '../api/types';

// the model the donation page's chat answers from, as this console offers and stores it.

/** the one value this page writes, through the vars press every other value goes through. */
export const MODEL_VAR: DeployVarName = 'AI_MODEL';

/** what the press posts as its intent, and what its outcome is reported against. */
export const MODEL_INTENT = 'ai-model';

/** the radios' shared name, which is what the press reads the choice off. */
export const MODEL_FIELD = 'ai-model';

/** what the page and its rail cell are called. */
export const MODEL_TITLE = 'AI model';

/** where the page is. */
export const MODEL_PAGE = '/ai-model';

/**
 * the id the choice is drawn holding, or `null` where no choice on the list is what the deployment
 * answers with.
 *
 * nothing stored is the default model, which is what the deployment calls then. an id off the list is
 * a refusal on every request that reaches a model rather than a fallback to the default one
 * (packages/operator/src/ai-models.ts), and a value held as a secret cannot be read back, so both
 * draw no choice taken rather than one the deployment is not answering with.
 */
export function chosenModel(row: DeployedVar): string | null {
	if (row.kind === 'absent') return DEFAULT_MODEL.id;
	if (row.kind === 'withheld') return null;
	return modelById(row.value)?.id ?? null;
}

/**
 * what one press puts on the deployment, or `null` where the body names no model on the list.
 *
 * composed from the list and never from the body, so an id off it — which the door refuses with a
 * 400 (`POST /api/values/vars` in packages/console/internal/server/values.go) — cannot be carried
 * whatever the body claimed. the default model is the name taken off rather than stored, because an
 * unset one is what the deployment answers the default model for, and `null` is what deletes a name.
 */
export function modelEdit(posted: FormData): Record<string, string | null> | null {
	const value = posted.get(MODEL_FIELD);
	const model = typeof value === 'string' ? modelById(value) : undefined;
	if (model === undefined) return null;
	return { [MODEL_VAR]: model.id === DEFAULT_MODEL.id ? null : model.id };
}

/**
 * what a press of the save is answered by at the press where it stored nothing and nothing failed,
 * or `null`.
 *
 * a landed write is the button's own tick and a failure is the trouble drawn under it
 * (`refusalIn` in ./secret-trouble.tsx), so what is left is a press answered by nothing moving,
 * which an operator makes again unless something says why. a value held as a secret turned the
 * press down, so it is said as a refusal, and its way out is the block above the press
 * (./withheld-values.tsx); the one name this press writes is the only one that answer can carry. a
 * choice already stored is a status and no refusal. `nothing` is an edit naming no value, which
 * {@link modelEdit} never composes.
 */
export function pressSays(
	written: VarsWritten | null
): { tone: 'refused' | 'status'; sentence: string } | null {
	if (written?.kind === 'unchanged') {
		return { tone: 'status', sentence: 'That model was already saved.' };
	}
	if (written?.kind === 'withheld') {
		return {
			tone: 'refused',
			sentence: `This deployment holds ${MODEL_VAR} in a form nothing can read back, so this console can’t change it. Remove it above, then save a model again.`
		};
	}
	return null;
}

/**
 * whether the save's answer leaves the choice to be put back onto the reading after it.
 *
 * `unchanged` does as well as `set`: the choice ticked is already what is stored, and left ticked
 * the same press stays armed to do the same nothing.
 */
export const settles = (written: VarsWritten | null): boolean =>
	written?.kind === 'set' || written?.kind === 'unchanged';

/**
 * where this page's save stands, and whether the choices are closed with it.
 *
 * **a press is two router phases and the answer lands between them** (./stripe-press.ts), so the
 * posted intent is true for the whole of the re-read the press sets off, which is the home reading,
 * the choice and the credits — seconds. a press that stored nothing reopens on the render its
 * answer lands in: the re-read can change nothing it left, and `Saving` over its own sentence reads
 * as a press still going.
 *
 * **a press that settled stays underway until the choice is put back** onto the reading it left
 * behind (./reseed.ts), which `spent` says. the radios are uncontrolled, so one put back any
 * earlier ticks the choice the press was made against.
 *
 * `busy` is the page's one flag for "something on this screen is writing" and is true of this
 * press as well, so what is taken from it is the rest of the page.
 */
export function modelPhase(press: {
	/** this page's save is the press in flight, both phases of it. */
	readonly own: boolean;
	/** the router has the answer and is reading the page again over it. */
	readonly revalidating: boolean;
	/** a press anywhere on the page is in flight. */
	readonly busy: boolean;
	/** the save's standing answer leaves the choice to be put back ({@link settles}). */
	readonly settled: boolean;
	/** the reading after that answer is on the screen, and the choice has been put back. */
	readonly spent: boolean;
}): { readonly underway: boolean; readonly closed: boolean } {
	const underway = (press.own && !press.revalidating) || (press.settled && !press.spent);
	return { underway, closed: underway || (press.busy && !press.own) };
}

/** one choice as the page draws it: the default one says so under its name, the rest what they spend. */
export type ModelOption = {
	id: string;
	label: string;
	sub: 'Default' | null;
	note: 'Needs Cloudflare credits' | null;
};

/** every model on the list, in its order, which is the default one first. */
export const modelOptions = (): ModelOption[] =>
	AI_MODELS.map((model) => ({
		id: model.id,
		label: model.label,
		sub: model.creditBilled ? null : 'Default',
		note: model.creditBilled ? 'Needs Cloudflare credits' : null
	}));

/** what the account's credits say beside the choice, as {@link creditsLine} reads them. */
export type CreditsLine =
	| { kind: 'held'; figure: string }
	| { kind: 'missing' }
	| { kind: 'unknown'; detail: string };

/**
 * the binary's fixed sentence for the browser sign-in, which never asks for the balance —
 * `CreditsUnreadOnSignIn` in packages/console/internal/deployment/aimodel.go, held equal to it by
 * ./ai-model.spec.ts.
 */
export const CREDITS_UNREAD_ON_SIGN_IN =
	"This console's Cloudflare sign-in cannot read the account's credits. If they run out, the chat answers from the default model and says so.";

const DOLLARS = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const NO_CENTS = DOLLARS.format(0);
const ONE_CENT = DOLLARS.format(0.01);

/**
 * what the account's credits say beside the choice the deployment holds, or `null` where it spends
 * none.
 *
 * the balance is AI Gateway's, in dollars. at or under zero it can be a debt, so it is reported as
 * no credits with no figure; above zero it is held however little, so one that rounds to no cents
 * is stated as under one. a balance not read on the browser sign-in is the binary's fixed sentence,
 * carried as given. anywhere else the detail is cloudflare's own words, which name no subject and
 * stand beside the save, so they are framed as a sentence about the balance.
 */
export function creditsLine(credits: ModelCredits): CreditsLine | null {
	switch (credits.kind) {
		case 'not-asked':
			return null;
		case 'held': {
			const figure = DOLLARS.format(credits.balance);
			return { kind: 'held', figure: figure === NO_CENTS ? `less than ${ONE_CENT}` : figure };
		}
		case 'missing':
			return { kind: 'missing' };
		case 'unknown':
			return {
				kind: 'unknown',
				detail:
					credits.detail === CREDITS_UNREAD_ON_SIGN_IN
						? credits.detail
						: `The credit balance could not be read: ${ended(credits.detail)}`
			};
	}
}

/** a sentence closed once, whether or not the words it carries already close themselves. */
const ended = (words: string): string => (/[.!?]$/.test(words) ? words : `${words}.`);
