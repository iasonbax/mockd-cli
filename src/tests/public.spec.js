import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// This repository is public. What must not be in it is checked on every test run: references to
// private repositories, issues and systems, hosts other than the product's, and secrets-by-name.
// The spec cannot see everything; it keeps the known mistakes from coming back.

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".claude"]);
// The lock file is generated; this file spells out the patterns it forbids.
const SKIP_FILES = new Set(["package-lock.json", "src/tests/public.spec.js"]);

function walk(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(join(dir, entry.name), rel);
    return SKIP_FILES.has(rel) ? [] : [rel];
  });
}

const FILES = walk(".").map((path) => [path, readFileSync(path, "utf8")]);
const inTests = (path) => path.split("/").includes("tests");

// Code without its line comments (a `//` after a space or at the start; `https://` stays).
const withoutComments = (text) => text.replace(/(^|\s)\/\/.*$/gm, "$1");

// Every host that appears as a web address, per file.
const hostsOf = (text) => [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());

// The product's own addresses, and the few places the docs link to.
const ALLOWED_HOSTS = new Set([
  "api.mock-d.com",
  "mock-d.com",
  "localhost",
  "127.0.0.1",
  "github.com",
  "bun.sh",
  "www.conventionalcommits.org",
]);

describe("a public repository", () => {
  it("has files to look at", () => {
    expect(FILES.length).toBeGreaterThan(40);
  });

  it("names no private repository, no issue of one and no setting only the gateway reads", () => {
    const found = FILES.flatMap(([path, text]) =>
      [
        /catenum/i,
        /\b(gateway|backend|frontend|landing(page)?|cli)#\d+/i,
        /(^|[\s([])#\d{2,}\b/m,
        /MOCKD_GATEWAY_URL|MOCKD_APP_URL|MOCKD_RELEASES_TOKEN/,
        /\bIason\b(?! Baxmann)/,
      ]
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${path}: ${pattern}`)
    );
    expect(found).toEqual([]);
  });

  it("leads to no host but the product's own and the few the docs link to", () => {
    const stray = FILES.filter(([path]) => !inTests(path)).flatMap(([path, text]) =>
      hostsOf(text)
        .filter((host) => !ALLOWED_HOSTS.has(host))
        .map((host) => `${path}: ${host}`)
    );
    expect(stray).toEqual([]);
  });

  it("knows no subdomain of the product but the API, not even in a test", () => {
    const stray = FILES.flatMap(([path, text]) =>
      [...text.matchAll(/[a-z0-9-]+\.mock-d\.com/gi)]
        .map((m) => m[0].toLowerCase())
        .filter((host) => host !== "api.mock-d.com")
        .map((host) => `${path}: ${host}`)
    );
    expect(stray).toEqual([]);
  });

  it("names the product in one place: the folder and the keychain item derive from src/core/product.js", () => {
    const literal = /(["'])mockd(-client-access)?\1/;
    const sources = FILES.filter(([path]) => path.startsWith("src/") && !inTests(path) && path !== "src/core/product.js");
    expect(sources.filter(([, text]) => literal.test(withoutComments(text))).map(([path]) => path)).toEqual([]);
    expect(readFileSync("src/core/product.js", "utf8")).toContain('export const PRODUCT = "mockd";');
  });
});

describe("the package", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  it("is MIT licensed, in the operator's name", () => {
    const license = readFileSync("LICENSE", "utf8");
    expect(license.startsWith("MIT License")).toBe(true);
    expect(license).toContain("Copyright (c) 2026 Carl Iason Baxmann");
    expect(pkg.license).toBe("MIT");
  });

  it("is the working name, version 0.1.0, publishable in principle but published nowhere", () => {
    expect(pkg.name).toBe("@mock-d/cli");
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.bin).toEqual({ mockd: "bin/mockd.js" });
    expect(pkg.private).toBeUndefined();
    expect(pkg.engines).toEqual({ node: ">=22" });
    expect(pkg.repository.url).toContain("iasonbax/mockd-cli");
  });

  it("ships the code and the skill, and no spec", () => {
    expect(pkg.files).toEqual(expect.arrayContaining(["bin", "src", "skills", "LICENSE", "README.md"]));
    expect(pkg.files).toContain("!src/**/tests");
  });

  it("has no runtime dependency", () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(["@eslint/js", "eslint", "globals", "vitest"]);
  });

  it("is not on npm: no document tells to install it from there", () => {
    const docs = FILES.filter(([path]) => /\.md$/.test(path));
    const found = docs.filter(([, text]) => /npm (i|install|add)\b[^\n]*(@mock-d|mockd)/i.test(text)).map(([path]) => path);
    expect(found).toEqual([]);
  });
});
