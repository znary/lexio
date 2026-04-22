import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

function makeTempDir(name: string) {
  return resolve(tmpdir(), `lexio-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
}

describe("copy-chrome-output-to-icloud.sh", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { force: true, recursive: true })
    }
    tempDirs.length = 0
  })

  it("builds first, replaces the fixed iCloud directory, and copies the fresh output", () => {
    const sandboxDir = makeTempDir("copy-chrome-output")
    const repoRoot = join(sandboxDir, "repo")
    const sourceDir = join(repoRoot, ".output", "chrome-mv3")
    const iCloudRoot = join(sandboxDir, "icloud")
    const destinationDir = join(iCloudRoot, "lexio-chrome-mv3")
    const buildScript = join(sandboxDir, "build-output.sh")
    const scriptPath = resolve(process.cwd(), "scripts/copy-chrome-output-to-icloud.sh")

    tempDirs.push(sandboxDir)

    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, "version.txt"), "stale-output")

    mkdirSync(destinationDir, { recursive: true })
    writeFileSync(join(destinationDir, "old.txt"), "old-copy")

    writeFileSync(buildScript, `#!/usr/bin/env bash
set -euo pipefail
rm -rf "$ROOT_DIR_OVERRIDE/.output/chrome-mv3"
mkdir -p "$ROOT_DIR_OVERRIDE/.output/chrome-mv3/_locales/en"
printf 'fresh-output' > "$ROOT_DIR_OVERRIDE/.output/chrome-mv3/version.txt"
printf '{ "message": "Hello" }' > "$ROOT_DIR_OVERRIDE/.output/chrome-mv3/_locales/en/messages.json"
printf 'built' > "$ROOT_DIR_OVERRIDE/build-ran.txt"
`)
    chmodSync(buildScript, 0o755)

    const output = execFileSync("bash", [scriptPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        BUILD_SCRIPT: buildScript,
        ICLOUD_ROOT_OVERRIDE: iCloudRoot,
        ROOT_DIR_OVERRIDE: repoRoot,
      },
    })

    expect(output).toContain(destinationDir)
    expect(readFileSync(join(repoRoot, "build-ran.txt"), "utf8")).toBe("built")
    expect(readFileSync(join(destinationDir, "version.txt"), "utf8")).toBe("fresh-output")
    expect(readFileSync(join(destinationDir, "_locales", "en", "messages.json"), "utf8")).toContain("Hello")
    expect(existsSync(join(destinationDir, "old.txt"))).toBe(false)
    expect(existsSync(join(destinationDir, "chrome-mv3"))).toBe(false)
    expect(readdirSync(iCloudRoot).filter(name => name.startsWith(".lexio-chrome-mv3.tmp.")).length).toBe(0)
  })
})
