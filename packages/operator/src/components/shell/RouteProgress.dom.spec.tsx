import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../render.testing';
import { RouteProgress } from './RouteProgress.jsx';

// the route-load line, as top-bar-css's note drives it: 5% as a navigation starts, toward 95% while
// it runs, 100% as it lands, and gone `--duration-slow` later; and the polite status a reader hears
// a navigation start in.

// the registry's own `--duration-slow`, read off the copied sheet rather than restated, so a
// retuned token turns these cases red where the component's pace would otherwise be left behind.
const SLOW_MS = (() => {
	const sheet = readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), '../../registry/styles/variables.css'),
		'utf8'
	);
	const found = /--duration-slow:\s*(\d+)ms/.exec(sheet);
	if (found === null) throw new Error('variables.css declares no --duration-slow in ms');
	return Number(found[1]);
})();

describe('the route-progress line', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	const line = (root: HTMLElement) => root.querySelector('.ds-route-progress');

	it('is not drawn with no navigation running', () => {
		const shown = mount(RouteProgress, { busy: false });

		expect(line(shown.root)).toBeNull();
	});

	it('starts at 5, runs toward 95 and never reaches it while the navigation runs', () => {
		const shown = mount(RouteProgress, { busy: true });

		expect(line(shown.root)?.getAttribute('aria-valuenow')).toBe('5');
		expect(line(shown.root)?.getAttribute('aria-label')).toBe('Loading page');
		act(() => vi.advanceTimersByTime(SLOW_MS));
		expect(line(shown.root)?.getAttribute('aria-valuenow')).toBe('50');
		act(() => vi.advanceTimersByTime(30_000));
		expect(Number(line(shown.root)?.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(95);
	});

	it('lands at 100 and is gone the registry’s slow duration later', () => {
		const shown = mount(RouteProgress, { busy: true });

		shown.again({ busy: false });
		expect(line(shown.root)?.getAttribute('aria-valuenow')).toBe('100');
		act(() => vi.advanceTimersByTime(SLOW_MS - 1));
		expect(line(shown.root)).not.toBeNull();
		act(() => vi.advanceTimersByTime(1));
		expect(line(shown.root)).toBeNull();
	});

	it('starts again from 5 when a navigation begins while the last one fades', () => {
		const shown = mount(RouteProgress, { busy: true });
		shown.again({ busy: false });
		act(() => vi.advanceTimersByTime(SLOW_MS / 2));

		shown.again({ busy: true });
		act(() => vi.advanceTimersByTime(SLOW_MS / 2));

		expect(shown.root.querySelectorAll('.ds-route-progress')).toHaveLength(1);
		expect(line(shown.root)?.getAttribute('aria-valuenow')).toBe('5');
	});
});

describe('the navigation’s status', () => {
	const status = (root: HTMLElement) => root.querySelector('[role="status"]');

	it('stands in the page, empty, while no navigation runs', () => {
		const shown = mount(RouteProgress, { busy: false });

		expect(status(shown.root)?.getAttribute('aria-live')).toBe('polite');
		expect(status(shown.root)?.className).toBe('ds-sr-only');
		expect(status(shown.root)?.textContent).toBe('');
	});

	it('says a navigation has started into the region already standing, and empties as it lands', () => {
		const shown = mount(RouteProgress, { busy: false });
		const region = status(shown.root);

		shown.again({ busy: true });
		expect(status(shown.root)).toBe(region);
		expect(region?.textContent).toBe('Loading page');

		shown.again({ busy: false });
		expect(region?.textContent).toBe('');

		shown.again({ busy: true });
		expect(region?.textContent).toBe('Loading page');
	});
});
