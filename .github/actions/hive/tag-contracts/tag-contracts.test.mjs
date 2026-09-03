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

scalar Time
scalar Unused

enum Market { SE NO }
enum PrivateOnly { A }

input Filter { market: Market, since: Time }
input Sort { field: String }

"""
Fields marked with @public are accessible without authentication.
"""
type Query {
  ad(id: ID!, filter: Filter, sort: Sort): Ad @public
  stats: Stats! @admin
  already: Ad @public @tag(name: "public")
  # a comment that must survive
  private(p: PrivateOnly): String
  search: Search @public
  _entities(representations: [_Any!]!): [_Entity]! @public
}

"Explicit per-field type: only its @public fields go public"
type Ad implements Node @key(fields: "id") {
  id: ID! @public
  market: Market! @public
  price: Int
  hit: SearchHit @public
}

"Reached from a public field with no @public field of its own: public as a whole"
type Search {
  ads(q: String!, limit: Int): AdsResult
  internalCounter: Int
}
type AdsResult {
  found: Int!
  hits: [Ad!]!
  when: Time
}

type Stats { n: Int @admin, m: Int, t: Time }

interface Node {
  id: ID! @public
}
type Branch implements Node @key(fields: "id") {
  id: ID!
  name: String
}
"Implements Node but is reached from nothing: only the interface's field goes public"
type Dealer implements Node {
  id: ID!
  secret: String
}
type Other @key(fields: "id") {
  id: ID! @external
  ext: String @external
}

union SearchHit = Ad | Branch
union NeverReached = Stats
union _Entity = Ad | Branch
`;

test("derives contract tags from @public/@admin with reachability, patches @link, is idempotent", () => {
  const { sdl, stats } = tagContracts(input);
  parse(sdl);
  assert.equal(stats.linkPatched, true);
  assert.match(sdl, /import: \["@key", "@shareable", "@tag"\]/);

  // explicit fields, their arguments
  assert.match(sdl, /ad\(id: ID! @tag\(name: "public"\), filter: Filter @tag\(name: "public"\), sort: Sort @tag\(name: "public"\)\): Ad @public @tag\(name: "public"\)\n/);
  assert.match(sdl, /stats: Stats! @admin @tag\(name: "admin"\)\n/);
  assert.match(sdl, /already: Ad @public @tag\(name: "public"\)\n/); // not doubled
  assert.match(sdl, /\n  private\(p: PrivateOnly\): String\n/); // untouched
  assert.match(sdl, /_entities\(representations: \[_Any!\]!\): \[_Entity\]! @public\n/); // untouched

  // reached enum/scalar/input/union: tagged on the type; unreached ones not
  assert.match(sdl, /^scalar Time @tag\(name: "public"\)$/m);
  assert.match(sdl, /^scalar Unused$/m);
  assert.match(sdl, /^enum Market @tag\(name: "public"\) \{/m);
  assert.match(sdl, /^enum PrivateOnly \{/m);
  assert.match(sdl, /^input Filter @tag\(name: "public"\) \{/m);
  assert.match(sdl, /^input Sort @tag\(name: "public"\) \{/m);
  assert.match(sdl, /^union SearchHit @tag\(name: "public"\) = Ad \| Branch$/m);
  assert.match(sdl, /^union NeverReached = Stats$/m);
  assert.match(sdl, /^union _Entity = Ad \| Branch$/m);

  // explicit per-field type: only its own @public fields, never the type
  assert.match(sdl, /^type Ad implements Node @key\(fields: "id"\) \{$/m);
  assert.match(sdl, /\n  price: Int\n/);
  assert.match(sdl, /market: Market! @public @tag\(name: "public"\)\n/);

  // whole type, recursively, with arguments; the type itself untagged
  assert.match(sdl, /^type Search \{$/m);
  assert.match(sdl, /ads\(q: String! @tag\(name: "public"\), limit: Int @tag\(name: "public"\)\): AdsResult @tag\(name: "public"\)\n/);
  assert.match(sdl, /internalCounter: Int @tag\(name: "public"\)\n/);
  assert.match(sdl, /found: Int! @tag\(name: "public"\)\n/);
  assert.match(sdl, /hits: \[Ad!\]! @tag\(name: "public"\)\n/);

  // admin reaches Stats as a per-field type (it has an @admin field): only n
  assert.match(sdl, /type Stats \{ n: Int @admin @tag\(name: "admin"\), m: Int, t: Time \}/);
  assert.doesNotMatch(sdl, /scalar Time @tag\(name: "public"\) @tag\(name: "admin"\)/);

  // interface field -> same field on implementors; Branch is also reached whole via the union
  assert.match(sdl, /interface Node \{\n  id: ID! @public @tag\(name: "public"\)\n\}/);
  assert.match(sdl, /type Branch implements Node @key\(fields: "id"\) \{\n  id: ID! @tag\(name: "public"\)\n  name: String @tag\(name: "public"\)\n\}/);
  assert.match(sdl, /type Dealer implements Node \{\n  id: ID! @tag\(name: "public"\)\n  secret: String\n\}/);

  // @external never tagged
  assert.match(sdl, /type Other @key\(fields: "id"\) \{\n  id: ID! @external\n  ext: String @external\n\}/);

  // formatting preserved
  assert.match(sdl, /# a comment that must survive/);
  assert.match(sdl, /Fields marked with @public are accessible/);

  const again = tagContracts(sdl);
  assert.equal(again.sdl, sdl);
  assert.deepEqual(again.stats, { fields: 0, arguments: 0, types: 0, linkPatched: false });
});

test("no auth directives: leaves the SDL alone", () => {
  const plain = `type Query { a: String }\nunion U = Query\n`;
  assert.equal(tagContracts(plain).sdl, plain);
});
