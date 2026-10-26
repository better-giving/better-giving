import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished, vi } from 'vitest';
import type { Page } from '$lib/page/catalog';
import { defaultCampaign } from '$lib/page/defaults';
import { editorSections } from '$lib/page/content-edit';
import { SettingsSheet } from './settings-sheet';

// Settings' "Page content" list: a row per section of the draft, reading what it holds and saying
// so where it holds nothing, each opening its own sheet; and Add a photo, drawn only where the
// caller hands it. the sections are the ones the editor lists from a real draft (`editorSections`),
// so the labels and summaries are what a reader meets. the sheets those rows open are
// ./section-edit.dom.spec.tsx's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactElement) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => root.render(node));
	onTestFinished(() => {
		act(() => root.unmount());
		host.remove();
	});
	return host;
}

const rows = (host: HTMLElement) =>
	[...host.querySelectorAll<HTMLButtonElement>('.adm-openrow')].map((row) => ({
		label: row.querySelector('.adm-openrow__label')?.textContent,
		value: row.querySelector('.adm-openrow__value')?.textContent,
		unset: row.querySelector('.adm-openrow__value--unset') !== null,
		row
	}));

const draft = (): Page => ({
	...defaultCampaign(),
	heading: 'Keep 300 kids warm',
	story: {
		type: 'doc',
		content: [
			{ type: 'paragraph', content: [{ type: 'text', text: 'Last winter we gave out coats.' }] }
		]
	},
	hero: { imageId: '0192a4c1-0000-7000-8000-000000000001', alt: 'Volunteers' },
	photos: [{ imageId: '0192a4c1-0000-7000-8000-000000000002', alt: 'A rack of coats' }],
	tiers: [{ amountMinor: 4000, buys: 'one winter coat' }]
});

/** the draft with no cover photo and no questions. */
function bare(): Page {
	const { hero: _hero, faq: _faq, ...rest } = draft();
	return rest;
}

it('lists a row per section in order, each reading what it holds', () => {
	const host = mount(
		<SettingsSheet
			onDismiss={() => {}}
			sections={editorSections(draft(), 'campaign', 'USD')}
			onOpenSection={() => {}}
		/>
	);
	expect(rows(host).map(({ label, value }) => [label, value])).toEqual([
		['Title', 'Keep 300 kids warm'],
		['Story', 'Last winter we gave out coats.'],
		['Cover photo', 'Volunteers'],
		['Photo 1', 'A rack of coats'],
		['Impact tiers', '$40'],
		['Questions', 'None yet']
	]);
});

it('marks a section holding nothing as unset, and only that one', () => {
	const host = mount(
		<SettingsSheet
			onDismiss={() => {}}
			sections={editorSections(bare(), 'campaign', 'USD')}
			onOpenSection={() => {}}
		/>
	);
	expect(
		rows(host)
			.filter((row) => row.unset)
			.map((row) => [row.label, row.value])
	).toEqual([
		['Cover photo', 'No photo yet'],
		['Questions', 'None yet']
	]);
});

it('opens the section of the row pressed, by its id', () => {
	const onOpenSection = vi.fn();
	const host = mount(
		<SettingsSheet
			onDismiss={() => {}}
			sections={editorSections(draft(), 'campaign', 'USD')}
			onOpenSection={onOpenSection}
		/>
	);
	for (const label of ['Photo 1', 'Impact tiers']) {
		act(() =>
			rows(host)
				.find((row) => row.label === label)
				?.row.click()
		);
	}
	expect(onOpenSection.mock.calls).toEqual([['photo-0'], ['tiers']]);
});

it('lists the Donation page’s title alone', () => {
	const host = mount(
		<SettingsSheet
			onDismiss={() => {}}
			sections={editorSections({ ...defaultCampaign(), heading: '' }, 'donation_page', 'USD')}
			onOpenSection={() => {}}
		/>
	);
	expect(rows(host).map(({ label, value }) => [label, value])).toEqual([
		['Title', 'The page’s name']
	]);
});

it('draws Add a photo only where it is handed, and hands the press on', () => {
	const sections = editorSections(draft(), 'campaign', 'USD');
	const without = mount(
		<SettingsSheet onDismiss={() => {}} sections={sections} onOpenSection={() => {}} />
	);
	expect([...without.querySelectorAll('button')].map((one) => one.textContent)).not.toContain(
		'Add a photo'
	);

	const onAddPhoto = vi.fn();
	const withIt = mount(
		<SettingsSheet
			onDismiss={() => {}}
			sections={sections}
			onOpenSection={() => {}}
			onAddPhoto={onAddPhoto}
		/>
	);
	const add = [...withIt.querySelectorAll('button')].find(
		(one) => one.textContent === 'Add a photo'
	);
	act(() => add?.click());
	expect(onAddPhoto).toHaveBeenCalledTimes(1);
});
