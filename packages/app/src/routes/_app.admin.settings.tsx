import { Button } from '@better-giving/operator/components/controls/Button';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { Field } from '@better-giving/operator/components/forms/Field';
import {
	RepeatingRows,
	type RowControl
} from '@better-giving/operator/components/forms/RepeatingRows';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { Column, Section } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { SOCIAL_LINKS_FIELD } from '@better-giving/operator/console/org';
import {
	EMAIL,
	MAX_EMAIL,
	ORG_PROFILE_FIELD_RULES,
	REQUIRED
} from '@better-giving/operator/console/org-rules';
import { readSocialLinks } from '@better-giving/operator/console/social-links';
import type { TestSendReport } from '@better-giving/operator/console/test-send';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import { useEffect, useEffectEvent, useId, useState } from 'react';
import { data, Form, useFetcher, useNavigation } from 'react-router';
import { z } from 'zod';
import { buttonState } from '$lib/admin/save-button-state';
import { savedSection } from '$lib/admin/saved-section';
import { screenTitle } from '$lib/admin/screen-title';
import { BrandColourField } from '$lib/admin/settings/brand-colour-field';
import { LogoPicker } from '$lib/admin/settings/logo-picker';
import type { Squared } from '$lib/admin/settings/logo-square';
import { FILLED, PICK_ANOTHER } from '$lib/admin/settings/nonprofit-finder';
import { type FinderOut, OrgFinder, StandingWord } from '$lib/admin/settings/org-finder';
import { useSocialLinkLeads } from '$lib/admin/settings/social-link-lead';
import { formPress } from '$lib/admin/unreached';
import {
	type AdminActionData,
	type Box,
	boxProps,
	insertWhenValid,
	listPress,
	recordVersion,
	useAdminForm,
	useHydrated,
	whichForm
} from '$lib/admin/use-admin-form';
import { defineForm, type FormRejection, WHICH_FORM } from '$lib/forms/definition';
import type {
	NonprofitFields,
	NonprofitLookupAnswer,
	NonprofitSearchAnswer,
	NonprofitStanding
} from '$lib/org/nonprofit-answers';
import { imageSrc } from '$lib/page/image-src';
import { STAFF_USER_ID } from '$lib/server/auth';
import { readConfigEnv } from '$lib/server/config/env';
import { readSetupState } from '$lib/server/config/setup-state';
import { invalid, parseForm, submittedForm, submittedVersion } from '$lib/server/conform';
import { loadFailed, notFound } from '$lib/server/db/load-failure';
import { createEmailProvider } from '$lib/server/email/factory';
import { sendTestEmail } from '$lib/server/email/test-send';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { toFormValues } from '$lib/server/org/form-values';
import {
	orgProfileValues,
	parseNotificationEmail,
	parseOrgProfile,
	socialLinkRows
} from '$lib/server/org/org-input';
import {
	orgProfileVersion,
	updateOrgDetails,
	updateOrgNotificationEmail
} from '$lib/server/org/queries';
import { database, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.settings';

// what this deployment knows about the organisation it serves, and what it sends with: the
// organisation's details and logo, the address it reaches the organisation at, and the mail values
// it was started with. three cards, read as a loader and written by the action below and by the
// logo's own address (./_app.admin.settings_.logo.ts).
//
// **only the deployer's session reaches this page**, the predicate ./_app.admin.members.tsx reads —
// `context.get(staff).id === STAFF_USER_ID` — read by the loader and by the action alike, and by
// ./_app.tsx to leave the rail's Settings cell out for anyone else ($lib/admin/destinations.ts). a
// member's GET and POST are answered with the dashboard's not-found, before the body is read.
//
// **what a profile may hold is `@better-giving/operator/console/org-rules`'s**, run in the browser
// by the forms below and again by `parseOrgProfile` ($lib/server/org/org-input.ts), which stays the
// authority. the details and the notification address are two saves of one row, each written
// against the version the page was drawn from and naming only its own columns
// ($lib/server/org/queries.ts), so a press on one leaves what is typed in the other alone.
//
// **mail is the deployment's `.env` and nothing here writes it.** the card states the sender and the
// host, never the username or the password, and whether mail is set up is the setup reading's
// `smtp` line ($lib/server/config/readiness.ts). the test send answers on this screen through a
// fetcher, since it writes nothing and an outcome is all it has to report.
//
// three submissions and one `action`, told apart by the box `whichForm` writes into each `<form>`
// ($lib/server/conform.ts argues the mechanism). each save reports at its own button and survives
// its redirect as a flash naming its card ($lib/server/flash.ts).

/** the screen's name in the document title. ./_app.tsx names the page in a hidden `h1`. */
const SCREEN_TITLE = 'Settings';

/** the address this screen answers on, and the one a save redirects back to. */
const SCREEN = '/admin/settings';

/** where the logo is put on and taken off. */
const LOGO_ADDRESS = `${SCREEN}/logo`;

/**
 * where "Find your charity" asks: `?q=` searches by name, and `/<ein>` looks one organisation up
 * (./_app.admin.settings_.nonprofits.ts, ./_app.admin.settings_.nonprofits_.$ein.ts).
 */
const NONPROFITS_ADDRESS = `${SCREEN}/nonprofits`;

/** the details boxes a found lookup fills; `address_line2` and the rest are left as they stand. */
const FOUND_BOXES = [
	'legal_name',
	'tax_id',
	'address_line1',
	'city',
	'region',
	'postal_code',
	'country'
] as const satisfies readonly (keyof NonprofitFields & DetailsField)[];

/** the body of a member's not-found. the panel ../root.tsx draws does not show it; an agent reads it. */
const NOT_HERE =
	`No page at ${SCREEN} for a member’s session. The organisation’s details, its notification ` +
	'address and the mail check are the deployer’s: sign in with `ADMIN_PASSWORD` at /login.';

/** what a save from a page drawn before another save of the profile is told. */
const STALE_SAVE =
	'The organisation’s details changed since this page was opened. Reload it and save again.';

/** what a save the database refused is told. nothing an operator types changes that. */
const WRITE_FAILED = 'Saving this failed and nothing was changed. Try again.';

/** an address saved ahead of the details: a profile row cannot exist without a legal name. */
const NO_PROFILE_YET = 'Save the organisation details first, then the notification address.';

/**
 * the three forms, as the literals a body names itself with. the switch in the action narrows on
 * them, so an arm for a form this screen does not state is a type error.
 */
const DETAILS_FORM_ID = 'settings-details';
const NOTIFICATIONS_FORM_ID = 'settings-notifications';
const TEST_EMAIL_FORM_ID = 'settings-test-email';
const SCREEN_FORMS = [DETAILS_FORM_ID, NOTIFICATIONS_FORM_ID, TEST_EMAIL_FORM_ID] as const;

/** the two saves, as a redirect names the card it landed from to the page it lands on. */
const SAVED_SECTIONS = ['details', 'notifications'] as const;

/**
 * one box of the details form as conform hands it over: an empty box arrives `undefined`, so a bare
 * string would answer an emptied optional box with zod's own type error. the rules are run over the
 * boxes in the form's refinement instead, each over the empty string a box stood for.
 */
const detailsBox = z.string().optional();

const DETAILS_BOXES = z.object({
	legal_name: detailsBox,
	tax_id: detailsBox,
	address_line1: detailsBox,
	address_line2: detailsBox,
	city: detailsBox,
	region: detailsBox,
	postal_code: detailsBox,
	country: detailsBox,
	mission: detailsBox,
	vision: detailsBox,
	brand_colour: detailsBox
});

type DetailsField = keyof typeof DETAILS_BOXES.shape;

/**
 * the organisation's details: the profile's boxes but the notification address, and the link rows.
 *
 * a blank row is refused under its own box, though `readSocialLinks` skips one, because every box a
 * form states must arrive (AGENTS.md → Forms); the list's own refusal is keyed to the list, where
 * the deployment's parse keys it too. only the issues are read: `tax_id`'s rule re-spells what it
 * stores, and that rewrite is the server's to make.
 */
const DETAILS_FORM = defineForm({
	id: DETAILS_FORM_ID,
	schema: DETAILS_BOXES.extend({
		[SOCIAL_LINKS_FIELD]: z.array(z.string().optional()).optional()
	}).superRefine((held, ctx) => {
		for (const field of Object.keys(DETAILS_BOXES.shape) as DetailsField[]) {
			const read = ORG_PROFILE_FIELD_RULES[field].safeParse(held[field] ?? '');
			if (read.success) continue;
			for (const issue of read.error.issues) {
				ctx.addIssue({ code: 'custom', message: issue.message, path: [field] });
			}
		}
		const rows = (held[SOCIAL_LINKS_FIELD] ?? []).map((row) => row ?? '');
		rows.forEach((row, at) => {
			if (row.trim().length > 0) return;
			ctx.addIssue({ code: 'custom', message: REQUIRED, path: [SOCIAL_LINKS_FIELD, at] });
		});
		const links = readSocialLinks(rows);
		if (!links.ok) {
			ctx.addIssue({ code: 'custom', message: links.error, path: [SOCIAL_LINKS_FIELD] });
		}
	})
});

/** the one box the notifications card draws, at the rule the leaf states for it. */
const NOTIFICATIONS_FORM = defineForm({
	id: NOTIFICATIONS_FORM_ID,
	schema: z.object({ notification_email: z.string().optional() }).superRefine((held, ctx) => {
		const read = ORG_PROFILE_FIELD_RULES.notification_email.safeParse(
			held.notification_email ?? ''
		);
		if (read.success) return;
		for (const issue of read.error.issues) {
			ctx.addIssue({ code: 'custom', message: issue.message, path: ['notification_email'] });
		}
	})
});

/** what a test destination that is not one address is told, in the console's words. */
const NOT_AN_ADDRESS = 'That is not an address this deployment can send to. Nothing was sent.';

/**
 * the test send's destination. the caller's own and not the organisation's row, so a mail host is
 * checked against an inbox somebody is watching ($lib/server/email/test-send.ts).
 */
const TEST_EMAIL_FORM = defineForm({
	id: TEST_EMAIL_FORM_ID,
	schema: z.object({
		to: z
			.string({ error: REQUIRED })
			.trim()
			.max(MAX_EMAIL, { error: NOT_AN_ADDRESS })
			.regex(EMAIL, { error: NOT_AN_ADDRESS })
	})
});

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const state = await readSetupState(context.get(database), context.get(platform).env);
	if (state === null) loadFailed('Settings');

	const { profile, lines } = state;
	// every box the details form states keyed, an absent value as an empty box: the seed is what the
	// save button is armed against ($lib/admin/use-admin-form.ts).
	const stored = profile === null ? {} : toFormValues(profile);
	const details = Object.fromEntries(
		Object.keys(DETAILS_BOXES.shape).map((box) => [box, stored[box as DetailsField] ?? ''])
	) as Record<DetailsField, string>;
	const config = readConfigEnv(context.get(platform).env);
	const mailSet = lines.find((line) => line.id === 'smtp')?.state === 'ready';

	// the save that just redirected here, taken: read and cleared on this one response.
	const landed = await takeFlash(request, SAVED_FLASH);
	return data(
		{
			details: {
				...details,
				[SOCIAL_LINKS_FIELD]: (profile?.socialLinks ?? []).map((link) => link.href)
			},
			logo:
				profile?.logoImageId == null
					? null
					: { id: profile.logoImageId, src: imageSrc(profile.logoImageId) },
			notificationEmail: profile?.notificationEmail ?? null,
			mail: mailSet ? { from: config.MAIL_FROM ?? '', host: config.SMTP_HOST ?? '' } : null,
			saved: savedSection(landed?.marker ?? null, SAVED_SECTIONS),
			// the version both saves are written against, carried back in each `<form>`.
			version: orgProfileVersion(profile)
		},
		// a `Set-Cookie` from a loader is sent without this route exporting `headers`.
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/**
 * every write this screen performs. **the request body is read exactly once, here** — and not at
 * all for a member, who is answered before it.
 */
export async function action(args: Route.ActionArgs) {
	if (args.context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const body = await args.request.formData();
	switch (submittedForm(body, SCREEN_FORMS)) {
		case DETAILS_FORM_ID:
			return saveDetails(args, body);
		case NOTIFICATIONS_FORM_ID:
			return saveNotifications(args, body);
		case TEST_EMAIL_FORM_ID:
			return sendTest(args, body);
	}

	// the arms are declared inside the action because react router strips the `action` export from
	// the browser bundle and nothing else: a module-scope helper reaching `$lib/server/**` would ship
	// it (../routes.spec.ts holds that over the module graph).

	/** the details, every box at once: the schema's refusals and the parser's come back together. */
	async function saveDetails({ context, request }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, DETAILS_FORM);
		const parsed = parseOrgProfile(orgProfileValues(body), socialLinkRows(body));
		if (!parsed.ok || !submission.ok) {
			return invalid(
				400,
				submission.reject({ fieldErrors: parsed.ok ? {} : listed(parsed.errors) })
			);
		}

		const version = submittedVersion(body);
		let saved: Awaited<ReturnType<typeof updateOrgDetails>>;
		try {
			saved = await updateOrgDetails(context.get(database), version, parsed.value);
		} catch (e) {
			console.error('saving the organisation’s details failed:', e);
			return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
		}
		if (saved === 'stale') return invalid(409, submission.reject({ formErrors: [STALE_SAVE] }));
		return redirectWithFlash(request, SAVED_FLASH, SCREEN, 'details');
	}

	/** the notification address, and no other column. an emptied box clears it. */
	async function saveNotifications({ context, request }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, NOTIFICATIONS_FORM);
		if (!submission.ok) return invalid(400, submission.reject());
		const parsed = parseNotificationEmail(submission.value.notification_email);
		if (!parsed.ok) {
			return invalid(
				400,
				submission.reject({ fieldErrors: { notification_email: [parsed.error] } })
			);
		}

		const version = submittedVersion(body);
		let saved: Awaited<ReturnType<typeof updateOrgNotificationEmail>>;
		try {
			saved = await updateOrgNotificationEmail(context.get(database), version, parsed.value);
		} catch (e) {
			console.error('saving the notification address failed:', e);
			return invalid(500, submission.reject({ formErrors: [WRITE_FAILED] }));
		}
		if (saved !== 'saved') {
			return invalid(
				409,
				submission.reject({ formErrors: [saved === 'stale' ? STALE_SAVE : NO_PROFILE_YET] })
			);
		}
		return redirectWithFlash(request, SAVED_FLASH, SCREEN, 'notifications');
	}

	/**
	 * the test message, over this request's own transport. a send that did not go is the form's
	 * refusal carrying the port's sentence, which names the value to set; nothing is written either way.
	 */
	async function sendTest({ context }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, TEST_EMAIL_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		const mail = createEmailProvider(context.get(platform).env);
		const testSend = await sendTestEmail({
			to: submission.value.to,
			send: (message) => mail.send(message)
		});
		if (testSend.outcome === 'sent') return { testSend };
		const formErrors = testSend.detail === null ? [] : [testSend.detail];
		return invalid(500, submission.reject({ formErrors }), { testSend });
	}
}

/**
 * a press whose request never reached the server, answered in the browser as the refusal of the
 * form that was pressed rather than with the error boundary ($lib/admin/unreached.ts).
 */
export function clientAction({ request, serverAction }: Route.ClientActionArgs) {
	return formPress(request, serverAction);
}

/** one sentence per box, as a rejection carries a box's messages. */
function listed(errors: Readonly<Record<string, string>>): Record<string, string[]> {
	return Object.fromEntries(Object.entries(errors).map(([box, sentence]) => [box, [sentence]]));
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
	return (
		<Column>
			<DetailsCard
				details={loaderData.details}
				logo={loaderData.logo}
				landed={loaderData.saved === 'details'}
				version={loaderData.version}
				actionData={actionData}
			/>
			<NotificationsCard
				address={loaderData.notificationEmail}
				landed={loaderData.saved === 'notifications'}
				version={loaderData.version}
				actionData={actionData}
			/>
			<MailCard mail={loaderData.mail} to={loaderData.notificationEmail} />
		</Column>
	);
}

type LoaderData = Route.ComponentProps['loaderData'];

/** what a card's save is told by the screen: its seed, whether it just landed, and the last answer. */
type CardSave = {
	readonly landed: boolean;
	readonly version: number;
	readonly actionData: AdminActionData;
};

/**
 * whether `form`'s own submission is the one the router is carrying, through the reads after it:
 * the other card's save would otherwise mark this press busy.
 */
function useSubmitting(form: { readonly id: string }): boolean {
	const navigation = useNavigation();
	return navigation.formData?.get(WHICH_FORM) === form.id;
}

/**
 * a refusal no box carries — a stale page, a write the database refused — at the foot of the card
 * it came from, beside the press it answers.
 */
function FormRefusal({ errors }: { readonly errors: readonly string[] | undefined }) {
	const said = errors?.[0];
	if (said === undefined) return null;
	return (
		<Banner tone="blocker" word="Not saved">
			<MarkedText text={said} />
		</Banner>
	);
}

/** a box bound for `Field`, its message read as the marked text the org rules write it in. */
function marked(box: Box) {
	const bound = boxProps(box);
	return {
		...bound,
		error: bound.error === undefined ? undefined : <MarkedText text={bound.error} />
	};
}

/**
 * a row press as `RepeatingRows` is handed it: conform's attributes the press is named by, and the
 * type and click `listPress` draws it with, which win.
 */
function rowPress(
	press: RowControl & { readonly form: string; readonly formNoValidate: boolean },
	hydrated: boolean
) {
	const as = listPress(press, hydrated);
	return as.type === 'submit' ? { ...press, type: as.type } : { ...press, ...as };
}

function DetailsCard({
	details,
	logo,
	landed,
	version,
	actionData
}: CardSave & { readonly details: LoaderData['details']; readonly logo: LoaderData['logo'] }) {
	const [form, fields] = useAdminForm(DETAILS_FORM, actionData, { defaultValue: details });
	const hydrated = useHydrated();
	const save = useSaveState({
		// `!actionData`: a refused write answers with a rejection rather than a redirect, so the
		// marker the last landing published may still be on the page.
		landed: landed && !actionData,
		changed: form.dirty,
		pending: useSubmitting(DETAILS_FORM)
	});
	const links = fields[SOCIAL_LINKS_FIELD];
	const linkLead = useSocialLinkLeads();
	const finder = useOrgFinder(details.legal_name === '', version);

	// a found lookup puts its values in the boxes as edits, which arm Save details and save nothing.
	const fill = useEffectEvent((answer: NonprofitLookupAnswer | undefined) => {
		if (answer?.outcome !== 'found') return;
		for (const box of FOUND_BOXES)
			form.update({ name: fields[box].name, value: answer.fields[box] });
		finder.filledFrom(answer);
	});
	useEffect(() => {
		fill(finder.lookup);
	}, [finder.lookup]);

	return (
		<Form method="post" {...getFormProps(form)}>
			<input {...whichForm(DETAILS_FORM.id)} />
			<input {...recordVersion(version)} />
			<Section card>
				<h2>Organisation details</h2>
				<p className="adm-hint">
					Every receipt carries these, as the tax authority has them. No form goes live until the
					EIN and registered name are in.
				</p>
				{finder.open ? <OrgFinder {...finder.props} /> : null}
				<div className="adm-pair adm-pair--side">
					<Field
						{...marked(fields.tax_id)}
						label="EIN"
						placeholder="12-3456789"
						className="adm-num"
						inputMode="numeric"
					/>
					<Field
						{...marked(fields.legal_name)}
						label="Registered name"
						placeholder="Better Giving"
					/>
				</div>
				<fieldset className="adm-fieldset">
					<legend className="adm-fieldset__legend">Address on receipts</legend>
					<div className="adm-pair adm-pair--side">
						<Field
							{...marked(fields.address_line1)}
							label="Street address"
							placeholder="123 Example Street"
						/>
						<Field
							{...marked(fields.address_line2)}
							label="Suite, floor or unit"
							optional
							placeholder="Suite 400"
						/>
					</div>
					<div className="adm-pair adm-pair--side">
						<Field {...marked(fields.city)} label="City" placeholder="Anytown" />
						<Field
							{...marked(fields.region)}
							label="State, province or county"
							optional
							placeholder="California"
						/>
					</div>
					<div className="adm-pair adm-pair--side">
						<Field
							{...marked(fields.postal_code)}
							label="Postal code"
							optional
							placeholder="12345"
						/>
						<Field {...marked(fields.country)} label="Country" placeholder="United States" />
					</div>
				</fieldset>
				{/* mounted in every state, so the sentence arriving in it is a change a reader is told. */}
				<p className="adm-hint adm-findnote" role="status">
					{finder.filled === null ? null : (
						<>
							{FILLED} <StandingWord standing={finder.filled} />
						</>
					)}
				</p>
				<Field
					{...marked(fields.mission)}
					as="textarea"
					label="Mission"
					placeholder="Help every nonprofit take gifts on forms it owns."
				/>
				<Field
					{...marked(fields.vision)}
					as="textarea"
					label="Vision"
					optional
					placeholder="A world where giving costs the giver nothing extra."
				/>
				<BrandColourField
					{...marked(fields.brand_colour)}
					defaultValue={fields.brand_colour.defaultValue ?? ''}
					label="Brand colour"
					optional
					hint="A # and six hex digits, like #1f6feb."
					placeholder="#1f6feb"
				/>
				<RepeatingRows
					id={links.id}
					legend="Social links"
					rowLabel="Link"
					hint="One address for each platform: Facebook, Instagram, YouTube, LinkedIn, TikTok or X."
					error={
						links.errors?.[0] === undefined ? undefined : <MarkedText text={links.errors[0]} />
					}
					rows={links.getFieldList().map((row, index) => ({
						...marked(row),
						...linkLead(row.key ?? row.id, row.defaultValue),
						key: row.key,
						remove: rowPress(form.remove.getButtonProps({ name: links.name, index }), hydrated)
					}))}
					addLabel="Add a link"
					add={rowPress(insertWhenValid(form, DETAILS_FORM, links.name), hydrated)}
					placeholder="https://www.instagram.com/your-organisation"
				/>
				<LogoControl logo={logo} />
				<FormRefusal errors={form.errors} />
				<div className="adm-actions">
					<SaveButton label="Save details" state={buttonState(save)} />
					{finder.open ? null : (
						<Button type="button" variant="quiet" onClick={finder.reopen}>
							{PICK_ANOTHER}
						</Button>
					)}
				</div>
			</Section>
		</Form>
	);
}

/**
 * "Find your charity" in the details card: whether it is drawn, the two calls it makes, and the
 * standing of the organisation the boxes were last filled from.
 *
 * **one press is one call**, a fetcher's `load` each: the service's keyless allowance is a call a
 * minute. a name search and a lookup are two fetchers, so the list a match was picked from stays
 * drawn while its lookup is out; neither address is read again when the screen's loaders are
 * (`shouldRevalidate` in each).
 *
 * it opens on a profile with no details yet, and otherwise only at "Pick a different
 * organisation". a save that lands — the profile's version moving — puts it away and drops the
 * fill's note, since the boxes then hold what was stored.
 */
function useOrgFinder(empty: boolean, version: number) {
	const searched = useFetcher<NonprofitSearchAnswer>();
	const looked = useFetcher<NonprofitLookupAnswer>();
	const [open, setOpen] = useState(empty);
	const [pressedOpen, setPressedOpen] = useState(false);
	const [filled, setFilled] = useState<NonprofitStanding | null>(null);

	const [drawnAt, setDrawnAt] = useState(version);
	if (version !== drawnAt) {
		setDrawnAt(version);
		setFilled(null);
		if (!empty) setOpen(false);
	}

	const out: FinderOut =
		searched.state !== 'idle' ? 'search' : looked.state !== 'idle' ? 'lookup' : null;

	return {
		open,
		filled,
		lookup: looked.data,
		filledFrom: ({ deductible, revoked, revocationDate }: NonprofitStanding) =>
			setFilled({ deductible, revoked, revocationDate }),
		reopen: () => {
			setPressedOpen(true);
			setOpen(true);
		},
		props: {
			search: searched.data,
			lookup: looked.data,
			out,
			autoFocus: pressedOpen,
			onSearch: (q: string) => {
				void searched.load(`${NONPROFITS_ADDRESS}?${new URLSearchParams({ q })}`);
			},
			onLookUp: (ein: string) => {
				void looked.load(`${NONPROFITS_ADDRESS}/${ein}`);
			}
		}
	};
}

/** what the logo's address answers: the logo it put on or took off, or why not. */
type LogoAnswer =
	| { readonly logo: { readonly id: string; readonly src: string } | null }
	| { readonly error: string; readonly reason?: 'failed' };

/**
 * the logo, put on as soon as its crop is saved and resized, and taken off at Remove, each a fetcher
 * to its own address: neither is part of Save details, and the screen's loaders are read again
 * after either.
 *
 * the refusal at the press is the latest answer's — a crop, a resize or an upload that failed — and
 * a crop that comes through clears it.
 */
function LogoControl({ logo }: { readonly logo: LoaderData['logo'] }) {
	const hintId = `${useId()}-hint`;
	const fetcher = useFetcher<LogoAnswer>();
	const [refused, setRefused] = useState<string | null>(null);

	const [answered, setAnswered] = useState(fetcher.data);
	if (fetcher.data !== answered) {
		setAnswered(fetcher.data);
		if (fetcher.data !== undefined && 'error' in fetcher.data) {
			setRefused(
				fetcher.data.reason === 'failed'
					? 'That didn’t go through. Choose the logo again.'
					: fetcher.data.error
			);
		}
	}

	const squared = (result: Squared) => {
		if (!result.ok) {
			setRefused(result.refused);
			return;
		}
		setRefused(null);
		const body = new FormData();
		body.set('file', result.blob);
		fetcher.submit(body, { method: 'post', action: LOGO_ADDRESS, encType: 'multipart/form-data' });
	};

	return (
		<fieldset className="adm-fieldset" aria-describedby={hintId}>
			<legend className="adm-fieldset__legend">Logo</legend>
			<p className="adm-hint" id={hintId}>
				On each receipt.
			</p>
			<LogoPicker
				src={logo?.src}
				onSquared={squared}
				state={
					fetcher.state === 'idle'
						? refused === null
							? undefined
							: { refused }
						: fetcher.formMethod === 'DELETE'
							? 'removing'
							: 'uploading'
				}
				onRemove={() => {
					setRefused(null);
					fetcher.submit(null, { method: 'delete', action: LOGO_ADDRESS });
				}}
			/>
		</fieldset>
	);
}

function NotificationsCard({
	address,
	landed,
	version,
	actionData
}: CardSave & { readonly address: string | null }) {
	const [form, fields] = useAdminForm(NOTIFICATIONS_FORM, actionData, {
		defaultValue: { notification_email: address ?? '' }
	});
	const save = useSaveState({
		landed: landed && !actionData,
		changed: form.dirty,
		pending: useSubmitting(NOTIFICATIONS_FORM)
	});

	return (
		<Form method="post" {...getFormProps(form)}>
			<input {...whichForm(NOTIFICATIONS_FORM.id)} />
			<input {...recordVersion(version)} />
			<Section card>
				<h2>Notifications</h2>
				{/* read off the stored row rather than the box: what is dropped is decided by what is
				    saved, and a box typed into and not saved reaches nobody yet either. */}
				{address === null ? (
					<Banner tone="attention" word="Nothing reaches you yet">
						Alerts about gifts, refunds and dispute deadlines are dropped until an address is saved
						here.
					</Banner>
				) : null}
				<Field
					{...marked(fields.notification_email)}
					label="Notification email"
					hint="Where this site reaches you about the gifts it takes and anything that goes wrong."
					type="email"
					autoComplete="email"
					placeholder="alerts@better.giving"
				/>
				<FormRefusal errors={form.errors} />
				<div className="adm-actions">
					<SaveButton label="Save address" state={buttonState(save)} />
				</div>
			</Section>
		</Form>
	);
}

/** the mail card: what the deployment sends with, or what it takes to send at all. */
function MailCard({ mail, to }: { readonly mail: LoaderData['mail']; readonly to: string | null }) {
	return (
		<Section card>
			<h2>Mail</h2>
			{mail === null ? <MailUnset /> : <MailSet mail={mail} to={to} />}
		</Section>
	);
}

/**
 * the card with no mail values, one banner in two parts for two readers: the staff sentence, and
 * under it the steps for whoever runs the server, since no box on this screen sets a mail value.
 */
function MailUnset() {
	return (
		<Banner
			tone="attention"
			word="Receipts aren’t being sent"
			body={
				<>
					<h3 className="adm-banner__head">For whoever runs the server</h3>
					<p>
						<MarkedText text="Add the mail values to `.env` (DEPLOY.md, Mail), then recreate the app:" />
					</p>
					<CodeSlab
						oneline
						content="docker compose up -d --force-recreate app"
						copyable
						copyLabel="Copy the command"
					/>
				</>
			}
		>
			Donors get no receipt and you get no notice of their gifts until mail is set up. Ask whoever
			set up this site to add it. The steps below are for them.
		</Banner>
	);
}

/** what a test send's fetcher is answered with: the outcome, and the form's refusal where it failed. */
type TestAnswer = { readonly form?: FormRejection; readonly testSend?: TestSendReport };

function MailSet({
	mail,
	to
}: {
	readonly mail: NonNullable<LoaderData['mail']>;
	readonly to: string | null;
}) {
	const fetcher = useFetcher<TestAnswer>();
	const [form, fields] = useAdminForm(TEST_EMAIL_FORM, fetcher.data, {
		defaultValue: { to: to ?? '' }
	});
	const sending = fetcher.state !== 'idle';
	// the answer to the last press, and nothing while the next one is away: the outcome of the send,
	// or, for a press that never reached the server, the form's refusal saying so.
	const report = sending ? undefined : fetcher.data?.testSend;
	const unsent = sending || report !== undefined ? undefined : form.errors?.[0];

	return (
		<>
			<div className="adm-pair adm-pair--side">
				<StatedValue label="Sends from" value={mail.from} />
				<StatedValue label="Mail host" value={mail.host} />
			</div>
			<p className="adm-hint">Receipts to donors and notices to you go out from this address.</p>
			<fetcher.Form method="post" {...getFormProps(form)}>
				<input {...whichForm(TEST_EMAIL_FORM.id)} />
				<Field
					{...marked(fields.to)}
					label="Send a test email to"
					hint="Nothing is recorded and no donor hears about it."
					type="email"
					beside={
						// held with `aria-disabled` rather than `disabled`, so the focus stays on the press: one
						// press is one message.
						<Button
							type="submit"
							aria-busy={sending || undefined}
							aria-disabled={sending || undefined}
							onClick={(event) => {
								if (sending) event.preventDefault();
							}}
						>
							Send test email
						</Button>
					}
				/>
			</fetcher.Form>
			{/* mounted in every state, so the sentence arriving in it is a change a reader is told. */}
			<p className="adm-hint" role="status">
				{report?.outcome === 'sent'
					? 'Sent. Nothing was recorded and no donor hears about it.'
					: null}
			</p>
			{report?.outcome === 'failed' ? (
				<>
					<Banner tone="blocker" word="Nothing was sent">
						This deployment could not hand the message to a mail host.
					</Banner>
					{report.detail === null ? null : (
						<p className="adm-prose">
							<MarkedText text={report.detail} />
						</p>
					)}
				</>
			) : unsent === undefined ? null : (
				<Banner tone="blocker" word="Nothing was sent">
					<MarkedText text={unsent} />
				</Banner>
			)}
		</>
	);
}
