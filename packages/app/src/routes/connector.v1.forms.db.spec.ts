import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { page } from '$lib/server/db/schema';
import { archiveForm } from '$lib/server/forms/queries';
import { createCampaign } from '$lib/server/pages/campaign';
import { connectorHarness, under } from '../connector-routes.testing';
import * as form from './connector.v1.forms.$id';
import * as forms from './connector.v1.forms._index';
import * as hello from './connector.v1.hello';

// the form actions of `/connector/v1`: the dashboard's Forms screens in the connector's terms.

const h = connectorHarness(() => ({
	forms: under('forms', forms),
	form: under('forms/:id', form),
	hello: under('hello', hello)
}));
const { call, connect } = h;

const usd = (amount: string) => ({ amount, currency: 'USD' });
const MISSING = 'frm_missing0000000000';

async function made(key: string, body: Record<string, unknown> = {}): Promise<{ id: string }> {
	const response = await call('forms', '/forms', {
		method: 'POST',
		key,
		body: { name: 'Spring appeal', ...body }
	});
	expect(response.status).toBe(201);
	return (await response.json()) as { id: string };
}

/** the settings row a new campaign owns, and the campaign's id. */
async function campaignForm(): Promise<{ formId: string; campaignId: string }> {
	const { pageId } = await createCampaign(h.db, { name: 'Winter coats' });
	const [row] = await h.db.select({ formId: page.formId }).from(page).where(eq(page.id, pageId));
	if (!row?.formId) throw new Error('a new campaign owns a form');
	return { formId: row.formId, campaignId: pageId };
}

describe('forms.list and forms.get', () => {
	it('lists the forms oldest first, a page at a time, including a page’s own', async () => {
		const key = await connect();
		const first = await made(key, { name: 'Spring appeal' });
		const second = await made(key, { name: 'Year-end' });
		const { formId, campaignId } = await campaignForm();

		const one = await call('forms', '/forms?limit=1', { key });
		expect(one.status).toBe(200);
		const page1 = (await one.json()) as { data: { id: string }[]; next_cursor: string | null };
		expect(page1.data).toEqual([first]);
		const two = await call('forms', `/forms?limit=1&cursor=${page1.next_cursor}`, { key });
		const page2 = (await two.json()) as { data: { id: string }[]; next_cursor: string | null };
		expect(page2.data).toEqual([second]);
		const rest = await call('forms', `/forms?cursor=${page2.next_cursor}`, { key });
		const tail = (await rest.json()) as {
			data: { id: string; name: string; campaign_id: string | null }[];
			next_cursor: string | null;
		};
		expect(tail.next_cursor).toBeNull();
		expect(tail.data.map((form) => [form.name, form.campaign_id])).toEqual([
			['Donation page', null],
			['Winter coats', campaignId]
		]);
		expect(tail.data.map((form) => form.id)).toContain(formId);
	});

	it('answers one form by id, and a campaign’s own with its campaign_id', async () => {
		const key = await connect();
		const form = await made(key);
		const { formId, campaignId } = await campaignForm();

		const read = await call('form', `/forms/${form.id}`, { key });
		expect(read.status).toBe(200);
		expect(await read.json()).toEqual(form);
		const owned = await call('form', `/forms/${formId}`, { key });
		expect(await owned.json()).toMatchObject({ id: formId, campaign_id: campaignId });
	});

	it('answers an id no form has with not_found', async () => {
		const key = await connect();

		const response = await call('form', `/forms/${MISSING}`, { key });

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ code: 'not_found' });
	});
});

