#!/usr/bin/env node
// Derives Hive schema-contract tags from Wayke's runtime auth directives so a
// contract can filter on them: a field marked @public gets @tag(name: "public"),
// a field marked @admin gets @tag(name: "admin"). Unions get every derived tag
// (an include-tag contract drops untagged unions; unreachable ones are pruned by
// the contract's "remove unreachable types" option). Also makes sure "@tag" is in
// the federation @link import list, so no subgraph has to edit its own schema.
//
// Edits are pure text insertions at parser offsets, so formatting and comments
// in the published SDL are untouched. Idempotent: running twice is a no-op.
//
// Usage: node tag-contracts.mjs <schema.graphql>   (rewrites the file in place)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "graphql";

const DIRECTIVE_TO_TAG = { public: "public", admin: "admin" };
const FEDERATION_INTERNAL_FIELDS = new Set(["_service", "_entities"]);
const FEDERATION_INTERNAL_UNIONS = new Set(["_Entity"]);
const FIELD_OWNERS = new Set([
  "ObjectTypeDefinition",
  "ObjectTypeExtension",
  "InterfaceTypeDefinition",
  "InterfaceTypeExtension",
]);

const directiveOf = (node, name) => (node.directives ?? []).find((d) => d.name.value === name);
const hasTag = (node, tag) =>
  (node.directives ?? []).some(
    (d) =>
      d.name.value === "tag" &&
      d.arguments?.some((a) => a.name.value === "name" && a.value.kind === "StringValue" && a.value.value === tag),
  );
const tagText = (tag) => ` @tag(name: "${tag}")`;

export function tagContracts(sdl) {
  const doc = parse(sdl);
  const inserts = []; // [offset, text]
  const stats = { fields: 0, unions: 0, linkPatched: false };
  const usedTags = new Set();

  for (const def of doc.definitions) {
    if (!FIELD_OWNERS.has(def.kind)) continue;
    for (const field of def.fields ?? []) {
      if (FEDERATION_INTERNAL_FIELDS.has(field.name.value)) continue;
      for (const [directive, tag] of Object.entries(DIRECTIVE_TO_TAG)) {
        if (!directiveOf(field, directive)) continue;
        usedTags.add(tag);
        if (hasTag(field, tag)) continue;
        // A field's loc ends after its directives, so append there.
        inserts.push([field.loc.end, tagText(tag)]);
        stats.fields++;
      }
    }
  }

  for (const def of doc.definitions) {
    if (def.kind !== "UnionTypeDefinition" && def.kind !== "UnionTypeExtension") continue;
    if (FEDERATION_INTERNAL_UNIONS.has(def.name.value)) continue;
    // Directives sit between the name and "= A | B".
    const at = def.directives?.length ? def.directives.at(-1).loc.end : def.name.loc.end;
    let added = false;
    for (const tag of usedTags) {
      if (hasTag(def, tag)) continue;
      inserts.push([at, tagText(tag)]);
      added = true;
    }
    if (added) stats.unions++;
  }

  if (usedTags.size > 0) {
    for (const def of doc.definitions) {
      if (def.kind !== "SchemaDefinition" && def.kind !== "SchemaExtension") continue;
      for (const link of (def.directives ?? []).filter((d) => d.name.value === "link")) {
        const url = link.arguments?.find((a) => a.name.value === "url")?.value;
        if (url?.kind !== "StringValue" || !url.value.includes("specs.apollo.dev/federation")) continue;
        const list = link.arguments?.find((a) => a.name.value === "import")?.value;
        if (list?.kind !== "ListValue") continue;
        if (list.values.some((v) => v.kind === "StringValue" && v.value === "@tag")) continue;
        if (list.values.length === 0) inserts.push([list.loc.start + 1, '"@tag"']);
        else inserts.push([list.values.at(-1).loc.end, ', "@tag"']);
        stats.linkPatched = true;
      }
    }
  }

  // Apply back to front so earlier offsets stay valid; at equal offsets apply
  // the later insert first so the text ends up in push order.
  let out = sdl;
  const ordered = inserts.map((x, i) => [...x, i]).sort((a, b) => b[0] - a[0] || b[2] - a[2]);
  for (const [offset, text] of ordered) {
    out = out.slice(0, offset) + text + out.slice(offset);
  }
  parse(out); // fail loudly rather than publish a broken SDL
  return { sdl: out, stats };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: tag-contracts.mjs <schema.graphql>");
    process.exit(2);
  }
  const { sdl, stats } = tagContracts(readFileSync(file, "utf8"));
  writeFileSync(file, sdl);
  console.log(
    `tag-contracts: ${file}: tagged ${stats.fields} field(s), ${stats.unions} union(s)` +
      (stats.linkPatched ? ', added "@tag" to federation @link import' : ""),
  );
}
