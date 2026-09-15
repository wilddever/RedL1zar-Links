import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedCorsOrigin } from "../src/lib/cors";

test("allows the public punycode and Unicode frontend origins", () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.equal(isAllowedCorsOrigin("https://xn--d1ax3b.fun", env), true);
  assert.equal(isAllowedCorsOrigin("https://рэд.fun", env), true);
  assert.equal(isAllowedCorsOrigin("https://evil.example", env), false);
});

test("allows configured Replit domains without allowing arbitrary origins", () => {
  const env = {
    REPLIT_DOMAINS: "published.replit.app, preview.replit.dev",
  } as NodeJS.ProcessEnv;
  assert.equal(isAllowedCorsOrigin("https://published.replit.app", env), true);
  assert.equal(isAllowedCorsOrigin("https://preview.replit.dev", env), true);
  assert.equal(isAllowedCorsOrigin("https://not-replit.example", env), false);
});