describe('forms.create', () => {
	it('makes a form from a name alone, on the dashboard’s defaults', async () => {
		const key = await connect();

		const response = await call('forms', '/forms', {
			method: 'POST',
			key,
			body: { name: 'Spring appeal' }
		});

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			id: expect.any(String),
			name: 'Spring appeal',
			status: 'draft',
			suggested_amounts: [usd('25.00'), usd('50.00'), usd('100.00')],
			minimum: usd('1.00'),
			maximum: usd('10000.00'),
			allowed_origins: [],
			gifts_go_to: { mode: 'none', program_id: null },
			campaign_id: null,
			updated_at: expect.any(String)
		});
	});

	it('refuses an amount below the floor at its wire path, and makes nothing', async () => {
		const key = await connect();

		const response = await call('forms', '/forms', {
			method: 'POST',
			key,
			body: { name: 'Spring appeal', minimum: usd('0.10') }
		});

		expect(response.status).toBe(422);
		const problem = (await response.json()) as { code: string; errors: { path: string }[] };
		expect(problem.code).toBe('invalid');
		expect(problem.errors.map((e) => e.path)).toEqual(['minimum.amount']);
		const list = await call('forms', '/forms', { key });
		expect(((await list.json()) as { data: unknown[] }).data).toEqual([]);
	});
	it('makes a draft while the organisation’s EIN is missing, as Add a donation form saves one', async () => {
		const key = await connect();
		await h.db.run(sql`update org_profile set tax_id = null`);

		const response = await call('forms', '/forms', {
			method: 'POST',
			key,
			body: { name: 'Spring appeal' }
		});

		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({ name: 'Spring appeal', status: 'draft' });
	});

	it('refuses a live form while the organisation’s EIN is missing, and makes nothing', async () => {
		const key = await connect();
		await h.db.run(sql`update org_profile set tax_id = null`);

		const response = await call('forms', '/forms', {
			method: 'POST',
			key,
			body: { name: 'Spring appeal', status: 'live' }
		});

		expect(response.status).toBe(409);
		const problem = (await response.json()) as { code: string; detail: string };
		expect(problem.code).toBe('not_ready');
		expect(problem.detail).toMatch(/Organisation details in Settings/);
		const list = await call('forms', '/forms', { key });
		expect(((await list.json()) as { data: unknown[] }).data).toEqual([]);
	});
});

