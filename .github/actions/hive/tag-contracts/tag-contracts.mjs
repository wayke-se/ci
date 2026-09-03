#!/usr/bin/env node
// Derives Hive schema-contract tags from Wayke's runtime auth directives so a
// contract can filter on them: a field marked @public gets @tag(name: "public"),
// a field marked @admin gets @tag(name: "admin"). A Hive include-tag contract
// marks every untagged coordinate @inaccessible (fields, arguments, enum values,
// types), so the tag has to cover everything a tagged field needs to compose:
//
//   - its arguments (a required untagged argument is a composition error);
//   - enums, input types, custom scalars and unions it reaches, tagged on the
//     type (Hive inherits a type's tags to its values/fields);
//   - object/interface types it reaches: fields carrying the directive are
//     tagged one by one; a reached type with NO such field is public as a
//     whole (services that gate at the root, e.g. cross-domain-search's
//     markTypePublic) and every field is tagged, recursively. Object types are
//     never tagged on the type: Hive's tag register is global per coordinate,
//     so tagging an entity stub's type would open every field of that entity
//     in every subgraph;
//   - the same field on every type implementing a tagged interface field.
//
// Also makes sure "@tag" is in the federation @link import list. Skips
// @external fields (a merged directive on them is a composition error) and the
// federation-internal _service/_entities/_Entity. Edits are pure text insertions
// at parser offsets, so formatting and comments in the published SDL are
// untouched. Idempotent: running twice is a no-op.
//
// Usage: node tag-contracts.mjs <schema.graphql>   (rewrites the file in place)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "graphql";

const DIRECTIVE_TO_TAG = { public: "public", admin: "admin" };
const FEDERATION_INTERNAL = new Set(["_service", "_entities", "_Entity", "_Any", "_Service"]);
const KIND_OF = {
  ObjectTypeDefinition: "object", ObjectTypeExtension: "object",
  InterfaceTypeDefinition: "interface", InterfaceTypeExtension: "interface",
  UnionTypeDefinition: "union", UnionTypeExtension: "union",
  EnumTypeDefinition: "enum", EnumTypeExtension: "enum",
  InputObjectTypeDefinition: "input", InputObjectTypeExtension: "input",
  ScalarTypeDefinition: "scalar", ScalarTypeExtension: "scalar",
};

const directiveOf = (node, name) => (node.directives ?? []).find((d) => d.name.value === name);
const hasTag = (node, tag) =>
  (node.directives ?? []).some(
    (d) =>
      d.name.value === "tag" &&
      d.arguments?.some((a) => a.name.value === "name" && a.value.kind === "StringValue" && a.value.value === tag),
  );
const namedType = (t) => (t.kind === "NamedType" ? t.name.value : namedType(t.type));
// Directives sit after the name (and `implements` list) and before `{` / `= A | B`.
const typeInsertPoint = (node) =>
  node.directives?.length ? node.directives.at(-1).loc.end
  : node.interfaces?.length ? node.interfaces.at(-1).loc.end
  : node.name.loc.end;

export function tagContracts(sdl) {
  const doc = parse(sdl);
  const inserts = []; // [offset, text]
  const stats = { fields: 0, arguments: 0, types: 0, linkPatched: false };

  const nodesByType = new Map(); // type name -> every definition/extension node
  const implementors = new Map(); // interface name -> Set(object type name)
  for (const def of doc.definitions) {
    if (!KIND_OF[def.kind]) continue;
    if (!nodesByType.has(def.name.value)) nodesByType.set(def.name.value, []);
    nodesByType.get(def.name.value).push(def);
    for (const i of def.interfaces ?? []) {
      if (!implementors.has(i.name.value)) implementors.set(i.name.value, new Set());
      implementors.get(i.name.value).add(def.name.value);
    }
  }
  const kindOf = (name) => KIND_OF[nodesByType.get(name)?.[0]?.kind];
  const fieldsOf = (name) => (nodesByType.get(name) ?? []).flatMap((n) => n.fields ?? []);
  const taggable = (field) => !FEDERATION_INTERNAL.has(field.name.value) && !directiveOf(field, "external") && !directiveOf(field, "inaccessible");

  const usedTags = new Set();
  for (const [directive, tag] of Object.entries(DIRECTIVE_TO_TAG)) {
    const tagText = ` @tag(name: "${tag}")`;
    const done = new Set(); // "field:Type.f" | "type:Name" -> handled for this tag
    const reachedTypes = new Set();

    const tagType = (name) => {
      if (done.has(`type:${name}`)) return;
      done.add(`type:${name}`);
      const node = nodesByType.get(name)[0];
      if (hasTag(node, tag)) return;
      inserts.push([typeInsertPoint(node), tagText]);
      stats.types++;
    };

    const tagField = (owner, field) => {
      const key = `field:${owner}.${field.name.value}`;
      if (done.has(key) || !taggable(field)) return;
      done.add(key);
      usedTags.add(tag);
      if (!hasTag(field, tag)) {
        inserts.push([field.loc.end, tagText]);
        stats.fields++;
      }
      for (const arg of field.arguments ?? []) {
        if (hasTag(arg, tag)) continue;
        inserts.push([arg.loc.end, tagText]);
        stats.arguments++;
      }
      reachType(namedType(field.type));
      for (const arg of field.arguments ?? []) reachType(namedType(arg.type));
      if (kindOf(owner) === "interface") {
        for (const impl of implementors.get(owner) ?? []) {
          const f = fieldsOf(impl).find((x) => x.name.value === field.name.value);
          if (f) tagField(impl, f);
        }
      }
    };

    const reachType = (name) => {
      if (reachedTypes.has(name) || FEDERATION_INTERNAL.has(name)) return;
      reachedTypes.add(name);
      switch (kindOf(name)) {
        case "scalar":
        case "enum":
          tagType(name);
          break;
        case "input":
          tagType(name);
          for (const f of fieldsOf(name)) reachType(namedType(f.type));
          break;
        case "union":
          tagType(name);
          for (const n of nodesByType.get(name)) for (const m of n.types ?? []) reachType(m.name.value);
          break;
        case "object":
        case "interface": {
          const fields = fieldsOf(name);
          if (fields.some((f) => directiveOf(f, directive))) break; // explicit per-field type: handled by the main loop
          for (const f of fields) tagField(name, f); // reached, nothing marked: public as a whole
          break;
        }
        default: // built-in scalar or unknown
      }
    };

    for (const [name, nodes] of nodesByType) {
      const kind = kindOf(name);
      if (kind !== "object" && kind !== "interface") continue;
      for (const n of nodes) for (const f of n.fields ?? []) if (directiveOf(f, directive)) tagField(name, f);
    }
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
    `tag-contracts: ${file}: tagged ${stats.fields} field(s), ${stats.arguments} argument(s), ${stats.types} type(s)` +
      (stats.linkPatched ? ', added "@tag" to federation @link import' : ""),
  );
}
