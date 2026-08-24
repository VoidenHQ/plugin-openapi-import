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

console.log("mock response checks passed");