describe('forms.update', () => {
	it('renames a form and publishes it, answering the form as saved', async () => {
		const key = await connect();
		const form = await made(key);

		const response = await call('form', `/forms/${form.id}`, {
			method: 'PATCH',
			key,
			body: { name: 'Spring appeal 2027', status: 'live', confirm: true }
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id: form.id,
			name: 'Spring appeal 2027',
			status: 'live',
			suggested_amounts: [usd('25.00'), usd('50.00'), usd('100.00')]
		});
		const read = await call('form', `/forms/${form.id}`, { key });
		expect(await read.json()).toMatchObject({ name: 'Spring appeal 2027', status: 'live' });
	});

	it('replaces the suggested amounts and the bounds', async () => {
		const key = await connect();
		const form = await made(key);

		const response = await call('form', `/forms/${form.id}`, {
			method: 'PATCH',
			key,
			body: { suggested_amounts: [usd('10'), usd('20.50')], maximum: usd('500') }
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			suggested_amounts: [usd('10.00'), usd('20.50')],
			minimum: usd('1.00'),
			maximum: usd('500.00')
		});
	});

	it('changes a draft form’s amounts with no confirm, since no donor sees a draft', async () => {
		const key = await connect();
		const form = await made(key);

		const response = await call('form', `/forms/${form.id}`, {
			method: 'PATCH',
			key,
			body: { minimum: usd('5') }
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ status: 'draft', minimum: usd('5.00') });
	});

	it.each([
		['its amounts', { suggested_amounts: [usd('15')] }, { suggested_amounts: [usd('15.00')] }],
		['its sites', { allowed_origins: [] }, { allowed_origins: [] }],
		['it to draft', { status: 'draft' }, { status: 'draft' }]
	] as const)(
		'refuses changing %s on a live form until confirm is true, then saves',
		async (_, edit, saved) => {
			const key = await connect();
			await h.db.run(
				sql`insert into site (id, origin, position, created_at, updated_at) values ('site-1', 'https://www.example.org', 0, 0, 0)`
			);
			const form = await made(key, {
				status: 'live',
				allowed_origins: ['https://www.example.org']
			});
			const before = await (await call('form', `/forms/${form.id}`, { key })).json();

			const refused = await call('form', `/forms/${form.id}`, { method: 'PATCH', key, body: edit });

			expect(refused.status).toBe(422);
			const problem = (await refused.json()) as {
				code: string;
				detail: string;
				errors: { path: string }[];
			};
			expect(problem).toMatchObject({ code: 'invalid', errors: [{ path: 'confirm' }] });
			expect(problem.detail).toContain('ask the operator');
			expect(await (await call('form', `/forms/${form.id}`, { key })).json()).toEqual(before);

			const confirmed = await call('form', `/forms/${form.id}`, {
				method: 'PATCH',
				key,
				body: { ...edit, confirm: true }
			});

			expect(confirmed.status).toBe(200);
			expect(await confirmed.json()).toMatchObject(saved);
		}
	);

	it('refuses setting a draft form live until confirm is true', async () => {
		const key = await connect();
		const form = await made(key);

		const refused = await call('form', `/forms/${form.id}`, {
			method: 'PATCH',
			key,
			body: { status: 'live' }
		});

		expect(refused.status).toBe(422);
		expect(await refused.json()).toMatchObject({ code: 'invalid', errors: [{ path: 'confirm' }] });
		const read = await call('form', `/forms/${form.id}`, { key });
		expect(await read.json()).toMatchObject({ status: 'draft' });
	});

	it('refuses setting a form live while no processor is set up, changing nothing', async () => {
		const key = await connect();
		const form = await made(key);

		const refused = await call('form', `/forms/${form.id}`, {
			method: 'PATCH',
			key,
			body: { status: 'live', confirm: true },
			env: { STRIPE_SECRET_KEY: undefined, STRIPE_PUBLISHABLE_KEY: undefined }
		});

		expect(refused.status).toBe(422);
		const problem = (await refused.json()) as {
			code: string;
			errors: { path: string; message: string }[];
		};
		expect(problem.code).toBe('invalid');
		expect(problem.errors.map((e) => e.path)).toEqual(['status']);
		expect(problem.errors[0]?.message).toMatch(/no payment processor/);
		const read = await call('form', `/forms/${form.id}`, { key });
		expect(await read.json()).toMatchObject({ status: 'draft' });
	});

	it('renames a live form with no confirm, since a form’s name reaches no donor', async () => {
		const key = await connect();
		const form = await made(key, { status: 'live' });

		const response = await call('form', `/forms/${form.id}`, {
			method: 'PATCH',
			key,
			body: { name: 'Spring appeal 2027' }
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ name: 'Spring appeal 2027', status: 'live' });
	});

	it('refuses a body naming only confirm as naming no field to change', async () => {
		const key = await connect();
		const form = await made(key, { status: 'live' });

		const response = await call('form', `/forms/${form.id}`, {
			method: 'PATCH',
			key,
			body: { confirm: true }
		});

		expect(response.status).toBe(422);
		const problem = (await response.json()) as { errors: { path: string; message: string }[] };
		expect(problem.errors).toEqual([
			{ path: '', message: expect.stringContaining('names no field') }
		]);
	});

	it('sets the sites a form loads on, out of the deployment’s listed ones', async () => {
		const key = await connect();
		const form = await made(key);
		await h.db.run(
			sql`insert into site (id, origin, position, created_at, updated_at) values ('site-1', 'https://www.example.org', 0, 0, 0)`
		);

		const response = await call('form', `/forms/${form.id}`, {
			method: 'PATCH',
			key,
			body: { allowed_origins: ['https://www.example.org'] }
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ allowed_origins: ['https://www.example.org'] });
	});

	it('writes nothing when one field of several is refused, naming it', async () => {
		const key = await connect();
		const form = await made(key);
		const before = await (await call('form', `/forms/${form.id}`, { key })).json();

		const response = await call('form', `/forms/${form.id}`, {
			method: 'PATCH',
			key,
			body: {
				name: 'Renamed',
				suggested_amounts: [usd('30')],
				allowed_origins: ['https://not-listed.example']
			}
		});

		expect(response.status).toBe(422);
		const problem = (await response.json()) as { code: string; errors: { path: string }[] };
		expect(problem.code).toBe('invalid');
		expect(problem.errors.map((e) => e.path)).toEqual(['allowed_origins']);
		const after = await (await call('form', `/forms/${form.id}`, { key })).json();
		expect(after).toEqual(before);
	});

	it('refuses a campaign’s own form as page_owned, changing nothing', async () => {
		const key = await connect();
		const { formId } = await campaignForm();

		const response = await call('form', `/forms/${formId}`, {
			method: 'PATCH',
			key,
			body: { name: 'Renamed' }
		});

		expect(response.status).toBe(409);
		const problem = (await response.json()) as { code: string; detail: string };
		expect(problem.code).toBe('page_owned');
		expect(problem.detail).toContain('Winter coats');
	});

	it('answers an archived form as not_found', async () => {
		const key = await connect();
		const form = await made(key);
		await archiveForm(h.db, form.id);

		const response = await call('form', `/forms/${form.id}`, {
			method: 'PATCH',
			key,
			body: { name: 'Renamed' }
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ code: 'not_found' });
	});
});

describe('the surface', () => {
	it('refuses a call with no key', async () => {
		const response = await call('forms', '/forms');

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: 'key_refused' });
	});

	it('lists the four form actions in hello, and no archive', async () => {
		const { actions } = (await (await call('hello', '/hello')).json()) as { actions: string[] };

		expect(actions).toEqual(
			expect.arrayContaining(['forms.list', 'forms.get', 'forms.create', 'forms.update'])
		);
		expect(actions.filter((action) => action.startsWith('forms.'))).toHaveLength(4);
	});
});
