import type { DeployVarName, DeployedVar } from '../api/types';
import type { SecretGroup } from './secret-groups';

// what the deployment is holding, in the one shape every fold on the page reads it in.
//
// **every name in the enumeration is a plain var, so the account hands its value back**
// (`DEPLOY_VARS` in packages/operator/src/deploy-split.ts). that is what lets a box be seeded with
// the value itself rather than with a stand-in, and it is why one derivation serves the boxes, the
// rows and the press: what a box was drawn with and what the press reads it against have to be the
// same value, and five folds deriving it apart is five chances for one of them to disagree.
//
// **a withheld name is held and has no seed, and those are two different facts.** it is a binding
// under one of those names that is not plain text — a deployment that stored the value as a
// secret — so the value is there and the deployment reads it, and nothing can hand it back.
// its box is drawn empty and its row still reads as set; ./withheld-values.tsx is the press that
// frees it.

/** what the deployment holds, read out of one answer. */
export type HeldValues = {
	/** what each box is drawn holding, and `''` where there is nothing to draw. */
	readonly seeds: Readonly<Record<string, string>>;
	/** the names the deployment holds a value under, whether or not one can be read back. */
	readonly held: ReadonlySet<string>;
	/** the names it holds in a form nothing can read back, in the enumeration's own order. */
	readonly withheld: readonly DeployVarName[];
};

export function heldValues(vars: readonly DeployedVar[]): HeldValues {
	const seeds: Record<string, string> = {};
	const held = new Set<string>();
	const withheld: DeployVarName[] = [];

	for (const row of vars) {
		seeds[row.name] = row.kind === 'value' ? row.value : '';
		if (row.kind === 'absent') continue;
		held.add(row.name);
		if (row.kind === 'withheld') withheld.push(row.name);
	}

	return { seeds, held, withheld };
}

/**
 * what one box opens holding: what the deployment stores under that name, or the fold's seed where
 * it stores nothing at all.
 *
 * **a stored value always wins, so re-opening a box never swaps what is held for a suggestion.**
 * the reading is `held` rather than the seed being empty, which is the one that tells a name the
 * deployment stores nothing under from a name it holds in a form nothing can read back — the
 * second draws an empty box and takes no seed, because what is stored there may be nothing like
 * the fold's suggestion and the operator cannot see that it was replaced.
 *
 * the caller states the seed, because a seed is what a name means on a real deployment and nothing
 * here knows what the names mean. ./quickbooks-section.tsx is the one screen with one to state, and
 * `quickbooksSeed` in ./quickbooks-standing.ts is it.
 */
export const boxValue = (
	values: HeldValues,
	name: string,
	seed?: (name: string) => string | undefined
): string => (values.held.has(name) ? (values.seeds[name] ?? '') : (seed?.(name) ?? ''));

/**
 * the names of `among` this deployment is holding in a form nothing can read back.
 *
 * a fold says it of the names its own press writes and of no others, because the sentence stands
 * beside the boxes it is about — the press behind it frees every one of them at once whatever the
 * fold named (`FreeWithheldVars` in `packages/console/internal/deployment/write.go`), and the card
 * it puts up itemises that (./withheld-values.tsx).
 */
export const withheldAmong = (
	values: HeldValues,
	among: readonly string[]
): readonly DeployVarName[] => values.withheld.filter((name) => among.includes(name));

/**
 * the names of `group` this deployment is holding in a form nothing can read back, which is what
 * the fold drawing that group says so of.
 *
 * **it is the group's whole list and never the names its press types.** a name in this state has no
 * box to be typed out of whether or not it would have had one, and two of the names are minted
 * rather than typed — the session signing secret and the spam widget's key — so a block scoped to
 * the boxes leaves each of those named nowhere on the page, in a state no press it draws can end.
 * ./held-values.spec.ts holds the property, one group per name.
 */
export const withheldInGroup = (values: HeldValues, group: SecretGroup): readonly DeployVarName[] =>
	withheldAmong(values, group.names);
