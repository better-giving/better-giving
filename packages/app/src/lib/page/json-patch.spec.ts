import { describe, expect, it } from 'vitest';
import { applyPatch, mergePatch } from './json-patch';

// node pool: two pure functions over plain JSON. the cases are RFC 6902's appendix A and RFC 7396's
// appendix A, where a case is theirs.

describe('a JSON patch (RFC 6902)', () => {
	it('adds a member, and inserts into an array at an index or at its end', () => {
		const doc = { foo: ['bar', 'baz'] };
		expect(
			applyPatch(doc, [
				{ op: 'add', path: '/hello', value: 'world' },
				{ op: 'add', path: '/foo/1', value: 'qux' },
				{ op: 'add', path: '/foo/-', value: 'end' }
			])
		).toEqual({ ok: true, doc: { foo: ['bar', 'qux', 'baz', 'end'], hello: 'world' } });
		expect(doc).toEqual({ foo: ['bar', 'baz'] });
	});

	it('removes and replaces a member or an item', () => {
		expect(
			applyPatch({ baz: 'qux', foo: ['bar', 'qux', 'baz'] }, [
				{ op: 'remove', path: '/foo/1' },
				{ op: 'replace', path: '/baz', value: 'boo' }
			])
		).toEqual({ ok: true, doc: { baz: 'boo', foo: ['bar', 'baz'] } });
	});

	it('refuses the whole patch when one operation names nothing, leaving the document as it was', () => {
		const doc = { foo: 'bar' };
		expect(
			applyPatch(doc, [
				{ op: 'replace', path: '/foo', value: 'baz' },
				{ op: 'remove', path: '/nope' }
			])
		).toEqual({ ok: false, message: 'operation 2 (remove /nope): nothing is there' });
		expect(doc).toEqual({ foo: 'bar' });
	});

	it('moves and copies a value, and tests one, from RFC 6902’s own examples', () => {
		expect(
			applyPatch({ foo: { bar: 'baz', waldo: 'fred' }, qux: { corge: 'grault' } }, [
				{ op: 'move', from: '/foo/waldo', path: '/qux/thud' },
				{ op: 'copy', from: '/qux/corge', path: '/foo/copied' },
				{ op: 'test', path: '/qux/thud', value: 'fred' }
			])
		).toEqual({
			ok: true,
			doc: { foo: { bar: 'baz', copied: 'grault' }, qux: { corge: 'grault', thud: 'fred' } }
		});
		expect(
			applyPatch({ foo: ['all', 'grass', 'cows', 'eat'] }, [
				{ op: 'move', from: '/foo/1', path: '/foo/3' }
			])
		).toEqual({ ok: true, doc: { foo: ['all', 'cows', 'eat', 'grass'] } });
	});

	it('refuses a failed test, and a move into its own child', () => {
		expect(applyPatch({ baz: 'qux' }, [{ op: 'test', path: '/baz', value: 'bar' }])).toEqual({
			ok: false,
			message: 'operation 1 (test /baz): the value there is not the one tested'
		});
		expect(applyPatch({ a: { b: {} } }, [{ op: 'move', from: '/a', path: '/a/b/c' }])).toEqual({
			ok: false,
			message: 'operation 1 (move /a/b/c): a value cannot move into itself'
		});
	});

	it('reads ~1 and ~0 in a key as "/" and "~", and a __proto__ key as a member', () => {
		const result = applyPatch({ 'a/b': 1 }, [
			{ op: 'copy', from: '/a~1b', path: '/m~0n' },
			{ op: 'add', path: '/__proto__', value: { polluted: true } }
		]);
		expect(result).toEqual({
			ok: true,
			doc: JSON.parse('{"a/b":1,"m~n":1,"__proto__":{"polluted":true}}')
		});
		expect(result.ok && Object.getPrototypeOf(result.doc)).toBe(Object.prototype);
	});
});

describe('a JSON merge patch (RFC 7396)', () => {
	it.each([
		[{ a: 'b' }, { a: 'c' }, { a: 'c' }],
		[{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
		[{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
		[{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
		[{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
		[{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
		[{ e: null }, { a: 1 }, { e: null, a: 1 }],
		[['a', 'b'], { a: 'b' }, { a: 'b' }],
		[{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }]
	])('merges %j with %j into %j', (target, patch, merged) => {
		expect(mergePatch(target, patch)).toEqual(merged);
	});

	it('leaves the target as it was, and reads a __proto__ key as a member', () => {
		const target = { a: { b: 1 } };
		const merged = mergePatch(target, JSON.parse('{"a":{"b":2},"__proto__":{"polluted":true}}'));
		expect(target).toEqual({ a: { b: 1 } });
		expect(merged).toEqual(JSON.parse('{"a":{"b":2},"__proto__":{"polluted":true}}'));
		expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
	});
});
