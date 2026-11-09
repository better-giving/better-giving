import { vi } from 'vitest';

// taken before any case spies on it: a second `browserIn` in one case reads the spy from the
// prototype, and a spy that calls itself recurses.
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

/**
 * the browser's own zone, as `Intl` resolves it, set to `zone` for the case: what a screen mounted
 * in the browser writes an instant in (`LocalTime` in ./viewer-time.react.tsx), held apart from the
 * machine the suite runs on. a second call in the case replaces the first. `restoreMocks` in
 * packages/app/vitest.config.ts lifts it after.
 */
export function browserIn(zone: string): void {
	vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
		this: Intl.DateTimeFormat
	) {
		return { ...realResolvedOptions.call(this), timeZone: zone };
	});
}
