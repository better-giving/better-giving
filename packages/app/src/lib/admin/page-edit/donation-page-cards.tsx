import { CheckboxGroup } from '@better-giving/operator/components/forms/CheckboxGroup';
import { Field } from '@better-giving/operator/components/forms/Field';
import { getFormProps } from '@conform-to/react';
import { useId } from 'react';
import { FormGivingFields } from '../forms/giving-fields';
import { FormProgramFields } from '../forms/program-fields';
import { insertWhenValid, useAdminForm } from '../use-admin-form';
import { defineForm } from '$lib/forms/definition';
import { SHARE_MESSAGE_MAX } from '$lib/page/catalog';
import {
	DONATION_PAGE_GENERAL_INPUT,
	DONATION_PAGE_GIVING_INPUT,
	DONATION_PAGE_SETTINGS_INPUT,
	type DonationPageGeneralSeed,
	type DonationPageGivingSeed,
	type DonationPageSettingsSeed,
	EDIT_BOXES,
	EDIT_FORMS
} from '$lib/page/edit-forms';
import { SWITCH_LABELS } from '$lib/page/settings-form';
import { amountsChanged, programChanged, textsChanged, ticksChanged } from './changed';
import { SectionCard, useScreenAnswer } from './section-card';

// the Donation page's three section cards on its edit screen (../../../routes/_app.admin.donation-page.tsx):
// General, Donation settings, Settings. each posts its own form ($lib/page/edit-forms.ts) and its
// Save writes the draft alone, as a campaign's cards do (./campaign-cards.tsx). the boxes are plain,
// so conform's own reading of them is compared with the seed as the save stores each (./changed.ts).

const GENERAL = defineForm({
	id: EDIT_FORMS.donationPageGeneral,
	schema: DONATION_PAGE_GENERAL_INPUT
});
const GIVING = defineForm({
	id: EDIT_FORMS.donationPageGiving,
	schema: DONATION_PAGE_GIVING_INPUT
});
const SETTINGS = defineForm({
	id: EDIT_FORMS.donationPageSettings,
	schema: DONATION_PAGE_SETTINGS_INPUT
});

type CardProps<Seed> = { readonly seed: Seed; readonly version: number };

const firstError = (errors: Record<string, string[] | undefined> | undefined, name: string) =>
	errors?.[name]?.[0];

/** General: the page's title, blank for "Donate to" and the organisation's name. */
export function DonationPageGeneralCard({ seed, version }: CardProps<DonationPageGeneralSeed>) {
	const answer = useScreenAnswer();
	const [form, fields] = useAdminForm(GENERAL, answer, { defaultValue: { ...seed.boxes } });
	return (
		<SectionCard
			form={getFormProps(form)}
			title="General"
			saveName="general"
			version={version}
			changed={textsChanged(seed.boxes, form.value ?? {}, [EDIT_BOXES.heading])}
		>
			<Field
				id={fields.heading.id}
				name={fields.heading.name}
				label="Title"
				optional
				hint="Left empty, the page says “Donate to” and your organisation’s name."
				defaultValue={seed.boxes.heading}
				error={firstError(form.allErrors, fields.heading.name)}
			/>
		</SectionCard>
	);
}

/** Donation settings: where a gift goes, and what a donor may give, suggested amounts included. */
export function DonationPageGivingCard({ seed, version }: CardProps<DonationPageGivingSeed>) {
	const answer = useScreenAnswer();
	const [form, fields] = useAdminForm(GIVING, answer, {
		defaultValue: { ...seed.boxes, suggested_amounts: [...seed.boxes.suggested_amounts] }
	});
	const held = form.value ?? {};
	const boxes: Record<string, unknown> = { ...seed.boxes };
	const changed =
		programChanged(boxes, held) ||
		amountsChanged(
			boxes,
			held,
			[EDIT_BOXES.minMinor, EDIT_BOXES.maxMinor, EDIT_BOXES.suggestedAmounts],
			seed.currency
		);
	return (
		<SectionCard
			form={getFormProps(form)}
			title="Donation settings"
			saveName="donation settings"
			version={version}
			changed={changed}
		>
			<FormProgramFields
				boxes={{ program_mode: fields.program_mode, program_id: fields.program_id }}
				programs={seed.programs}
				retired={seed.retired}
				heading="h3"
			/>
			<FormGivingFields
				boxes={{ min_minor: fields.min_minor, max_minor: fields.max_minor }}
				amounts={{
					id: fields.suggested_amounts.id,
					errors: fields.suggested_amounts.errors,
					rows: fields.suggested_amounts.getFieldList(),
					add: insertWhenValid(form, GIVING, fields.suggested_amounts.name),
					remove: (index) =>
						form.remove.getButtonProps({ name: fields.suggested_amounts.name, index })
				}}
				currency={seed.currency}
				heading="h3"
			/>
		</SectionCard>
	);
}

const MONTHLY_UNOFFERED =
	'Monthly is not offered while no payment account here can collect repeating gifts.';

/** Settings: how the donation box opens, and the share message. */
export function DonationPageSettingsCard({ seed, version }: CardProps<DonationPageSettingsSeed>) {
	const id = useId();
	const answer = useScreenAnswer();
	const [form, fields] = useAdminForm(SETTINGS, answer, { defaultValue: { ...seed.boxes } });
	const held = form.value ?? {};
	const boxes: Record<string, unknown> = { ...seed.boxes };
	const changed =
		ticksChanged(boxes, held, [EDIT_BOXES.openOnMonthly, EDIT_BOXES.dedicationOn]) ||
		textsChanged(boxes, held, [EDIT_BOXES.shareMessage]);
	const shareCount = typeof held.share_message === 'string' ? held.share_message.length : 0;
	return (
		<SectionCard
			form={getFormProps(form)}
			title="Settings"
			saveName="settings"
			version={version}
			changed={changed}
		>
			<h3>How the donation box opens</h3>
			<CheckboxGroup
				id={`${id}-opens`}
				items={[
					{
						id: fields.open_on_monthly.id,
						name: fields.open_on_monthly.name,
						label: SWITCH_LABELS.open_on_monthly,
						defaultChecked: fields.open_on_monthly.defaultChecked,
						note: seed.monthlyOffered ? undefined : MONTHLY_UNOFFERED
					},
					{
						id: fields.dedication_on.id,
						name: fields.dedication_on.name,
						label: SWITCH_LABELS.dedication_on,
						defaultChecked: fields.dedication_on.defaultChecked
					}
				]}
			/>
			<div className="adm-stack adm-stack--tight">
				<Field
					id={fields.share_message.id}
					name={fields.share_message.name}
					as="textarea"
					label="Share message"
					optional
					hint="What a donor’s post says when they share the page. Left empty, it says the page’s title."
					defaultValue={seed.boxes.share_message}
					aria-describedby={`${id}-share-count`}
					error={firstError(form.allErrors, fields.share_message.name)}
				/>
				<p className="adm-hint adm-num" id={`${id}-share-count`}>
					{shareCount}/{SHARE_MESSAGE_MAX}
				</p>
			</div>
		</SectionCard>
	);
}
