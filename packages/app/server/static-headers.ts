// the headers a static file is served with, read from `_headers` at the root of the directory served
// (../static/_headers, which the build copies into build/client/).
//
// the file's format: a path pattern on a line of its own, then indented `name: value` lines under
// it. `*` matches greedily and `:name` matches one path segment. a request collects the headers of
// every rule whose pattern matches, and a name two rules set is joined with ", ".

export interface HeaderRule {
	readonly pattern: string;
	readonly headers: ReadonlyMap<string, string>;
}

/** `_headers` as rules. names are lowercased: a header name is case-insensitive. */
export function parseHeaders(text: string): HeaderRule[] {
	const rules: { pattern: string; headers: Map<string, string> }[] = [];
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (line.length === 0 || line.startsWith('#')) continue;
		const indented = raw !== raw.trimStart();
		const current = rules.at(-1);
		if (!indented || current === undefined) {
			rules.push({ pattern: line, headers: new Map() });
			continue;
		}
		const colon = line.indexOf(':');
		if (colon === -1) continue;
		current.headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
	}
	return rules;
}

/**
 * whether a rule's pattern covers a path. an absolute-URL pattern is reduced to its path: one
 * deployment answers one host.
 */
export function matches(pattern: string, path: string): boolean {
	const withoutHost = pattern.startsWith('https://')
		? pattern.replace(/^https:\/\/[^/]*/, '') || '/'
		: pattern;
	const source = withoutHost
		.split('')
		.map((character) => {
			if (character === '*') return '.*';
			return /[a-zA-Z0-9/_-]/.test(character) ? character : `\\${character}`;
		})
		.join('')
		.replace(/\\:[a-zA-Z]\w*/g, '[^/]+');
	return new RegExp(`^${source}$`).test(path);
}

/** every header a request for `path` collects. */
export function headersFor(rules: readonly HeaderRule[], path: string): Map<string, string> {
	const collected = new Map<string, string>();
	for (const rule of rules) {
		if (!matches(rule.pattern, path)) continue;
		for (const [name, value] of rule.headers) {
			const before = collected.get(name);
			collected.set(name, before === undefined ? value : `${before}, ${value}`);
		}
	}
	return collected;
}
