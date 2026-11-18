import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import {
	RepeatingRows,
	type RowControl
} from '@better-giving/operator/components/forms/RepeatingRows';
import {
	SettingsLayout,
	SettingsSave
} from '@better-giving/operator/components/shell/SettingsLayout';
import { SOCIAL_LINKS_FIELD } from '@better-giving/operator/console/org';
import { ORG_PROFILE_FIELD_RULES, REQUIRED } from '@better-giving/operator/console/org-rules';
import { readSocialLinks } from '@better-giving/operator/console/social-links';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import { useEffect, useEffectEvent, useId, useState } from 'react';
import { data, Form, useFetcher } from 'react-router';
import { z } from 'zod';
import { ScreenHeading } from '$lib/admin/crumbs';
import { savedSection } from '$lib/admin/saved-section';
import { screenTitle } from '$lib/admin/screen-title';
import { BannerPicker } from '$lib/admin/settings/banner-picker';
import { BrandColourField } from '$lib/admin/settings/brand-colour-field';
import type { Cropped } from '$lib/admin/settings/crop-image';
import { LogoPicker } from '$lib/admin/settings/logo-picker';
import { FILLED, PICK_ANOTHER } from '$lib/admin/settings/nonprofit-finder';
import { type FinderOut, OrgFinder, StandingWord } from '$lib/admin/settings/org-finder';
import {
	FormRefusal,
	marked,
	STALE_SAVE,
	useSettingsSave,
	useSubmitting,
	WRITE_FAILED
} from '$lib/admin/settings/settings-card';
import { useSocialLinkLeads } from '$lib/admin/settings/social-link-lead';
import { formPress } from '$lib/admin/unreached';
import {
	insertWhenValid,
	listPress,
	recordVersion,
	useAdminForm,
	useHydrated,
	whichForm
} from '$lib/admin/use-admin-form';
import { defineForm } from '$lib/forms/definition';
import { BANNER_WIDTH_MIN, type BannerAnswer } from '$lib/org/banner';
import type {
	NonprofitFields,
	NonprofitLookupAnswer,
	NonprofitMatch,
	NonprofitSearchAnswer,
	NonprofitStanding
} from '$lib/org/nonprofit-answers';
import { imageSrc } from '$lib/page/image-src';
import { STAFF_USER_ID } from '$lib/server/auth';
import { readSetupState } from '$lib/server/config/setup-state';
import { invalid, parseForm, submittedForm, submittedVersion } from '$lib/server/conform';
import { loadFailed, notFound } from '$lib/server/db/load-failure';
import { redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { toFormValues } from '$lib/server/org/form-values';
import { orgProfileValues, parseOrgProfile, socialLinkRows } from '$lib/server/org/org-input';
import { orgProfileVersion, updateOrgDetails } from '$lib/server/org/queries';
import { database, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.settings_.organisation';

// what this deployment knows about the organisation it serves: its details, logo and banner. one
// card, read as a loader and written by the action below and by the logo's and the banner's own
// addresses (./_app.admin.settings_.logo.ts, ./_app.admin.settings_.banner.ts).
//
// **only the deployer's session reaches this page**, the predicate ./_app.admin.members.tsx reads —
// `context.get(staff).id === STAFF_USER_ID` — read by the loader and by the action alike, and by
// ./_app.tsx to leave the rail's Settings row out for anyone else ($lib/admin/destinations.ts). a
// member's GET and POST are answered with not-found, before the body is read.
//
// **what a profile may hold is `@better-giving/operator/console/org-rules`'s**, run in the browser
// by the form below and again by `parseOrgProfile` ($lib/server/org/org-input.ts), which stays the
// authority. the details and the notification address (./_app.admin.settings_.notifications.tsx)
// are two saves of one row, each written against the version the page was drawn from and naming
// only its own columns ($lib/server/org/queries.ts).

const SCREEN_TITLE = 'Organisation details';

/** the address this screen answers on, and the one a save redirects back to. */
const SCREEN = '/admin/settings/organisation';

/** where the logo is put on and taken off (./_app.admin.settings_.logo.ts). */
const LOGO_ADDRESS = '/admin/settings/logo';

/** where the donation page's banner is put on and taken off (./_app.admin.settings_.banner.ts). */
const BANNER_ADDRESS = '/admin/settings/banner';

/**
 * where "Find your charity" asks: `?q=` searches by name, and `/<ein>` looks one organisation up
 * (./_app.admin.settings_.nonprofits.ts, ./_app.admin.settings_.nonprofits_.$ein.ts).
 */
const NONPROFITS_ADDRESS = '/admin/settings/nonprofits';

/** the details boxes a match picked off the finder's list fills at once, from what it lists. */
const MATCH_BOXES = [
	'legal_name',
	'tax_id',
	'city',
	'region'
] as const satisfies readonly (keyof NonprofitFields & DetailsField)[];

/** the details boxes only a lookup carries, which a pick's own lookup fills after it. */
const ADDRESS_BOXES = [
	'address_line1',
	'postal_code',
	'country'
] as const satisfies readonly (keyof NonprofitFields & DetailsField)[];

/**
 * the details boxes a found lookup of a typed EIN fills; `address_line2` and the rest are left as
 * they stand.
 */
const FOUND_BOXES = [...MATCH_BOXES, ...ADDRESS_BOXES] as const;

/** what a picked match puts in the boxes it fills. */
const matchFields = (
	match: NonprofitMatch
): Pick<NonprofitFields, (typeof MATCH_BOXES)[number]> => ({
	legal_name: match.name,
	tax_id: match.ein,
	city: match.city,
	region: match.state
});

/** the body of a member's not-found. the page the layout draws does not show it; an agent reads it. */
const NOT_HERE =
	`No page at ${SCREEN} for a member’s session. The organisation’s details are the ` +
	'deployer’s: sign in with `ADMIN_PASSWORD` at /login.';

const DETAILS_FORM_ID = 'settings-details';

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

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const state = await readSetupState(context.get(database), context.get(platform).env);
	if (state === null) loadFailed('Settings');

	const { profile } = state;
	// every box the details form states keyed, an absent value as an empty box: the seed is what the
	// save button is armed against ($lib/admin/use-admin-form.ts).
	const stored = profile === null ? {} : toFormValues(profile);
	const details = Object.fromEntries(
		Object.keys(DETAILS_BOXES.shape).map((box) => [box, stored[box as DetailsField] ?? ''])
	) as Record<DetailsField, string>;

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
			banner:
				profile?.bannerImageId == null
					? null
					: { id: profile.bannerImageId, src: imageSrc(profile.bannerImageId) },
			saved: savedSection(landed?.marker ?? null, ['details'] as const),
			// the version the save is written against, carried back in the `<form>`.
			version: orgProfileVersion(profile)
		},
		// a `Set-Cookie` from a loader is sent without this route exporting `headers`.
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

/**
 * the details, every box at once: the schema's refusals and the parser's come back together. **the
 * request body is read exactly once, here** — and not at all for a member, who is answered before
 * it.
 */
export async function action({ context, request }: Route.ActionArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const body = await request.formData();
	submittedForm(body, [DETAILS_FORM_ID]);
	const submission = parseForm(body, DETAILS_FORM);
	const parsed = parseOrgProfile(orgProfileValues(body), socialLinkRows(body));
	if (!parsed.ok || !submission.ok) {
		return invalid(400, submission.reject({ fieldErrors: parsed.ok ? {} : listed(parsed.errors) }));
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

export default function OrganisationDetails({ loaderData, actionData }: Route.ComponentProps) {
	return (
		<>
			<ScreenHeading title={SCREEN_TITLE} />
			<SettingsLayout>
				<DetailsCard data={loaderData} actionData={actionData} />
			</SettingsLayout>
		</>
	);
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

type LoaderData = Route.ComponentProps['loaderData'];

function DetailsCard({
	data: { details, logo, banner, saved, version },
	actionData
}: {
	readonly data: LoaderData;
	readonly actionData: Route.ComponentProps['actionData'];
}) {
	const [form, fields] = useAdminForm(DETAILS_FORM, actionData, { defaultValue: details });
	const hydrated = useHydrated();
	const save = useSettingsSave(
		useSaveState({
			// `!actionData`: a refused write answers with a rejection rather than a redirect, so the
			// marker the last landing published may still be on the page.
			landed: saved === 'details' && !actionData,
			changed: form.dirty,
			pending: useSubmitting(DETAILS_FORM)
		})
	);
	const links = fields[SOCIAL_LINKS_FIELD];
	const linkLead = useSocialLinkLeads();
	const finder = useOrgFinder(details.legal_name === '', JSON.stringify(details));

	// a pick and a found lookup put their values in the boxes as edits, which arm Save details and
	// save nothing.
	const pick = (match: NonprofitMatch) => {
		const values = matchFields(match);
		for (const box of MATCH_BOXES) form.update({ name: fields[box].name, value: values[box] });
		finder.filledFrom(match);
		finder.props.onFetchAddress(match.ein);
	};
	const fill = useEffectEvent((answer: NonprofitLookupAnswer | undefined) => {
		if (answer?.outcome !== 'found') return;
		for (const box of finder.fills)
			form.update({ name: fields[box].name, value: answer.fields[box] });
		finder.filledFrom(answer);
	});
	useEffect(() => {
		fill(finder.lookup);
	}, [finder.lookup]);

	return (
		<section className="ds-card" aria-labelledby={`${form.id}-title`}>
			<header className="ds-card-header">
				<h2 id={`${form.id}-title`}>Organisation details</h2>
			</header>
			<Form method="post" className="ds-card-body adm-stack" {...getFormProps(form)}>
				<input {...whichForm(DETAILS_FORM.id)} />
				<input {...recordVersion(version)} />
				<p className="adm-hint">
					Every receipt carries these. Filled from the IRS list; check the name’s capitals. No form
					goes live until the EIN and registered name are in.
				</p>
				{finder.open ? <OrgFinder {...finder.props} onPick={pick} /> : null}
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
				<BannerControl banner={banner} />
				<FormRefusal errors={form.errors} />
			</Form>
			<footer className="ds-card-footer">
				{finder.open ? null : (
					<Button type="button" variant="quiet" onClick={finder.reopen}>
						{PICK_ANOTHER}
					</Button>
				)}
				<SettingsSave
					state={save}
					form={form.id}
					saveLabel="Save details"
					onDiscard={() => form.reset()}
				/>
			</footer>
		</section>
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
 * a typed EIN's lookup fills every box it carries. a picked match has filled its own boxes already,
 * so its lookup fills the address alone, and an edit made to a picked value while it was out stands.
 *
 * it opens on a profile with no details yet, and otherwise only at "Pick a different
 * organisation". a details save that lands — `seed`, the stored details, changing — puts it away
 * and drops the fill's note, since the boxes then hold what was stored. the profile's version is
 * not the signal: a logo or a banner put on or taken off moves it too, and leaves the finder be.
 */
function useOrgFinder(empty: boolean, seed: string) {
	const searched = useFetcher<NonprofitSearchAnswer>();
	const looked = useFetcher<NonprofitLookupAnswer>();
	const [open, setOpen] = useState(empty);
	const [pressedOpen, setPressedOpen] = useState(false);
	const [filled, setFilled] = useState<NonprofitStanding | null>(null);
	/** the boxes the lookup out, or last answered, fills. */
	const [fills, setFills] = useState<readonly (typeof FOUND_BOXES)[number][]>(FOUND_BOXES);

	const [drawnFrom, setDrawnFrom] = useState(seed);
	if (seed !== drawnFrom) {
		setDrawnFrom(seed);
		setFilled(null);
		if (!empty) setOpen(false);
	}

	const out: FinderOut =
		searched.state !== 'idle' ? 'search' : looked.state !== 'idle' ? 'lookup' : null;

	return {
		open,
		filled,
		fills,
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
				setFills(FOUND_BOXES);
				void looked.load(`${NONPROFITS_ADDRESS}/${ein}`);
			},
			onFetchAddress: (ein: string) => {
				setFills(ADDRESS_BOXES);
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
 * a photo put on as soon as its crop is saved and resized, and taken off at Remove, each a fetcher
 * to its own `address`: neither is part of Save details, and the screen's loaders are read again
 * after either. the logo and the banner are each one of these.
 *
 * the refusal at the press is the latest answer's — a crop, a resize or an upload that failed, the
 * last said as `failed` — and a crop that comes through clears it.
 */
function usePhotoAddress<A extends LogoAnswer | BannerAnswer>(address: string, failed: string) {
	const fetcher = useFetcher<A>();
	const [refused, setRefused] = useState<string | null>(null);

	const [answered, setAnswered] = useState(fetcher.data);
	if (fetcher.data !== answered) {
		setAnswered(fetcher.data);
		if (fetcher.data !== undefined && 'error' in fetcher.data) {
			setRefused(fetcher.data.reason === 'failed' ? failed : fetcher.data.error);
		}
	}

	return {
		state:
			fetcher.state === 'idle'
				? refused === null
					? undefined
					: { refused }
				: fetcher.formMethod === 'DELETE'
					? ('removing' as const)
					: ('uploading' as const),
		onCropped: (result: Cropped) => {
			if (!result.ok) {
				setRefused(result.refused);
				return;
			}
			setRefused(null);
			const body = new FormData();
			body.set('file', result.blob);
			fetcher.submit(body, { method: 'post', action: address, encType: 'multipart/form-data' });
		},
		onRemove: () => {
			setRefused(null);
			fetcher.submit(null, { method: 'delete', action: address });
		}
	};
}

function LogoControl({ logo }: { readonly logo: LoaderData['logo'] }) {
	const hintId = `${useId()}-hint`;
	const photo = usePhotoAddress<LogoAnswer>(
		LOGO_ADDRESS,
		'That didn’t go through. Choose the logo again.'
	);
	return (
		<fieldset className="adm-fieldset" aria-describedby={hintId}>
			<legend className="adm-fieldset__legend">Logo</legend>
			<p className="adm-hint" id={hintId}>
				On each receipt.
			</p>
			<LogoPicker
				src={logo?.src}
				onSquared={photo.onCropped}
				state={photo.state}
				onRemove={photo.onRemove}
			/>
		</fieldset>
	);
}

function BannerControl({ banner }: { readonly banner: LoaderData['banner'] }) {
	const hintId = `${useId()}-hint`;
	const photo = usePhotoAddress<BannerAnswer>(
		BANNER_ADDRESS,
		'That didn’t go through. Choose the banner again.'
	);
	return (
		<fieldset className="adm-fieldset" aria-describedby={hintId}>
			<legend className="adm-fieldset__legend">Banner</legend>
			<p className="adm-hint" id={hintId}>
				The wide picture across the top of your donation page. At least {BANNER_WIDTH_MIN} pixels
				wide, as a PNG, JPEG or WebP. Keep faces and words in the middle: a phone shows the middle 3
				to 1.
			</p>
			<BannerPicker
				src={banner?.src}
				onCropped={photo.onCropped}
				state={photo.state}
				onRemove={photo.onRemove}
			/>
		</fieldset>
	);
}
