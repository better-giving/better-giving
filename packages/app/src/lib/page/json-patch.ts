// RFC 6902 (JSON Patch) and RFC 7396 (JSON Merge Patch) over plain JSON, the two ways a chat reply
// edits a draft (./accept-reply.ts). pure: the document handed in is never changed, and a patch
// lands whole or not at all.
//
// every member is written with `Object.defineProperty` and read only where it is the value's own,
// so a pointer or a merge naming `__proto__` names a member like any other rather than an
// object's prototype.

type PatchOp =
	| { op: 'add' | 'replace' | 'test'; path: string; value: unknown }
	| { op: 'remove'; path: string }
	| { op: 'move' | 'copy'; from: string; path: string };

/** how large a document an edit may leave: its bytes as JSON, and how many levels it nests. */
export type Bounds = { bytes: number; depth: number; what: string };

type Applied = { ok: true; doc: unknown } | { ok: false; message: string };
type Container = Record<string, unknown> | unknown[];

/** the document is measured after every operation, so a patch that grows it is stopped as it grows. */
export function applyPatch(doc: unknown, ops: readonly PatchOp[], bounds: Bounds): Applied {
	let result = structuredClone(doc);
	for (const [index, op] of ops.entries()) {
		const refused = (message: string): Applied => ({
			ok: false,
			message: `operation ${index + 1} (${op.op} ${op.path}): ${message}`
		});
		const applied = applyOp(result, op);
		if (!applied.ok) return refused(applied.message);
		const over = outOfBounds(applied.doc, bounds);
		if (over !== null) return refused(over);
		result = applied.doc;
	}
	return { ok: true, doc: result };
}

/** why `doc` is past `bounds`, or null when it is within them. */
export function outOfBounds(doc: unknown, { bytes, depth, what }: Bounds): string | null {
	if (deeperThan(doc, depth)) return `${what} would nest deeper than ${depth}`;
	const size = new TextEncoder().encode(JSON.stringify(doc) ?? '').byteLength;
	return size > bytes ? `${what} would be over ${bytes} bytes` : null;
}

/** whether `value` holds objects or lists more than `depth` levels deep, walked without recursion. */
export function deeperThan(value: unknown, depth: number): boolean {
	const pending: [unknown, number][] = [[value, 0]];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		const [item, level] = next;
		if (typeof item !== 'object' || item === null) continue;
		if (level + 1 > depth) return true;
		for (const child of Object.values(item)) pending.push([child, level + 1]);
	}
	return false;
}

function applyOp(doc: unknown, op: PatchOp): Applied {
	const path = pointer(op.path);
	if (path === null) return { ok: false, message: 'a path is "" or starts with "/"' };
	switch (op.op) {
		case 'add':
			return add(doc, path, structuredClone(op.value));
		case 'remove':
			return remove(doc, path);
		case 'replace': {
			const removed = remove(doc, path);
			return removed.ok ? add(removed.doc, path, structuredClone(op.value)) : removed;
		}
		case 'move':
		case 'copy': {
			const from = pointer(op.from);
			if (from === null) return { ok: false, message: 'a from is "" or starts with "/"' };
			const value = valueAt(doc, from);
			if (value === NOT_THERE) return { ok: false, message: `nothing is at ${op.from}` };
			if (op.op === 'copy') return add(doc, path, structuredClone(value));
			if (op.path.startsWith(`${op.from}/`)) {
				return { ok: false, message: 'a value cannot move into itself' };
			}
			const removed = remove(doc, from);
			return removed.ok ? add(removed.doc, path, value) : removed;
		}
		case 'test':
			return jsonEqual(valueAt(doc, path), op.value)
				? { ok: true, doc }
				: { ok: false, message: 'the value there is not the one tested' };
	}
}

function remove(doc: unknown, path: string[]): Applied {
	const key = path.at(-1);
	if (key === undefined) return { ok: true, doc: undefined };
	const parent = valueAt(doc, path.slice(0, -1));
	if (valueAt(parent, [key]) === NOT_THERE) return { ok: false, message: 'nothing is there' };
	if (Array.isArray(parent)) parent.splice(Number(key), 1);
	else delete (parent as Record<string, unknown>)[key];
	return { ok: true, doc };
}

function add(doc: unknown, path: string[], value: unknown): Applied {
	const key = path.at(-1);
	if (key === undefined) return { ok: true, doc: value };
	const parent = valueAt(doc, path.slice(0, -1));
	if (!isContainer(parent)) return { ok: false, message: 'nothing is there to add to' };
	if (Array.isArray(parent)) {
		const index = key === '-' ? parent.length : arrayIndex(key);
		if (index === null || index > parent.length) {
			return { ok: false, message: `"${key}" is not a place in a list of ${parent.length}` };
		}
		parent.splice(index, 0, value);
	} else {
		setMember(parent, key, value);
	}
	return { ok: true, doc };
}

/** RFC 7396: an object merges member by member and a null removes one; anything else replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
	if (!isRecord(patch)) return structuredClone(patch);
	const merged: Record<string, unknown> = isRecord(target) ? structuredClone(target) : {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) delete merged[key];
		else
			setMember(
				merged,
				key,
				mergePatch(Object.hasOwn(merged, key) ? merged[key] : undefined, value)
			);
	}
	return merged;
}

/** RFC 6901: "" is the whole document; `~1` is "/" and `~0` is "~" inside a key. */
export function pointer(text: string): string[] | null {
	if (text === '') return [];
	if (!text.startsWith('/')) return null;
	return text
		.slice(1)
		.split('/')
		.map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'));
}

const NOT_THERE = Symbol('not there');

function valueAt(doc: unknown, path: readonly string[]): unknown {
	let value = doc;
	for (const key of path) {
		if (Array.isArray(value)) {
			const index = arrayIndex(key);
			if (index === null || index >= value.length) return NOT_THERE;
			value = value[index];
		} else if (isRecord(value) && Object.hasOwn(value, key)) {
			value = value[key];
		} else {
			return NOT_THERE;
		}
	}
	return value;
}

/** digits with no leading zero, as RFC 6901 writes an array index. */
function arrayIndex(key: string): number | null {
	return /^(?:0|[1-9]\d*)$/.test(key) ? Number(key) : null;
}

function setMember(target: Record<string, unknown>, key: string, value: unknown) {
	Object.defineProperty(target, key, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}

function jsonEqual(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((item, index) => jsonEqual(item, b[index]))
		);
	}
	if (isRecord(a) && isRecord(b)) {
		const keys = Object.keys(a);
		return (
			keys.length === Object.keys(b).length &&
			keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
		);
	}
	return a === b;
}

function isContainer(value: unknown): value is Container {
	return Array.isArray(value) || isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
