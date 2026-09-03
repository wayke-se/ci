# Commonly used CI workflows

This repo consists of reusable workflow specifications for commonly used languages within the Wayke project. The workflow files are referenced and used by deployable services.
## Hive contract tags (`.github/actions/hive/tag-contracts`)

`hive-verify.yaml` and `hive-deploy.yaml` run this action on the subgraph SDL before
`hive schema:check` / `schema:publish`. It derives Hive schema-contract tags from the
runtime auth directives, so a contract can filter on them without any subgraph editing
its schema: a field with `@public` gets `@tag(name: "public")`, `@admin` gets
`@tag(name: "admin")`. A Hive include-tag contract marks every untagged coordinate
`@inaccessible`, so the tag also covers what a tagged field needs to compose:

- its arguments;
- enums, input types, custom scalars and unions it reaches (tagged on the type);
- object/interface types it reaches: fields carrying the directive are tagged one by
  one; a reached type with no such field is public as a whole (root-gated services
  such as cross-domain-search), every field, recursively;
- the same field on every type implementing a tagged interface field;
- argument types of composed directives (`@composeDirective`), with every tag: those
  definitions survive into the contract's public SDL, and a removed argument type
  makes that SDL invalid (process-flow's Mesh `@resolveTo`).

`@external` fields are never tagged (composition error), nor `_service`/`_entities`.
Object types are never tagged on the type: Hive's tag register is global per
coordinate, so that would open every field of an entity in every subgraph.
`"@tag"` is added to the federation `@link` import if missing. Pure text insertions:
formatting and comments in the published SDL are untouched.

Run it locally before a manual `hive schema:check`, otherwise contract checks see an
untagged schema:

    npm install --no-save --prefix ci/.github/actions/hive/tag-contracts graphql@16.14.2
    node ci/.github/actions/hive/tag-contracts/tag-contracts.mjs path/to/schema.graphql

Test: `node --test ci/.github/actions/hive/tag-contracts/`
