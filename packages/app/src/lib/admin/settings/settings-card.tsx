import type { SettingsSaveState } from '@better-giving/operator/components/shell/SettingsLayout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { SaveState } from '@better-giving/operator/save-state.react';
import { useEffect, useState } from 'react';
import { useNavigation } from 'react-router';
import { WHICH_FORM } from '$lib/forms/definition';
import { buttonState } from '../save-button-state';
import { type Box, boxProps } from '../use-admin-form';

// what the three Settings sections share: their crumb, the sentences a refused save is told, and
// the parts of a card's form (../../../routes/_app.admin.settings_.organisation.tsx and the two
// beside it).

/** the trail above each section: Settings, which lands on the first, then the section. */
export const settingsCrumbs = (pathname: string, label: string) =>
	[
		{ href: '/admin/settings', label: 'Settings' },
		{ href: pathname, label }
	] as const;

/** what a save from a page drawn before another save of the profile is told. */
export const STALE_SAVE =
	'The organisation’s details changed since this page was opened. Reload it and save again.';

/** what a save the database refused is told. nothing an operator types changes that. */
export const WRITE_FAILED = 'Saving this failed and nothing was changed. Try again.';

/** how long Saved stands before the row goes back to pristine (settings-layout-css). */
const SAVED_HOLD_MS = 2000;

const SAVE_ROW: Record<ReturnType<typeof buttonState>, SettingsSaveState> = {
	pending: 'saving',
	done: 'saved',
	disabled: 'pristine',
	idle: 'dirty'
};

/**
 * the state a card's `SettingsSave` draws, from the group's shared save state. the registry holds
 * Saved for two seconds, which ends before the shared state's own confirmation does
 * (packages/operator/src/save-state.ts), so the row goes back to pristine on its own clock.
 */
export function useSettingsSave(save: SaveState): SettingsSaveState {
	const state = SAVE_ROW[buttonState(save)];
	const [expired, setExpired] = useState(false);
	const [was, setWas] = useState(state);
	if (was !== state) {
		setWas(state);
		setExpired(false);
	}
	useEffect(() => {
		if (state !== 'saved') return;
		const held = setTimeout(() => setExpired(true), SAVED_HOLD_MS);
		return () => clearTimeout(held);
	}, [state]);
	return state === 'saved' && expired ? 'pristine' : state;
}

/**
 * whether `form`'s own submission is the one the router is carrying, through the reads after it:
 * a submission from anywhere else would otherwise mark this press busy.
 */
export function useSubmitting(form: { readonly id: string }): boolean {
	const navigation = useNavigation();
	return navigation.formData?.get(WHICH_FORM) === form.id;
}

/**
 * a refusal no box carries — a stale page, a write the database refused — at the foot of the card
 * it came from, beside the press it answers.
 */
export function FormRefusal({ errors }: { readonly errors: readonly string[] | undefined }) {
	const said = errors?.[0];
	if (said === undefined) return null;
	return (
		<Banner tone="blocker" word="Not saved">
			<MarkedText text={said} />
		</Banner>
	);
}

/** a box bound for `Field`, its message read as the marked text the org rules write it in. */
export function marked(box: Box) {
	const bound = boxProps(box);
	return {
		...bound,
		error: bound.error === undefined ? undefined : <MarkedText text={bound.error} />
	};
}
