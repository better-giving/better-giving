import { getFormProps } from '@conform-to/react';
import { type SubmitEvent, useEffect } from 'react';
import { useFetcher } from 'react-router';
import { FormGivingFields } from '$lib/admin/forms/giving-fields';
import { FormProgramFields } from '$lib/admin/forms/program-fields';
import {
	type AdminActionData,
	insertWhenValid,
	recordVersion,
	resultFor,
	useAdminForm,
	whichForm
} from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import { PAGE_SETTINGS_INPUT } from '$lib/forms/input-schema';
import { PAGE_SETTINGS_FORM_ID, type SettingsSeed } from '$lib/page/settings-form';
import { DoneSheet } from './done-sheet';

// the Donation settings sheet both editors open from Settings: a form's program and giving groups
// (../forms/), mounted as the form screen mounts them, under one Done. the write is the editor
// route's action (`saveDraftSettings` in $lib/server/pages/editor.ts), posted through a fetcher so
// the editor does not navigate; a landed save moves the page's version, which reloads the preview.
//
// the sheet's form is conform's, handed over as `formProps`: its list intents (Add, Remove) and its
// validation pass run in conform's `onSubmit`, and a submit that pass lets through goes to the
// fetcher rather than navigating.

const PAGE_SETTINGS = defineForm({ id: PAGE_SETTINGS_FORM_ID, schema: PAGE_SETTINGS_INPUT });

type DonationSettingsSheetProps = {
	readonly seed: SettingsSeed;
	/** the page's version the editor was drawn at. */
	readonly version: number;
	/** X or Escape. */
	readonly onDismiss: () => void;
	/** a Done landed: the draft holds what was typed. */
	readonly onSaved: () => void;
};

type Answer = AdminActionData & { readonly saved?: string };

export function DonationSettingsSheet({
	seed,
	version,
	onDismiss,
	onSaved
}: DonationSettingsSheetProps) {
	// unkeyed, so an answer does not outlive the sheet: a reopened sheet starts with none.
	const fetcher = useFetcher<Answer>();
	const applying = fetcher.state !== 'idle';
	const answer = applying ? undefined : fetcher.data;
	const saved = answer?.saved === 'settings';

	const [form, fields] = useAdminForm(PAGE_SETTINGS, answer, {
		defaultValue: { ...seed.boxes, suggested_amounts: [...seed.boxes.suggested_amounts] }
	});
	const rows = fields.suggested_amounts.getFieldList();

	useEffect(() => {
		if (saved) onSaved();
	}, [saved, onSaved]);

	const conform = getFormProps(form);
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		conform.onSubmit(event);
		if (event.defaultPrevented) return;
		event.preventDefault();
		fetcher.submit(event.currentTarget);
	};

	return (
		<DoneSheet
			title="Donation settings"
			stacked
			wide
			tall
			onDismiss={onDismiss}
			formProps={{ ...conform, method: 'post', onSubmit: submit }}
			applying={applying}
			refusal={resultFor(PAGE_SETTINGS, answer)?.error?.['']?.[0] ?? null}
		>
			<input {...whichForm(PAGE_SETTINGS.id)} />
			<input {...recordVersion(version)} />
			<FormProgramFields
				boxes={{ program_mode: fields.program_mode, program_id: fields.program_id }}
				programs={seed.programs}
				retired={seed.retired}
			/>
			<FormGivingFields
				boxes={{ min_minor: fields.min_minor, max_minor: fields.max_minor }}
				amounts={{
					id: fields.suggested_amounts.id,
					errors: fields.suggested_amounts.errors,
					rows,
					add: insertWhenValid(form, PAGE_SETTINGS, fields.suggested_amounts.name),
					remove: (index) =>
						form.remove.getButtonProps({ name: fields.suggested_amounts.name, index })
				}}
				currency={seed.currency}
			/>
		</DoneSheet>
	);
}
