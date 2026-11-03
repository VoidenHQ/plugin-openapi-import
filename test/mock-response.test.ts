import { getJsonMockResponse } from "../src/utils/converter.js";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const explicit = getJsonMockResponse({
  content: {
    "application/xml": { example: "<ignored />" },
    "application/json": {
      example: { source: "explicit" },
      examples: { fallback: { value: { source: "named" } } },
      schema: { example: { source: "schema" } },
    },
  },
});
assert(explicit?.type === "application/json", "uses the JSON media type");
assert(explicit?.example?.source === "explicit", "prefers the media-type example");

const named = getJsonMockResponse({
  content: {
    "application/problem+json": {
      examples: { first: { value: { source: "named" } } },
      schema: { example: { source: "schema" } },
    },
  },
});
assert(named?.example?.source === "named", "uses the first named example before the schema");

const schema = getJsonMockResponse({
  content: {
    "application/json": {
      schema: { type: "object", properties: { id: { type: "integer" }, active: { type: "boolean" } } },
    },
  },
});
assert(JSON.stringify(schema?.example) === '{"id":0,"active":false}', "builds a mock from the JSON schema");
assert(getJsonMockResponse({ content: { "application/xml": { example: "<ignored />" } } }) === undefined, "does not mock XML responses");

for (const body of [
  { example: null, examples: { fallback: { value: "named" } }, schema: { example: "schema", default: "default" } },
  { examples: { first: { value: null }, second: { value: "named" } }, schema: { example: "schema", default: "default" } },
  { schema: { type: "string", example: null, default: "default" } },
  { schema: { type: "string", default: null } },
]) {
  const mock = getJsonMockResponse({ content: { "application/json": body } });
  assert(mock?.example === null, `preserves an explicit null instead of falling back: ${JSON.stringify(body)}`);
  assert(JSON.stringify(mock?.example) === "null", "serializes null as valid JSON for preview and copy");
}

for (const example of [false, 0, ""]) {
  assert(getJsonMockResponse({ content: { "application/json": { example } } })?.example === example, "preserves falsy JSON examples");
}

assert(getJsonMockResponse({ content: { "application/json": {} } })?.example === undefined, "distinguishes a missing example from null");

console.log("mock response checks passed");
