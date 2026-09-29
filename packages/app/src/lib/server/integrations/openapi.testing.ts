import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { openApiDocument } from './openapi';

// the schemas ./openapi.ts publishes, compiled as JSON Schema 2020-12 in strict mode, for the
// specs that hold real objects to them.
//
// the components are one schema, so each `$ref` between them resolves as the document spells it.
// `components` is declared a keyword with no meaning of its own: the schema holding them is only
// where they live, and each is compiled — strictly — when a spec asks for it by name.
//
// **every object and every value set is closed here, and only here.** the document leaves both
// open, since a reader is told to let a key or a value it does not know pass; a spec holding a
// rendered object to them closes each object and holds each set to its `examples`
// (./openapi.ts's header), so a key or a value the deployment renders and the document never
// describes fails.

const COMPONENTS = 'https://openapi.invalid/components';

/** a validator for the component schema `name` of `document`; throws where it does not compile. */
export function componentValidator(
	document: ReturnType<typeof openApiDocument>,
	name: string
): ValidateFunction {
	const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
	addFormats(ajv);
	ajv.addKeyword('components');
	ajv.addSchema({ $id: COMPONENTS, components: closed(document.components) });
	const validate = ajv.getSchema(`${COMPONENTS}#/components/schemas/${name}`);
	if (validate === undefined) throw new Error(`the document names no schema ${name}`);
	return validate;
}

/** `value` checked against the component schema `name`: the errors, or none. */
export function schemaErrors(
	document: ReturnType<typeof openApiDocument>,
	name: string,
	value: unknown
): unknown[] {
	const validate = componentValidator(document, name);
	return validate(value) ? [] : (validate.errors ?? []);
}

/**
 * `schema` with `unevaluatedProperties: false` on every object schema naming its properties, and
 * every value set held to its `examples` — and to null besides, where its type admits null.
 */
function closed(schema: unknown): unknown {
	if (Array.isArray(schema)) return schema.map(closed);
	if (typeof schema !== 'object' || schema === null) return schema;
	const { type, examples } = schema as { type?: unknown; examples?: unknown };
	const entries = Object.entries(schema).map(([keyword, value]) => [keyword, closed(value)]);
	if ('properties' in schema && type === 'object')
		return Object.fromEntries([...entries, ['unevaluatedProperties', false]]);
	if (Array.isArray(examples)) {
		const nullable = Array.isArray(type) && type.includes('null');
		return Object.fromEntries([...entries, ['enum', nullable ? [...examples, null] : examples]]);
	}
	return Object.fromEntries(entries);
}
