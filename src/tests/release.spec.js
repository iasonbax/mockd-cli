import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The standalone files are a contract with https://mock-d.com/install: the script downloads
// mockd-<os>-<arch>[.exe] and SHA256SUMS from the latest release of this repository. These
// cases hold the two workflows to it, to the rules of the repository (the job `check`, the
// gate on `main`, pinned actions, no secret) and to the way the release is made. What runs is
// proven by the runs themselves.
const read = (path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const ci = read(".github/workflows/ci.yml");
const release = read(".github/workflows/release.yml");

/** One job of a workflow: its lines up to the next job. */
const job = (workflow, name) => workflow.split(`\n  ${name}:\n`)[1].split(/\n {2}[a-z-]+:\n/)[0];
// The condition under a job's `if: >-`, up to its next key.
const gate = (text) => text.split("if: >-\n")[1].split(/\n {4}[a-z-]+:/)[0];
// The steps of a job: what comes before the first `- ` is the comment above it.
const stepsOf = (text) => text.split("steps:\n")[1].split(/^ {6}- /m).slice(1);

const FILES = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"];

describe("ci.yml", () => {
  it("runs on pull requests against dev and main, and by hand, not on a push", () => {
    expect(ci).toMatch(/\non:\n {2}pull_request:\n {4}branches: \[dev, main\]\n/);
    expect(ci).toContain("workflow_dispatch:");
    expect(ci).not.toMatch(/\n {2}push:/);
  });

  it("has the job `check` that the ruleset on main requires: plain, on Linux, with the checks", () => {
    const check = job(ci, "check");
    expect(check).not.toContain("matrix");
    expect(check).not.toMatch(/\n {4}name:/);
    expect(check).toContain("runs-on: ubuntu-latest");
    for (const step of ["npm ci", "npm audit --audit-level=high", "npm run lint", "npm test"]) {
      expect(check).toContain(`run: ${step}`);
    }
  });

  it("lets `check` fail first when a pull request to main does not come from dev of this repository", () => {
    const [first] = stepsOf(job(ci, "check"));
    expect(first).toContain("name: Releases only come as a pull request from dev to main");
    expect(first).toContain("github.base_ref == 'main'");
    expect(first).toContain("github.head_ref != 'dev'");
    expect(first).toContain("github.event.pull_request.head.repo.full_name != github.repository");
    expect(first).toContain("exit 1");
    // The branch name is typed by whoever opens the pull request: it goes in through env.
    const script = first.split("run: |")[1];
    expect(script).not.toContain("${{");
    expect(script).toContain("$HEAD_REF");
  });

  it("builds and starts the standalone file on Linux, macOS and Windows, behind the same gate as `check`", () => {
    const binary = job(ci, "binary");
    expect(gate(binary)).toBe(gate(job(ci, "check")));
    for (const runner of ["ubuntu-latest", "macos-latest", "windows-latest"]) expect(binary).toContain(`runner: ${runner}`);
    expect(binary).toContain("scripts/build-binaries.sh ${{ matrix.target }}");
    expect(binary).toContain('scripts/smoke-binary.sh "dist/${{ matrix.file }}"');
    expect(binary).toContain("codesign --sign - --force");
  });
});

describe("release.yml", () => {
  it("runs on a push to main only, and a release run is never cancelled", () => {
    expect(release).toMatch(/\non:\n {2}push:\n {4}branches: \[main\]\n\n/);
    expect(release).toContain("cancel-in-progress: false");
  });

  it("builds the five the install script asks for, the macOS ones on macOS and signed", () => {
    const targets = [...release.matchAll(/targets: (.+)/g)].flatMap((m) => m[1].split(" "));
    expect(targets.sort()).toEqual([...FILES].sort());
    expect(release).toMatch(/runner: macos-latest\n {12}targets: darwin-arm64 darwin-x64\n/);
    expect(release).toContain('codesign --sign - --force "$file"');
    expect(release).toContain("for file in dist/mockd-darwin-*; do");
    for (const file of FILES) expect(release).toContain(`mockd-${file}${file.startsWith("windows") ? ".exe" : ""}`);
  });

  it("makes the release in this repository with the token of the run, and writes nowhere else", () => {
    const publish = job(release, "publish");
    expect(release).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(publish).toMatch(/\n {4}permissions:\n {6}contents: write\n/);
    expect(job(release, "build")).not.toContain("contents: write");
    expect(publish).toContain("GH_TOKEN: ${{ github.token }}");
    expect(publish).toContain('gh release create "v$version" dist/* --repo "$GITHUB_REPOSITORY"');
    expect(publish).toContain("sha256sum mockd-* > SHA256SUMS");
    expect(release).not.toContain("RELEASE_REPO");
  });

  it("refuses a version that was released already", () => {
    const publish = job(release, "publish");
    expect(publish).toContain('gh release view "v$version" --repo "$GITHUB_REPOSITORY"');
    expect(publish).toMatch(/exists already[^\n]*\n\s+exit 1/);
  });

  it("is a release of the CLI alone: one file per system, built by the one script, no second toolchain", () => {
    expect(release).toContain("scripts/build-binaries.sh ${{ matrix.targets }}");
    expect(release).not.toMatch(/go build|setup-go/);
  });
});

describe("both workflows", () => {
  it("use no secret but the token of the run", () => {
    for (const workflow of [ci, release]) expect(workflow).not.toMatch(/secrets\./);
  });

  it("pin every action to a commit, with its version as the comment", () => {
    const uses = [...ci.matchAll(/uses: (\S+)(.*)/g), ...release.matchAll(/uses: (\S+)(.*)/g)];
    expect(uses.length).toBeGreaterThan(8);
    for (const [, action, rest] of uses) {
      expect(action, action).toMatch(/@[0-9a-f]{40}$/);
      expect(rest, action).toMatch(/^ # v\d+\.\d+\.\d+$/);
    }
  });

  it("leave no credentials of the checkout behind", () => {
    const checkouts = [...ci.matchAll(/actions\/checkout@\S+.*\n.*\n(.*)/g), ...release.matchAll(/actions\/checkout@\S+.*\n.*\n(.*)/g)];
    expect(checkouts.length).toBe(4);
    for (const [, setting] of checkouts) expect(setting.trim()).toBe("persist-credentials: false");
  });
});
