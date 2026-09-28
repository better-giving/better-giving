import { act, type ComponentProps, type ReactNode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { type Look, LookControl, type PageLook, UNSEEDED_BRAND } from './look-control';

// what the look control says to a reader and reports to its caller: which choice each face is, which
// axis it belongs to, and the look a pick hands back.
//
// in the dom pool because every claim is a relationship in the tree — the label a radio stands in,
// the group it is named by, the radios sharing its name — and a pick is a press on a real input.
// nothing reads a class or how a face looks.
//
// the arrow keys are the browser's: it walks the radios sharing a `name` inside one form owner and
// no others, and happy-dom performs no such walk. so the case for them asserts what the walk runs
// over — one name per axis, a different one on every other axis — rather than a key press nothing
// here would answer.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORGANISATION: Look = { shade: 'light', corner: 'soft', brandColour: '#1d6b4f' };

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

/** the control holding its own value, as a caller that applies every pick at once does. */
function Held(props: { initial: PageLook; onChange?: (value: PageLook) => void }) {
	const [value, setValue] = useState(props.initial);
	return (
		<LookControl
			mode="page"
			value={value}
			organisation={ORGANISATION}
			onChange={(next) => {
				setValue(next);
				props.onChange?.(next);
			}}
		/>
	);
}

const radios = (root: HTMLElement) => [
	...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')
];

/** a radio's name as a reader hears it: the text of the label it stands in, the marks left out. */
const nameOf = (radio: HTMLInputElement) => radio.closest('label')?.textContent?.trim();

/** the name of the group a radio is in: its fieldset's legend. */
const groupOf = (radio: HTMLInputElement) =>
	radio.closest('fieldset')?.querySelector('legend')?.textContent?.trim();

const radio = (root: HTMLElement, name: string) => {
	const found = radios(root).find((r) => nameOf(r) === name);
	if (!found) throw new Error(`no choice named ${name}`);
	return found;
};

const press = (input: HTMLInputElement) => act(() => input.click());

const well = (root: HTMLElement) => {
	const found = root.querySelector<HTMLInputElement>('input[type="color"]');
	if (!found) throw new Error('no brand colour');
	return found;
};

/** what a reader hears after the well's name: the text its `aria-describedby` points at. */
const describedAs = (input: HTMLInputElement) =>
	(input.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.map((id) => (id ? document.getElementById(id)?.textContent : null))
		.filter(Boolean)
		.join(' ');

/** the operator settling on a colour in the picker. */
const settleOn = (input: HTMLInputElement, hex: string) =>
	act(() => {
		input.value = hex;
		input.dispatchEvent(new Event('change', { bubbles: true }));
	});

describe('on a page', () => {
	const page = (props: Partial<ComponentProps<typeof Held>> = {}) =>
		mount(<Held initial={{ source: 'organisation' }} {...props} />);

	it('names every preset, and the axis it is on', () => {
		const root = page();
		expect(radios(root).map((r) => [groupOf(r), nameOf(r)])).toEqual([
			['Colour', 'Organisation'],
			['Colour', 'Custom'],
			['Shade', 'Light'],
			['Shade', 'Warm'],
			['Shade', 'Cool'],
			['Corners', 'Square'],
			['Corners', 'Soft'],
			['Corners', 'Round']
		]);
		// the palette mark beside Custom is a picture of the word, not a second name for it.
		const mark = radio(root, 'Custom').closest('label')?.querySelector('svg');
		expect(mark?.getAttribute('aria-hidden')).toBe('true');
	});

	it('gives every axis one name its radios share and no other axis uses', () => {
		const root = page();
		const byAxis = Map.groupBy(radios(root), (r) => groupOf(r));
		const names = [...byAxis.values()].map((axis) => new Set(axis.map((r) => r.name)));
		expect(names.map((n) => n.size)).toEqual([1, 1, 1]);
		expect(new Set(names.map((n) => [...n][0])).size).toBe(3);
	});

	it('holds one choice per axis, and shows the organisation look while it follows it', () => {
		const root = page();
		expect(
			radios(root)
				.filter((r) => r.checked)
				.map(nameOf)
		).toEqual(['Organisation', 'Light', 'Soft']);
	});

	it('gives the page its own look when a shade is picked, changing only the shade', () => {
		const onChange = vi.fn();
		const root = page({ onChange });
		press(radio(root, 'Warm'));
		expect(onChange).toHaveBeenLastCalledWith({ source: 'custom', ...ORGANISATION, shade: 'warm' });
		expect(
			radios(root)
				.filter((r) => r.checked)
				.map(nameOf)
		).toEqual(['Custom', 'Warm', 'Soft']);
	});

	it('changes only the corner when a corner is picked', () => {
		const onChange = vi.fn();
		const root = page({
			initial: { source: 'custom', shade: 'cool', corner: 'soft', brandColour: '#8a3b12' },
			onChange
		});
		press(radio(root, 'Round'));
		expect(onChange).toHaveBeenLastCalledWith({
			source: 'custom',
			shade: 'cool',
			corner: 'round',
			brandColour: '#8a3b12'
		});
	});

	it('goes back to the organisation look whole', () => {
		const onChange = vi.fn();
		const root = page({
			initial: { source: 'custom', shade: 'cool', corner: 'round', brandColour: '#8a3b12' },
			onChange
		});
		press(radio(root, 'Organisation'));
		expect(onChange).toHaveBeenLastCalledWith({ source: 'organisation' });
		expect(
			radios(root)
				.filter((r) => r.checked)
				.map(nameOf)
		).toEqual(['Organisation', 'Light', 'Soft']);
	});

	it('starts Custom from the organisation look, and opens its brand colour', () => {
		const onChange = vi.fn();
		const root = page({ onChange });
		expect(root.querySelector('input[type="color"]')).toBeNull();
		press(radio(root, 'Custom'));
		expect(onChange).toHaveBeenLastCalledWith({ source: 'custom', ...ORGANISATION });
		const colour = root.querySelector<HTMLInputElement>('input[type="color"]');
		expect(colour?.value).toBe('#1d6b4f');
		expect(colour?.labels?.[0]?.textContent).toBe('Brand colour');
	});

	it('reports a settled colour in lowercase, on the change and not on the drag', () => {
		const onChange = vi.fn();
		const root = page({
			initial: { source: 'custom', shade: 'light', corner: 'soft', brandColour: '#8a3b12' },
			onChange
		});
		const colour = root.querySelector<HTMLInputElement>('input[type="color"]');
		if (!colour) throw new Error('no brand colour');
		act(() => {
			colour.value = '#AA3300';
			colour.dispatchEvent(new Event('input', { bubbles: true }));
		});
		expect(onChange).not.toHaveBeenCalled();
		act(() => {
			colour.dispatchEvent(new Event('change', { bubbles: true }));
		});
		expect(onChange).toHaveBeenLastCalledWith({
			source: 'custom',
			shade: 'light',
			corner: 'soft',
			brandColour: '#aa3300'
		});
	});

	it('writes the Organisation chip in the ink its brand colour takes', () => {
		const chip = (brandColour: string) =>
			radio(
				mount(
					<LookControl
						mode="page"
						value={{ source: 'organisation' }}
						organisation={{ ...ORGANISATION, brandColour }}
						onChange={() => {}}
					/>
				),
				'Organisation'
			)
				.closest('label')
				?.getAttribute('data-ink');
		expect(chip('#1d6b4f')).toBe('light');
		expect(chip('#f5d90a')).toBe('dark');
	});

	it('fills the Organisation chip with the donor page’s unseeded ink when it has no colour', () => {
		const root = mount(
			<LookControl
				mode="page"
				value={{ source: 'organisation' }}
				organisation={{ ...ORGANISATION, brandColour: null }}
				onChange={() => {}}
			/>
		);
		const chip = radio(root, 'Organisation').closest('label');
		expect(chip?.getAttribute('data-ink')).toBe('light');
		expect(chip?.style.background).toBe(UNSEEDED_BRAND);
	});

	it('keeps a Custom look with no colour colourless through a corner pick', () => {
		const onChange = vi.fn();
		const root = page({
			initial: { source: 'custom', shade: 'cool', corner: 'soft', brandColour: null },
			onChange
		});
		expect(describedAs(well(root))).toBe('No colour set');
		press(radio(root, 'Round'));
		expect(onChange).toHaveBeenLastCalledWith({
			source: 'custom',
			shade: 'cool',
			corner: 'round',
			brandColour: null
		});
	});
});

describe('on the organisation page', () => {
	function organisationPage(onChange = vi.fn(), initial: Look = ORGANISATION) {
		function Own() {
			const [value, setValue] = useState(initial);
			return (
				<LookControl
					mode="organisation"
					value={value}
					onChange={(next) => {
						setValue(next);
						onChange(next);
					}}
				/>
			);
		}
		return mount(<Own />);
	}

	it('offers no Organisation choice: it is the organisation look', () => {
		const root = organisationPage();
		expect(radios(root).map((r) => [groupOf(r), nameOf(r)])).toEqual([
			['Shade', 'Light'],
			['Shade', 'Warm'],
			['Shade', 'Cool'],
			['Corners', 'Square'],
			['Corners', 'Soft'],
			['Corners', 'Round']
		]);
		const colour = root.querySelector<HTMLInputElement>('input[type="color"]');
		expect(colour?.labels?.[0]?.textContent).toBe('Brand colour');
	});

	it('reports the look itself, with no source', () => {
		const onChange = vi.fn();
		const root = organisationPage(onChange);
		press(radio(root, 'Cool'));
		expect(onChange).toHaveBeenLastCalledWith({ ...ORGANISATION, shade: 'cool' });
		expect(
			radios(root)
				.filter((r) => r.checked)
				.map(nameOf)
		).toEqual(['Cool', 'Soft']);
	});

	it('draws a look with no brand colour as No colour set, and only a set colour clears it', () => {
		const root = organisationPage(vi.fn(), { ...ORGANISATION, brandColour: null });
		const colour = well(root);
		expect(colour.labels?.[0]?.textContent).toBe('Brand colour');
		expect(describedAs(colour)).toBe('No colour set');
		expect(colour.hasAttribute('data-empty')).toBe(true);
	});

	it('reports no colour, not the one the picker opens on, when a shade is picked', () => {
		const onChange = vi.fn();
		const root = organisationPage(onChange, { ...ORGANISATION, brandColour: null });
		press(radio(root, 'Warm'));
		expect(onChange).toHaveBeenLastCalledWith({
			...ORGANISATION,
			shade: 'warm',
			brandColour: null
		});
		expect(describedAs(well(root))).toBe('No colour set');
	});

	it('sets a colour from none in lowercase, and stops saying none is set', () => {
		const onChange = vi.fn();
		const root = organisationPage(onChange, { ...ORGANISATION, brandColour: null });
		settleOn(well(root), '#AA3300');
		expect(onChange).toHaveBeenLastCalledWith({ ...ORGANISATION, brandColour: '#aa3300' });
		expect(describedAs(well(root))).toBe('');
		expect(well(root).hasAttribute('data-empty')).toBe(false);
	});
});
