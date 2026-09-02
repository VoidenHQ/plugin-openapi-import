## Extension: OpenAPI Collection Importer

This extension also ships a one-click **Import into Voiden** button (for an opened OpenAPI 3.x JSON/YAML document) that always produces one `.void` file per operation (method + path), grouped into per-tag folders. **This skill is not about that button's output** — it teaches an agent how to **generate `.void` files directly from an OpenAPI document's raw JSON/YAML**, e.g. when asked to "convert this OpenAPI spec into Voiden requests." Read `voiden-rest-api`'s skill alongside this one for full block syntax (`request`, `headers-table`, `query-table`, `path-table`, body blocks), and `voiden-advanced-auth`'s skill for the `auth` block. Unlike Postman/Bruno/Insomnia, OpenAPI documents carry no scripting, so there is no script-translation section here.

### Default generation strategy: one file per resource, not per operation

An OpenAPI document's `paths` object is flat — `/users` and `/users/{id}` are separate keys, each holding one or more HTTP-method operations. Don't default to one `.void` file per operation. Instead: **group every operation whose path shares the same resource — same `tags[0]` if present, otherwise the same leading path segment ignoring `{param}` segments (`/users` and `/users/{id}` both belong to "users") — into ONE `.void` file**, with each operation becoming its own section via a `request-separator` (base skill's Multi-Request Files feature). Order sections in natural CRUD order when it's obvious (Create → List → Get → Update → Delete), otherwise keep the document's own order. Only fall back to one file per operation when a path has no sibling operations worth grouping.

The chaining pattern is identical to the other importers' skills: a `runtime-variables` block at the end of a `Create` section capturing e.g. `user_id` from `{{$res.body.id}}`, referenced by later sections' URL/path-table as `{{process.user_id}}`. This is always manual — an OpenAPI document has no equivalent of a Postman test script to lean on for the hint; the endpoint's own path parameters (e.g. `/users/{id}`) are the signal for what a later section needs.

### Centralize the server URL instead of hardcoding it everywhere

The deterministic importer bakes `servers[0].url` as a literal string into every single generated file's `url` block — no `{{BASE_URL}}` variable, and every server after the first (a common pattern: `servers: [{url: "https://api.example.com"}, {url: "https://sandbox.api.example.com", description: "Sandbox"}]`) is silently ignored. When generating directly from the spec, prefer capturing `servers[0].url` (or whichever entry is the intended default) as a `{{BASE_URL}}` environment variable in the base skill's Environment Variables YAML instead, then reference `{{BASE_URL}}{{path}}` in every section's `url` block — this is especially worth doing once you're combining several operations into one multi-section file, since it's the only way to flip between a spec's declared servers (prod/sandbox) without editing every section by hand.

If a server URL contains an unresolved `{variable}` placeholder (OpenAPI's `servers[].variables`, e.g. `https://{environment}.api.example.com`), either substitute that variable's `default` value directly, or — if it should stay user-editable — add it as a `path-table` row the same way a `{id}` path parameter would be handled (Voiden's single-brace `{name}` convention already means "fill this in", so this reuses existing syntax rather than inventing new).

### Mapping an OpenAPI operation to Voiden blocks

Each `paths[path][method]` operation object (after resolving any `$ref`/`allOf` in its `parameters`/`requestBody`/`responses`) maps onto one section's blocks:

| OpenAPI field | Voiden block | Notes |
|---|---|---|
| `method` + `path` (prefixed with the server URL) | `request` (method + url) | Path template segments (`{id}`) stay as Voiden's own `{id}` syntax verbatim — no conversion needed, OpenAPI and Voiden use the same single-brace convention. |
| `parameters[]` where `in: "header"` | `headers-table` | Row value comes from `schema.default` if present, else leave blank for the user to fill in — OpenAPI parameters describe shape, not a concrete value to send. |
| `parameters[]` where `in: "query"` | `query-table` | An object-typed query param with `style: "form"` and `explode: true` (OpenAPI's default) expands into multiple rows, one per property, rather than one row holding a serialized object. |
| `parameters[]` where `in: "path"` | `path-table` | Row key matches the `{name}` segment in the URL. |
| `parameters[]` where `in: "cookie"` | *(no direct block — most Voiden HTTP clients don't expose a cookie-table the way headers/query do)* | Fold into `headers-table` as a literal `Cookie` header if it must be sent explicitly. |
| `requestBody.content` (pick `application/json` > `application/xml` > `multipart/form-data` > `application/x-www-form-urlencoded` > first available, matching the importer's own priority order) | `json_body` / `xml_body` / `multipart-table` / `url-table` | Body content comes from the schema's own `example`/`examples.default.value` if present, else a value synthesized from the schema itself (objects → one key per property, strings → `"string"` or a format-aware placeholder like an ISO date/UUID/email, numbers → `0`, booleans → `false`) — never leave the body block empty when a schema exists. |
| `requestBody.content['application/octet-stream']` | `restFile` | Binary upload — no example value to synthesize, just the block itself. |
| `responses[code].content` | *(documentation only — a heading + example JSON, not a live block)* | The importer renders each documented response as a plain paragraph (`Response 200 – description`) followed by the example payload; it is not turned into an `assertions-table` or any block Voiden runs against the real response. Do the same when generating directly from the spec — don't invent status-code assertions the spec didn't actually request. |

### Auth: the importer does not generate this — you must, from `security` + `components.securitySchemes`

This is the biggest gap between the deterministic importer's output and what a spec actually documents: **the importer never emits an `auth` block, regardless of what the spec's `security` requirements say.** When generating directly from a spec, resolve the operation's effective security requirement (`operation.security ?? document.security`, treating an explicit `security: []` on the operation as "no auth, overriding the document default") against `components.securitySchemes[schemeName]`, and add the matching Voiden `auth` block yourself:

| OpenAPI `securitySchemes[name]` | Voiden `auth` | Notes |
|---|---|---|
| `{type: "http", scheme: "bearer"}` | `authType: bearer` | The spec never carries an actual token value — put a `{{...}}` environment-variable reference in the `token` row, don't leave it as a literal placeholder string. |
| `{type: "http", scheme: "basic"}` | `authType: basic` | Same — `username`/`password` rows should reference env variables. |
| `{type: "apiKey", in: "header"\|"query", name: "..."}` | `authType: apiKey` | `key` row = the scheme's `name`; `add_to` row = its `in` (`cookie` has no Voiden equivalent here either — fold into headers as above). |
| `{type: "oauth2", flows: {...}}` | `authType: oauth2` | Grant type comes from which `flows.*` key is present: `authorizationCode` → `authorization_code`, `implicit` → `implicit`, `password` → `password`, `clientCredentials` → `client_credentials`. Populate `oauth2Config`'s `authUrl`/`tokenUrl`/`scope` straight from that flow object's `authorizationUrl`/`tokenUrl`/`scopes` (join scope keys with spaces); `clientId`/`clientSecret` have no source in the spec — leave them blank or as env-variable references. |
| `{type: "openIdConnect", ...}` | *(no Voiden equivalent — leave uncommented but flag for manual setup, don't guess an oauth2 config from the discovery document)* | Voiden's auth types don't include a generic OIDC-discovery flow. |

### The `openapispecLink` block — include it to get live response validation

Every file the deterministic importer generates opens with an `openapispecLink` block before the `request` block. This isn't cosmetic: Voiden's own post-response pipeline looks for this block on the request's document and, when present, re-fetches the spec and validates the *actual* HTTP response (status, headers, content-type, body shape) against what that operation documents — a real, running feature, not just a citation. Include it when generating directly from a spec so this validation stays active:

```void
---
type: openapispecLink
attrs:
  uid: "..."
  filePath: "specs/petstore.yaml"
  filename: "petstore.yaml"
  isExternal: false
---
```

`filePath` is either a path resolved relative to the active project root (`isExternal: false` — use this when the spec is a file sitting in the project) or a fetchable URL (`isExternal: true`, `filePath` is the full `https://...` URL) if the spec was pulled from a remote location rather than a local file. `filename` is just the display name (its basename). Get `filePath` right — it's re-read from disk/network on every response, not cached from generation time.

### Placing a section's documentation

A heading meant to describe an upcoming section (e.g. `## Get User`) must go **after** that section's `request-separator`, never before — content before a separator belongs to the section that *precedes* it. Default to the separator's own `label` for naming the section (the operation's `summary` or `operationId` reads well here); only add prose after it for something the label can't convey (auth requirements, expected status codes).
