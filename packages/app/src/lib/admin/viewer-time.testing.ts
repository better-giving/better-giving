import { vi } from 'vitest';

/**
 * the browser's own zone, as `Intl` resolves it, set to `zone` for the case: what a screen mounted
 * in the browser writes an instant in (`LocalTime` in ./viewer-time.react.tsx), held apart from the
 * machine the suite runs on. `restoreMocks` in packages/app/vitest.config.ts lifts it after.
 */
export function browserIn(zone: string): void {
	const real = Intl.DateTimeFormat.prototype.resolvedOptions;
	vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
		this: Intl.DateTimeFormat
	) {
		return { ...real.call(this), timeZone: zone };
	});
}
