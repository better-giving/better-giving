import { AI_MODELS, FREE_MODEL } from '@better-giving/operator/ai-models';
import { createElement } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeployedVar, ModelCredits } from '../api/types';
import { MODEL_INTENT, modelEdit } from './ai-model';
import { ModelSection, type ModelSectionProps } from './ai-model-section';

// the model page's section as markup: the choices in the list's order and what each is marked, the
// one the deployment holds ticked, what the press posts for each, and the credits line held and not
// read. the readings themselves are ./ai-model.spec.ts's. ../../vite.config.ts pins `node` and there
// is no dom, so a press is never made here: what is held is that the form it submits carries each
// choice under the name and intent the route reads (`modelEdit`).

const CLAUDE = 'anthropic/claude-sonnet-4.6';
const UNREAD =
	"This console's Cloudflare sign-in cannot read the account's credits. If they run out, the chat answers from the free model and says so.";

const stored = (value: string): DeployedVar => ({ name: 'AI_MODEL', kind: 'value', value });

async function drawn(over: Partial<ModelSectionProps> = {}): Promise<string> {
	const props: ModelSectionProps = {
		model: stored(CLAUDE),
		credits: { kind: 'held', balance: 12.5 },
		withheld: [],
		written: null,
		freed: null,
		workerName: 'better-giving',
		accountName: 'Riverbank Trust',
		busy: false,
		pending: null,
		...over
	};
	// `Form` reads the router it is drawn in.
	const router = createMemoryRouter([
		{ path: '/', Component: () => createElement(ModelSection, props) }
	]);
	const { prelude } = await prerenderToNodeStream(createElement(RouterProvider, { router }));
	let page = '';
	for await (const chunk of prelude) page += chunk;
	return page;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'" };
const text = (markup: string) =>
	markup
		.replace(/<[^>]*>/g, '')
		.replace(/&(amp|lt|gt|quot|#x27);/g, (whole, name: string) => ENTITIES[name] ?? whole);

type Choice = { attrs: Record<string, string>; label: string; mark: string };

/** each choice as its radio's attributes, the words naming it and the line under it. */
function choices(page: string): Choice[] {
	const row =
		/<label class="adm-check[^"]*"><input ([^>]*)\/><span class="adm-check__text"[^>]*>(.*?)<\/span><span class="adm-check__(?:sub|note)"[^>]*>(.*?)<\/span><\/label>/g;
	return [...page.matchAll(row)].map(([, attrs = '', label = '', mark = '']) => ({
		attrs: Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
		label: text(label),
		mark: text(mark)
	}));
}

const ticked = (page: string) =>
	choices(page)
		.filter((choice) => 'checked' in choice.attrs)
		.map((choice) => choice.attrs.value);

/** the value a statement on the section stands at, by its label. */
function stated(page: string, label: string): string | null {
	const found = new RegExp(
		`<span class="adm-stated__label">${label}</span><span class="adm-stated__value[^"]*">(.*?)</span>`
	).exec(page);
	return found?.[1] === undefined ? null : text(found[1]);
}

describe('the model section', () => {
	it('draws every model in the list’s order, the free one marked Free and the rest as needing credits', async () => {
		const drawnChoices = choices(await drawn()).map(({ label, mark }) => [label, mark]);
		expect(drawnChoices).toEqual(
			AI_MODELS.map((model) => [
				model.label,
				model.creditBilled ? 'Needs Cloudflare credits' : 'Free'
			])
		);
		expect(drawnChoices[0]).toEqual([FREE_MODEL.label, 'Free']);
	});

	it('ticks the model the deployment holds', async () => {
		expect(ticked(await drawn({ model: stored(CLAUDE) }))).toEqual([CLAUDE]);
	});

	it('ticks the free model where nothing is stored', async () => {
		const absent: DeployedVar = { name: 'AI_MODEL', kind: 'absent' };
		expect(ticked(await drawn({ model: absent }))).toEqual([FREE_MODEL.id]);
	});

	it('ticks nothing for a stored id off the list, and says which one it holds', async () => {
		const page = await drawn({ model: stored('openai/gpt-4') });
		expect(ticked(page)).toEqual([]);
		expect(text(page)).toContain(
			'This deployment holds openai/gpt-4, which this console doesn’t offer'
		);
	});

	it('posts each choice under the name and intent the press is read by', async () => {
		const page = await drawn();
		const press = /<button [^>]*>/.exec(page)?.[0] ?? '';
		expect(press).toContain('name="intent"');
		expect(press).toContain(`value="${MODEL_INTENT}"`);

		const edits = choices(page).map(({ attrs }) => {
			const body = new FormData();
			body.set(attrs.name ?? '', attrs.value ?? '');
			return modelEdit(body);
		});
		expect(edits).toEqual(
			AI_MODELS.map((model) => ({ AI_MODEL: model.id === FREE_MODEL.id ? null : model.id }))
		);
	});

	it('states the balance the account holds under the choices', async () => {
		const credits: ModelCredits = { kind: 'held', balance: 12.5 };
		expect(stated(await drawn({ credits }), 'Cloudflare credits')).toBe('$12.50');
	});

	it('says the balance was not read, as the binary said it, and states no figure', async () => {
		const page = await drawn({ credits: { kind: 'unknown', detail: UNREAD } });
		expect(stated(page, 'Cloudflare credits')).toBeNull();
		expect(text(page)).toContain(UNREAD);
	});
});
