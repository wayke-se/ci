# Commonly used CI workflows

This repo consists of reusable workflow specifications for commonly used languages within the Wayke project. The workflow files are referenced and used by deployable services.
## Hive contract tags (`.github/actions/hive/tag-contracts`)

`hive-verify.yaml` and `hive-deploy.yaml` run this action on the subgraph SDL before
`hive schema:check` / `schema:publish`. It derives Hive schema-contract tags from the
runtime auth directives, so a contract can filter on them without any subgraph editing
its schema: a field with `@public` gets `@tag(name: "public")`, `@admin` gets
`@tag(name: "admin")`, unions get every derived tag (include-tag contracts drop
untagged unions), and `"@tag"` is added to the federation `@link` import if missing.
Pure text insertions: formatting and comments in the published SDL are untouched.

Run it locally before a manual `hive schema:check`, otherwise contract checks see an
untagged schema:

    npm install --no-save --prefix ci/.github/actions/hive/tag-contracts graphql@16.14.2
    node ci/.github/actions/hive/tag-contracts/tag-contracts.mjs path/to/schema.graphql

Test: `node --test ci/.github/actions/hive/tag-contracts/`
