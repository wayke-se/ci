// Run: node --test tag-contracts.test.mjs   (needs `npm install graphql` next to it)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "graphql";
import { tagContracts } from "./tag-contracts.mjs";

const input = `extend schema
  @link(
    url: "https://specs.apollo.dev/federation/v2.3",
    import: ["@key", "@shareable"]
  )

directive @public on FIELD_DEFINITION
directive @admin on FIELD_DEFINITION

"""
Fields marked with @public are accessible without authentication.
"""
type Query {
  ad(id: ID!): Ad @public
  stats: Stats! @admin
  already: Ad @public @tag(name: "public")
  # a comment that must survive
  private: String
  _entities(representations: [_Any!]!): [_Entity]! @public
}

interface Node {
  id: ID! @public
}

union SearchHit = Ad | Stats
union Tagged @tag(name: "public") = Ad
union _Entity = Ad | Stats
`;

test("derives contract tags from @public/@admin, patches @link, is idempotent", () => {
  const { sdl, stats } = tagContracts(input);
  parse(sdl);
  assert.equal(stats.fields, 3); // ad, stats, Node.id
  assert.equal(stats.unions, 2); // SearchHit gets both; Tagged only needs admin
  assert.equal(stats.linkPatched, true);
  assert.match(sdl, /ad\(id: ID!\): Ad @public @tag\(name: "public"\)\n/);
  assert.match(sdl, /stats: Stats! @admin @tag\(name: "admin"\)\n/);
  assert.match(sdl, /id: ID! @public @tag\(name: "public"\)\n/);
  assert.match(sdl, /already: Ad @public @tag\(name: "public"\)\n/); // not doubled
  assert.match(sdl, /_entities\(representations: \[_Any!\]!\): \[_Entity\]! @public\n/); // untouched
  assert.match(sdl, /union SearchHit @tag\(name: "public"\) @tag\(name: "admin"\) = Ad \| Stats/);
  assert.match(sdl, /union Tagged @tag\(name: "public"\) @tag\(name: "admin"\) = Ad/);
  assert.match(sdl, /import: \["@key", "@shareable", "@tag"\]/);
  assert.match(sdl, /\nunion _Entity = Ad \| Stats\n/); // federation-internal, untouched
  assert.match(sdl, /# a comment that must survive/);
  assert.match(sdl, /Fields marked with @public are accessible/); // description text not touched
  assert.match(sdl, /\n  private: String\n/);

  const again = tagContracts(sdl);
  assert.equal(again.sdl, sdl);
  assert.deepEqual(again.stats, { fields: 0, unions: 0, linkPatched: false });
});

test("no auth directives: leaves the SDL alone", () => {
  const plain = `type Query { a: String }\nunion U = Query\n`;
  assert.equal(tagContracts(plain).sdl, plain);
});
