import assert from "node:assert/strict";
import test from "node:test";

import { resolvePrintColumns, setPrintColumn } from "./printColumns";

test("URL columns discard unknowns and duplicates and retain the supported order", () => {
  assert.deepEqual(resolvePrintColumns("timein,position,name,unknown,position,identifier,group,status"), [
    "name", "identifier", "group", "position", "status", "timein",
  ]);
  assert.deepEqual(resolvePrintColumns(["position,name", "identifier"]), ["name", "identifier", "position"]);
  assert.deepEqual(resolvePrintColumns("unknown"), ["name"]);
});

test("existing signature links work until an explicit column selection replaces them", () => {
  assert.equal(resolvePrintColumns(undefined).includes("signature"), true);
  assert.equal(resolvePrintColumns(undefined, "0").includes("signature"), false);
  assert.deepEqual(resolvePrintColumns("name,signature", "0"), ["name", "signature"]);
});

test("toggling a column preserves report filters and encodes a nonempty ordered selection", () => {
  const original = new URLSearchParams("absentees=0&grouped=0&signature=0&columns=position,name");
  const updated = setPrintColumn(original, "identifier", true);
  assert.equal(updated.get("columns"), "name,identifier,position");
  assert.equal(updated.get("absentees"), "0");
  assert.equal(updated.get("grouped"), "0");
  assert.equal(updated.has("signature"), false);
  assert.equal(original.get("columns"), "position,name");
  assert.equal(setPrintColumn(new URLSearchParams("columns=name"), "name", false).get("columns"), "name");
});
