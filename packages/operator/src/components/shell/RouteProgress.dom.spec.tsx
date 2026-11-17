import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../render.testing';
import { RouteProgress } from './RouteProgress.jsx';

// the route-load line, as top-bar-css's note drives it: 5% as a navigation starts, toward 95% while
// it runs, 100% as it lands, and gone 300ms later.

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
		act(() => vi.advanceTimersByTime(300));
		expect(line(shown.root)?.getAttribute('aria-valuenow')).toBe('50');
		act(() => vi.advanceTimersByTime(30_000));
		expect(Number(line(shown.root)?.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(95);
	});

	it('lands at 100 and is gone 300ms later', () => {
		const shown = mount(RouteProgress, { busy: true });

		shown.again({ busy: false });
		expect(line(shown.root)?.getAttribute('aria-valuenow')).toBe('100');
		act(() => vi.advanceTimersByTime(300));
		expect(line(shown.root)).toBeNull();
	});
});
