const test = require("node:test");
const assert = require("node:assert");
require("../phones.js");
const { extractPhones } = globalThis.PeelPhones;
const { parseIcsUrls, isCalendarPart } = require("../ics.js");

test("phones: real numbers are found", () => {
  assert.deepStrictEqual(extractPhones("Llama al +52 55 1234 5678 o al 5512345678"), ["+52 55 1234 5678", "5512345678"]);
  assert.deepStrictEqual(extractPhones("US: (212) 555-0123"), ["(212) 555-0123"]);
});

test("phones: timestamps, IDs and dates are ignored", () => {
  assert.deepStrictEqual(extractPhones("ts 1698000000 ms 1698000000000 ref 1234567890123 fecha 2024-10-23 10:30"), []);
});

test("ics: URLs from interesting properties, unescaped once", () => {
  const ics = "BEGIN:VEVENT\r\nDESCRIPTION:Join https://teams.microsoft.com/l/meetup\\, now\r\nLOCATION:https://bucket.s3.amazonaws.com/f\r\n ile\r\nEND:VEVENT";
  assert.deepStrictEqual(parseIcsUrls(ics), ["https://teams.microsoft.com/l/meetup", "https://bucket.s3.amazonaws.com/file"]);
});

test("ics: escaped backslash before n is not a newline", () => {
  assert.deepStrictEqual(parseIcsUrls("DESCRIPTION:C:\\\\new https://a.example/x"), ["https://a.example/x"]);
});

test("ics: calendar part detection", () => {
  assert.ok(isCalendarPart("invite.ics", ""));
  assert.ok(isCalendarPart("", "text/calendar; method=REQUEST"));
  assert.ok(!isCalendarPart("a.txt", "text/plain"));
});
