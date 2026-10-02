import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotBefore, utcToday, notYet } from "../src/notBefore.mjs";

test("a real UTC day is accepted as written", () => {
  assert.equal(parseNotBefore("2027-03-02"), "2027-03-02");
  assert.equal(parseNotBefore("2028-02-29"), "2028-02-29");
});

test("anything that is not exactly a real YYYY-MM-DD day is refused", () => {
  for (const bad of [undefined, "", " 2027-03-02", "2027-3-2", "2027-02-30", "2027-13-01",
    "2027-02-29", "0050-01-01", "tomorrow", "2027-03-02T00:00:00Z"]) {
    assert.throws(() => parseNotBefore(bad), /--not-before needs a UTC day as YYYY-MM-DD/, String(bad));
  }
});

test("today is the UTC day, wherever the caller is", () => {
  assert.equal(utcToday(new Date("2027-03-01T23:30:00-05:00")), "2027-03-02");
});

test("the day itself is allowed; the second before it is not", () => {
  assert.equal(notYet("2027-03-02", new Date("2027-03-01T23:59:59Z")), true);
  assert.equal(notYet("2027-03-02", new Date("2027-03-02T00:00:00Z")), false);
  assert.equal(notYet("2027-03-02", new Date("2027-03-03T12:00:00Z")), false);
});
