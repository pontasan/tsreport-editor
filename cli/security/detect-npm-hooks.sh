#!/bin/bash

# ================================================================================================
# Inspect npm dependencies for lifecycle hooks without installing their runtime files or executing
# their scripts, then write JSON and HTML reports.
#
# Usage:
#   detect-npm-hooks.sh /path/to/package.json /path/to/output-dir [npm install args...]
#
# Arguments:
#   1. /path/to/package.json
#      The package.json to inspect. Its containing directory is treated as the project root.
#   2. /path/to/output-dir
#      The report directory. It is created when it does not exist.
#   3. [npm install args...]
#      Optional arguments forwarded to npm install so registry and authentication resolution match
#      the real installation environment.
#
# Example:
#   cli/security/detect-npm-hooks.sh src/package.json /tmp/npm-hook-report
#
# Output:
#   /path/to/output-dir/npm-hook-report.json
#   /path/to/output-dir/npm-hook-report.html
#
# Notes:
# - The input project is copied to a temporary directory. Its package-lock.json and node_modules
#   remain unchanged.
# - npm install runs with --package-lock-only --ignore-scripts, so node_modules is not created and
#   lifecycle scripts are not executed.
# - Package tarballs are fetched with npm pack and inspected without executing their hooks.
# - Remote packages are classified only after the fetched tarball matches package-lock integrity.
# - Results correspond to the npm, Node.js, OS, CPU, .npmrc, and extra npm arguments used here.
# - Package inspection is parallel. Set NPM_HOOK_REPORT_CONCURRENCY to change concurrency.
# ================================================================================================

set -euo pipefail

if [ $# -lt 2 ]; then
    echo "usage: $0 /path/to/package.json /path/to/output-dir [npm install args...]" >&2
    exit 2
fi

PKG_JSON_ABS="$(node -e 'const path=require("path"); console.log(path.resolve(process.argv[1]))' "$1")"
OUT_DIR_ABS="$(node -e 'const path=require("path"); console.log(path.resolve(process.argv[1]))' "$2")"
shift 2

if [ ! -f "$PKG_JSON_ABS" ]; then
    echo "package.json not found: $PKG_JSON_ABS" >&2
    exit 2
fi

ROOT_DIR="$(cd "$(dirname "$PKG_JSON_ABS")" && pwd)"
TMP_DIR="$(mktemp -d)"
PROJECT_DIR="$TMP_DIR/project"
PACK_DIR="$TMP_DIR/packs"
NPM_ARGS_JSON="$(node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- "$@")"
export NPM_HOOK_REPORT_NPM_ARGS_JSON="$NPM_ARGS_JSON"

cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$PROJECT_DIR" "$PACK_DIR" "$OUT_DIR_ABS"

copy_project() {
    if command -v rsync >/dev/null 2>&1; then
        rsync -a \
            --exclude=".git" \
            --exclude="node_modules" \
            --exclude=".next" \
            --exclude="dist" \
            --exclude="coverage" \
            "$ROOT_DIR"/ "$PROJECT_DIR"/
    else
        (cd "$ROOT_DIR" && tar \
            --exclude="./.git" \
            --exclude="./node_modules" \
            --exclude="./.next" \
            --exclude="./dist" \
            --exclude="./coverage" \
            -cf - .) | (cd "$PROJECT_DIR" && tar -xf -)
    fi
}

echo "==> Copying project to temporary directory..." >&2
copy_project

echo "==> Resolving npm dependency graph without running lifecycle scripts..." >&2
if ! (
    cd "$PROJECT_DIR"
    npm install --package-lock-only --ignore-scripts --no-audit --no-fund "$@" >/dev/null
); then
    echo "ERROR: npm dependency resolution failed. Check package.json, package-lock.json, .npmrc, registry access, and npm install args." >&2
    exit 1
fi

echo "==> Inspecting package lifecycle hooks..." >&2
node - "$PROJECT_DIR" "$PACK_DIR" "$OUT_DIR_ABS" <<'NODE'
const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const crypto = require('crypto')
const { promisify } = require('util')

const projectDir = process.argv[2]
const packDir = process.argv[3]
const outDir = process.argv[4]
const execFileAsync = promisify(cp.execFile)

const outputJsonPath = path.join(outDir, 'npm-hook-report.json')
const outputHtmlPath = path.join(outDir, 'npm-hook-report.html')
const lockPath = path.join(projectDir, 'package-lock.json')
const npmInstallArgs = JSON.parse(process.env.NPM_HOOK_REPORT_NPM_ARGS_JSON || '[]')
const inspectionConcurrency = Math.max(1, Number.parseInt(process.env.NPM_HOOK_REPORT_CONCURRENCY || '8', 10) || 8)

// Lifecycle hooks that npm install may execute for external registry tarball dependencies.
const registryInstallLifecycleHooks = [
  'preinstall',
  'install',
  'postinstall'
]

// Registry tarballs do not run prepare hooks during a normal install. npm documents that
// non-registry dependencies such as git sources install their dependencies and run prepare before
// packaging, so prepare hooks are included only for file, link, and git dependencies.
const nonRegistryOnlyInstallLifecycleHooks = [
  'preprepare',
  'prepare',
  'postprepare'
]

// Pack and publish hooks are reported for reference but are not classified as npm install hooks.
const nonInstallLifecycleHooks = [
  ...nonRegistryOnlyInstallLifecycleHooks,
  'prepublishOnly',
  'prepack',
  'postpack'
]

// A root project's prepublish hook may run during npm install or npm ci, but it is not an execution
// point for ordinary external dependencies under node_modules. This report evaluates external
// dependency install scripts, so prepublish is excluded from per-package detection.
const excludedLifecycleHooks = [
  'prepublish'
]

const lifecycleHooks = [
  ...registryInstallLifecycleHooks,
  ...nonInstallLifecycleHooks
]

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function safeReadPackageJson(filePath) {
  try {
    return readJson(filePath)
  } catch (error) {
    return undefined
  }
}

function nameFromPackageLockPath(packagePath) {
  const parts = packagePath.split('/node_modules/')
  let tail = parts[parts.length - 1]
  if (tail.startsWith('node_modules/')) {
    tail = tail.slice('node_modules/'.length)
  }
  if (!tail || tail === 'node_modules') {
    return undefined
  }
  const segments = tail.split('/')
  if (segments[0]?.startsWith('@')) {
    return segments[1] ? `${segments[0]}/${segments[1]}` : undefined
  }
  return segments[0]
}

function isNodeModulePath(packagePath) {
  return packagePath === 'node_modules' ||
    packagePath.startsWith('node_modules/') ||
    packagePath.includes('/node_modules/')
}

function resolveFileSpec(spec) {
  // A file dependency outside the input project is absent from the temporary copy, so its
  // package.json cannot be trusted and the dependency remains unresolved.
  const value = spec.replace(/^file:/, '')
  return path.resolve(projectDir, value)
}

function isGitLikeResolved(resolved) {
  return Boolean(resolved) && (
    /^git(\+|:)/.test(resolved) ||
    /^(github|gitlab|bitbucket):/.test(resolved)
  )
}

function dependencySourceType(record) {
  if (record.linkTarget || record.dependencyType === 'link') {
    return 'link'
  }
  if (record.resolved?.startsWith('file:')) {
    return 'file'
  }
  if (isGitLikeResolved(record.resolved)) {
    return 'git'
  }
  return 'registry-or-remote-tarball'
}

function installHooksForRecord(record) {
  const baseHooks = [...registryInstallLifecycleHooks]
  const sourceType = dependencySourceType(record)
  if (sourceType === 'file' || sourceType === 'link' || sourceType === 'git') {
    return [...baseHooks, ...nonRegistryOnlyInstallLifecycleHooks]
  }
  return baseHooks
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd || projectDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 20
  })
  return result.stdout
}

function npmNetworkConfigArgs(args) {
  const result = []
  const optionTakesValue = new Set([
    '--registry',
    '--userconfig',
    '--cert',
    '--key',
    '--cafile',
    '--ca',
    '--proxy',
    '--https-proxy',
    '--noproxy'
  ])
  const booleanNetworkOptions = new Set([
    '--strict-ssl'
  ])
  const negatedNetworkOptions = new Set([
    '--no-strict-ssl',
    '--no-proxy',
    '--no-https-proxy',
    '--no-noproxy'
  ])

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const isNetworkConfig =
      arg.startsWith('--//') ||
      /^--@[^=]+:registry(=|$)/.test(arg) ||
      optionTakesValue.has(arg) ||
      [...optionTakesValue].some((name) => arg.startsWith(`${name}=`)) ||
      booleanNetworkOptions.has(arg) ||
      [...booleanNetworkOptions].some((name) => arg.startsWith(`${name}=`)) ||
      negatedNetworkOptions.has(arg)

    if (!isNetworkConfig) {
      continue
    }

    result.push(arg)
    if (optionTakesValue.has(arg) && args[i + 1] && !args[i + 1].startsWith('-')) {
      result.push(args[i + 1])
      i++
    }
  }

  return result
}

const npmNetworkArgs = npmNetworkConfigArgs(npmInstallArgs)

function npmOmitTypes(args) {
  const result = new Set()
  if (process.env.NODE_ENV === 'production') {
    result.add('dev')
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--production' || arg === '--only=prod' || arg === '--only=production') {
      result.add('dev')
      continue
    }
    if (arg === '--production=false') {
      result.delete('dev')
      continue
    }
    if (arg === '--omit' && args[i + 1]) {
      for (const value of args[i + 1].split(',')) {
        if (value) result.add(value)
      }
      i++
      continue
    }
    if (arg.startsWith('--omit=')) {
      for (const value of arg.slice('--omit='.length).split(',')) {
        if (value) result.add(value)
      }
      continue
    }
    if (arg === '--include' && args[i + 1]) {
      for (const value of args[i + 1].split(',')) {
        result.delete(value)
      }
      i++
      continue
    }
    if (arg.startsWith('--include=')) {
      for (const value of arg.slice('--include='.length).split(',')) {
        result.delete(value)
      }
    }
  }

  return result
}

const omittedDependencyTypes = npmOmitTypes(npmInstallArgs)

function shouldOmitPackageFromReport(pkg) {
  return (omittedDependencyTypes.has('dev') && pkg.dev === true) ||
    (omittedDependencyTypes.has('optional') && pkg.optional === true) ||
    (omittedDependencyTypes.has('peer') && pkg.peer === true)
}

async function npmPack(spec) {
  const packagePackDir = fs.mkdtempSync(path.join(packDir, 'pack-'))
  // npm pack retrieves the tarball package.json. --ignore-scripts prevents prepack, prepare,
  // postpack, and other lifecycle hooks from running. Only a tarball matching package-lock
  // integrity is trusted for hook classification.
  const output = run('npm', [
    'pack',
    spec,
    '--ignore-scripts',
    '--pack-destination',
    packagePackDir,
    '--silent',
    '--json',
    ...npmNetworkArgs
  ])
  const stdout = await output
  const parsed = JSON.parse(stdout)
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0].filename) {
    throw new Error(`unexpected npm pack output for ${spec}`)
  }
  return path.join(packagePackDir, parsed[0].filename)
}

async function readPackageJsonFromTarball(tarballPath) {
  const entries = (await run('tar', ['-tf', tarballPath]))
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  const candidates = entries
    .filter((entry) => entry === 'package/package.json' || entry.endsWith('/package.json'))
    .sort((a, b) => {
      if (a === 'package/package.json') return -1
      if (b === 'package/package.json') return 1
      const depth = a.split('/').length - b.split('/').length
      return depth || a.length - b.length || a.localeCompare(b)
    })

  if (candidates.length === 0) {
    throw new Error('package.json was not found in tarball')
  }

  const entry = candidates[0]
  const output = run('tar', ['-xOf', tarballPath, entry])
  return { packageJson: JSON.parse(await output), entry }
}

function verifyTarballIntegrity(tarballPath, expectedIntegrity) {
  if (!expectedIntegrity) {
    return { status: 'not-provided' }
  }

  const data = fs.readFileSync(tarballPath)
  const supported = []
  for (const token of expectedIntegrity.split(/\s+/).filter(Boolean)) {
    const sep = token.indexOf('-')
    if (sep === -1) {
      continue
    }
    const algorithm = token.slice(0, sep)
    const expected = token.slice(sep + 1)
    if (!crypto.getHashes().includes(algorithm)) {
      continue
    }
    const actual = crypto.createHash(algorithm).update(data).digest('base64')
    supported.push({ algorithm, expected, actual })
    if (actual === expected) {
      return { status: 'matched', algorithm }
    }
  }

  if (supported.length === 0) {
    return { status: 'unsupported', expectedIntegrity }
  }

  return {
    status: 'mismatch',
    expectedIntegrity,
    checked: supported.map(({ algorithm, actual }) => ({ algorithm, actual }))
  }
}

async function inspectScripts(record) {
  const { name, version, resolved, linkTarget } = record

  if (linkTarget) {
    const pkg = safeReadPackageJson(path.join(linkTarget, 'package.json'))
    if (pkg) {
      return {
        scripts: pkg.scripts || {},
        lookup: {
          method: 'local-link-package-json',
          verificationStatus: 'local-verified',
          reason: 'linked package.json was read from the copied project',
          integrity: { status: 'not-applicable' }
        }
      }
    }

    return {
      scripts: {},
      lookup: {
        method: 'local-link-package-json',
        verificationStatus: 'unresolved',
        reason: 'linked package.json could not be read',
        integrity: { status: 'not-applicable' },
        error: `package.json not found or unreadable: ${path.join(linkTarget, 'package.json')}`
      }
    }
  }

  if (resolved?.startsWith('file:')) {
    const packageJsonPath = path.join(resolveFileSpec(resolved), 'package.json')
    const pkg = safeReadPackageJson(packageJsonPath)
    if (pkg) {
      return {
        scripts: pkg.scripts || {},
        lookup: {
          method: 'local-file-package-json',
          verificationStatus: 'local-verified',
          reason: 'file dependency package.json was read from the copied project',
          integrity: { status: 'not-applicable' }
        }
      }
    }

    return {
      scripts: {},
      lookup: {
        method: 'local-file-package-json',
        verificationStatus: 'unresolved',
        reason: 'file dependency package.json could not be read',
        integrity: { status: 'not-applicable' },
        error: `package.json not found or unreadable: ${packageJsonPath}`
      }
    }
  }

  if (!record.integrity) {
    return {
      scripts: {},
      lookup: {
        method: 'remote-package-without-integrity',
        verificationStatus: 'unsupported',
        reason: 'package-lock.json does not include integrity for this remote dependency',
        integrity: { status: 'not-provided' },
        error: 'remote dependencies require lockfile integrity to make a trusted preinstall hook decision'
      }
    }
  }

  const specs = []
  if (resolved && (/^https?:\/\//.test(resolved) || isGitLikeResolved(resolved))) {
    specs.push(resolved)
  }
  if (name && version) {
    specs.push(`${name}@${version}`)
  }

  const errors = []
  for (const spec of specs) {
    try {
      const tgz = await npmPack(spec)
      const integrity = verifyTarballIntegrity(tgz, record.integrity)
      if (integrity.status !== 'matched') {
        return {
          scripts: {},
          lookup: {
            method: 'npm-pack-tarball',
            spec,
            verificationStatus: integrity.status === 'mismatch' ? 'integrity-mismatch' : 'unsupported',
            integrity,
            reason: integrity.status === 'mismatch'
              ? 'tarball integrity does not match package-lock.json'
              : 'tarball integrity could not be verified with a supported algorithm',
            error: integrity.status === 'mismatch'
              ? 'downloaded tarball differs from the lockfile integrity'
              : `unsupported or unverifiable integrity: ${record.integrity}`
          }
        }
      }
      const { packageJson: pkg, entry } = await readPackageJsonFromTarball(tgz)
      return {
        scripts: pkg.scripts || {},
        lookup: {
          method: 'npm-pack-tarball',
          spec,
          tarballPackageJsonPath: entry,
          verificationStatus: 'verified',
          integrity,
          reason: 'tarball package.json was read and matched package-lock.json integrity'
        }
      }
    } catch (error) {
      errors.push(`${spec}: ${error.message}`)
    }
  }

  return {
    scripts: {},
    lookup: {
      method: 'unresolved',
      verificationStatus: 'unresolved',
      reason: 'trusted package.json could not be read from a verified tarball',
      integrity: { status: 'not-checked' },
      error: errors.join(' | ')
    }
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let index = 0

  async function worker() {
    while (index < items.length) {
      const current = index
      index++
      results[current] = await mapper(items[current], current)
    }
  }

  const workers = []
  const workerCount = Math.min(limit, items.length)
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}

function buildHookResult(scripts, installHooks, lockHasInstallScript) {
  const hooks = {}
  let hasInstallHook = false
  let hasNonInstallHook = false
  for (const hook of lifecycleHooks) {
    const value = Object.prototype.hasOwnProperty.call(scripts, hook) ? String(scripts[hook]) : null
    hooks[hook] = value
    if (value === null) {
      continue
    }
    if (installHooks.includes(hook)) {
      hasInstallHook = true
    }
    if (!installHooks.includes(hook)) {
      hasNonInstallHook = true
    }
  }
  if (lockHasInstallScript && !hasInstallHook && installHooks.includes('install') && hooks.install === null) {
    hooks.install = 'package-lock.json の hasInstallScript=true により npm が install script ありとして扱う'
    hasInstallHook = true
  }
  return { hasHook: hasInstallHook, hasInstallHook, hasNonInstallHook, hooks }
}

function canTrustScripts(lookup) {
  return lookup.verificationStatus === 'verified' || lookup.verificationStatus === 'local-verified'
}

function buildHookDetermination({ lookup, hasHook, hooks, installHooks }) {
  const hookNames = installHooks.filter((hook) => hooks[hook] !== null)

  if (!canTrustScripts(lookup)) {
    return {
      hookStatus: 'unknown',
      hookReason: '',
      undeterminedReason: lookup.reason || lookup.error || 'package scripts could not be verified'
    }
  }

  if (hasHook) {
    return {
      hookStatus: 'present',
      hookReason: `lifecycle hooks found: ${hookNames.join(', ')}`,
      undeterminedReason: ''
    }
  }

  return {
    hookStatus: 'absent',
    hookReason: 'trusted package.json was checked and no lifecycle hooks were found',
    undeterminedReason: ''
  }
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function label(value, labels) {
  return labels[value] || String(value ?? '')
}

function verificationStatusLabel(value) {
  return label(value, {
    verified: '検証済み',
    'local-verified': 'ローカル検証済み',
    unsupported: '未対応',
    unresolved: '確認不能',
    'integrity-mismatch': 'integrity 不一致'
  })
}

function integrityStatusLabel(value) {
  return label(value, {
    matched: '一致',
    mismatch: '不一致',
    'not-provided': '未提供',
    'not-applicable': '対象外',
    'not-checked': '未確認',
    unsupported: '未対応',
    unknown: '不明'
  })
}

function verificationSourceLabel(value) {
  return label(value, {
    'local-link-package-json': 'link 依存先の package.json',
    'local-file-package-json': 'file 依存先の package.json',
    'remote-package-without-integrity': 'integrity のない remote 依存',
    'npm-pack-tarball': 'npm pack で取得した tarball',
    unresolved: '確認不能'
  })
}

function reasonLabel(value) {
  return label(value, {
    'linked package.json was read from the copied project': '一時ディレクトリへコピーした link 依存先の package.json を読み取った',
    'linked package.json could not be read': 'link 依存先の package.json を読み取れなかった',
    'file dependency package.json was read from the copied project': '一時ディレクトリへコピーした file 依存先の package.json を読み取った',
    'file dependency package.json could not be read': 'file 依存先の package.json を読み取れなかった',
    'package-lock.json does not include integrity for this remote dependency': 'この remote 依存の integrity が package-lock.json に存在しない',
    'tarball integrity does not match package-lock.json': '取得した tarball の integrity が package-lock.json と一致しない',
    'tarball integrity could not be verified with a supported algorithm': '対応しているアルゴリズムで tarball の integrity を検証できなかった',
    'tarball package.json was read and matched package-lock.json integrity': 'tarball の package.json を読み取り、package-lock.json の integrity と一致した',
    'trusted package.json could not be read from a verified tarball': 'integrity 検証済み tarball から信頼できる package.json を読み取れなかった',
    'package scripts could not be verified': 'package scripts を信頼できる形で確認できなかった',
    'trusted package.json was checked and no lifecycle hooks were found': '信頼できる package.json を確認し、対象 lifecycle hook が存在しなかった'
  })
}

function hookStatusLabel(value) {
  return label(value, {
    present: '該当あり',
    absent: '該当なし',
    unknown: '判定不能'
  })
}

function dependencySourceTypeLabel(value) {
  return label(value, {
    file: 'file 依存',
    link: 'link 依存',
    git: 'git 依存',
    'registry-or-remote-tarball': 'registry または remote tarball'
  })
}

function undeterminedReasonLabel(item) {
  return item.undeterminedReason ? reasonLabel(item.undeterminedReason) : ''
}

function renderHtml(report) {
  const allowScriptsEntries = report
    .filter((item) => item.hookStatus === 'present')
    .map((item) => `${item.name}@${item.version}`)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b))
  const allowScriptsExample = {
    allowScripts: Object.fromEntries(allowScriptsEntries.map((name) => [name, true]))
  }
  const npmrcExample = 'strict-allow-scripts=true'

  const installHookDescriptions = [
    ['preinstall', '外部依存モジュールがインストールされる前に実行され得る。'],
    ['install', '外部依存モジュールのインストール時に実行され得る。ネイティブビルドや追加ファイル生成に使われることがある。package-lock.json の hasInstallScript=true も npm が install script ありとして扱う根拠に含める。'],
    ['postinstall', '外部依存モジュールがインストールされた後に実行され得る。npm install 時の悪用事例で特に注意対象になりやすい。'],
    ['preprepare', 'prepare の前に実行され得る。file/link/git などの non-registry 依存だけ npm install 評価対象に含める。'],
    ['prepare', 'パッケージの準備処理として実行され得る。registry tarball 依存では npm install 評価対象外、file/link/git などの non-registry 依存では npm install 評価対象。'],
    ['postprepare', 'prepare の後に実行され得る。file/link/git などの non-registry 依存だけ npm install 評価対象に含める。']
  ]

  const nonInstallHookDescriptions = [
    ['preprepare', 'registry tarball 依存では npm install 評価対象外。file/link/git などの non-registry 依存では npm install 評価対象。'],
    ['prepare', 'registry tarball 依存では npm install 評価対象外。file/link/git などの non-registry 依存では npm install 評価対象。'],
    ['postprepare', 'registry tarball 依存では npm install 評価対象外。file/link/git などの non-registry 依存では npm install 評価対象。'],
    ['prepublishOnly', 'npm publish 用。通常の npm install による外部依存モジュールの不正実行評価には含めない。'],
    ['prepack', 'npm pack 用。通常の npm install による外部依存モジュールの不正実行評価には含めない。'],
    ['postpack', 'npm pack 用。通常の npm install による外部依存モジュールの不正実行評価には含めない。'],
    ['prepublish', 'publish 前に package を利用可能な状態へ準備するための古い lifecycle hook。npm の歴史的経緯により、対象プロジェクト自身で npm install/npm ci を実行した場合には root project の prepublish が動き得る。一方、node_modules に入る外部依存モジュールの通常 install 時実行点としては扱わないため、このレポートでは per-package の検査対象から外す。新規用途では deprecated であり、準備処理は prepare、publish 専用処理は prepublishOnly を使うべきもの。']
  ]

  const installHookDescriptionRows = installHookDescriptions
    .map(([name, description]) => `<tr><th><code>${htmlEscape(name)}</code></th><td>${htmlEscape(description)}</td></tr>`)
    .join('\n')
  const nonInstallHookDescriptionRows = nonInstallHookDescriptions
    .map(([name, description]) => `<tr><th><code>${htmlEscape(name)}</code></th><td>${htmlEscape(description)}</td></tr>`)
    .join('\n')
  const columnDescriptions = [
    ['モジュール', 'package-lock.json 上の外部依存モジュール名。対象プロジェクト自身の scripts は含めない。'],
    ['バージョン', 'package-lock.json または package.json で解決されたバージョン。'],
    ['配置パス', 'package-lock.json の packages キー。依存がどこに配置される想定かを示す。'],
    ['依存種別', 'package-lock.json から判定した依存の種別。file/link/git は non-registry 依存として prepare 系も npm install 評価対象に含める。'],
    ['該当判定', 'npm install によって外部依存モジュールで実行され得る lifecycle hook に該当するかどうか。該当あり、該当なし、判定不能のいずれか。判定不能は該当なしとは扱わない。'],
    ['判定不能理由', '該当判定が判定不能になった理由。該当あり/該当なしの場合は空欄。'],
    ['npm install 対象フック名', 'npm install によって外部依存モジュールで実行され得る lifecycle hook のうち、存在した hook 名。'],
    ['npm install 対象フックスクリプト', 'npm install 対象フックの script 本文。HTML エスケープして表示する。'],
    ['npm install 評価対象外フック名', '検出はしたが npm install 評価対象には含めない hook 名。prepublish は外部依存モジュールの通常 install 時実行点として扱わないため、per-package の検出対象からも外す。'],
    ['npm install 評価対象外フックスクリプト', 'npm install 評価対象外フックの script 本文。HTML エスケープして表示する。'],
    ['検証状態', '判定根拠の状態。検証済みは remote tarball を lockfile integrity と照合して一致した状態、ローカル検証済みは root/file/link のローカル package.json を読めた状態、未対応/確認不能/integrity 不一致は該当判定不能として扱う。'],
    ['解決元', 'package-lock.json の resolved。registry tarball URL、file: 参照、git 参照など依存実体の取得元を示す。'],
    ['integrity', 'package-lock.json の integrity と照合結果。remote 依存では integrity が一致した tarball だけを hook 判定に使う。'],
    ['検証元', 'package.json を確認した方法と補足理由。npm-pack-tarball、local-file-package-json、local-link-package-json、unresolved など。内部 JSON では lookup として出力される。']
  ]
  const descriptionRows = columnDescriptions
    .map(([name, description]) => `<tr><th>${htmlEscape(name)}</th><td>${htmlEscape(description)}</td></tr>`)
    .join('\n')

  const rows = report.map((item) => {
    const installHooks = item.installEvaluationHooks || registryInstallLifecycleHooks
    const referenceHooks = item.referenceHooks || nonInstallLifecycleHooks
    const hookNames = installHooks.filter((hook) => item.hooks[hook] !== null)
    const hookDetails = installHooks
      .filter((hook) => item.hooks[hook] !== null)
      .map((name) => [name, item.hooks[name]])
      .map(([name, value]) => `<div><strong>${htmlEscape(name)}</strong>: <code>${htmlEscape(value)}</code></div>`)
      .join('')
    const nonInstallHookNames = referenceHooks.filter((hook) => item.hooks[hook] !== null)
    const nonInstallHookDetails = referenceHooks
      .filter((hook) => item.hooks[hook] !== null)
      .map((name) => [name, item.hooks[name]])
      .map(([name, value]) => `<div><strong>${htmlEscape(name)}</strong>: <code>${htmlEscape(value)}</code></div>`)
      .join('')

    const className = [
      item.hasHook ? 'has-hook' : '',
      item.hookStatus === 'unknown' ? 'unresolved' : '',
      item.integrityStatus === 'mismatch' ? 'integrity-mismatch' : ''
    ].filter(Boolean).join(' ')

    return `<tr class="${className}">
      <td>${htmlEscape(item.name)}</td>
      <td>${htmlEscape(item.version)}</td>
      <td><code>${htmlEscape(item.path)}</code></td>
      <td>${htmlEscape(dependencySourceTypeLabel(item.dependencySourceType))}</td>
      <td>${htmlEscape(hookStatusLabel(item.hookStatus))}</td>
      <td>${htmlEscape(undeterminedReasonLabel(item))}</td>
      <td>${htmlEscape(hookNames.join(', '))}</td>
      <td>${hookDetails}</td>
      <td>${htmlEscape(nonInstallHookNames.join(', '))}</td>
      <td>${nonInstallHookDetails}</td>
      <td>${htmlEscape(verificationStatusLabel(item.verificationStatus))}</td>
      <td><code>${htmlEscape(item.resolved)}</code></td>
      <td><code>${htmlEscape(item.integrity)}</code><br>${htmlEscape(integrityStatusLabel(item.integrityStatus))}</td>
      <td>${htmlEscape(verificationSourceLabel(item.lookup.method))}<br>${htmlEscape(reasonLabel(item.lookup.reason))}${item.lookup.error ? `<br><span class="err">${htmlEscape(item.lookup.error)}</span>` : ''}</td>
    </tr>`
  }).join('\n')

  const hookCount = report.filter((item) => item.hasHook).length
  const nonInstallHookCount = report.filter((item) => item.hasNonInstallHook).length
  const absentHookCount = report.filter((item) => item.hookStatus === 'absent').length
  const unknownHookCount = report.filter((item) => item.hookStatus === 'unknown').length
  const integrityMismatchCount = report.filter((item) => item.integrityStatus === 'mismatch').length

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>npm フック検査レポート</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #202124; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    .meta { margin: 0 0 20px; color: #5f6368; }
    h2 { font-size: 16px; margin: 24px 0 8px; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { border: 1px solid #dadce0; padding: 8px; vertical-align: top; word-break: break-word; font-size: 13px; }
    th { background: #f8f9fa; text-align: left; }
    tr.has-hook { background: #fff8e1; }
    tr.unresolved { background: #fdecea; }
    tr.integrity-mismatch { background: #fce8e6; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    .code-sample {
      margin: 8px 0 16px;
      padding: 12px 14px;
      border: 1px solid #dadce0;
      border-radius: 6px;
      background: #f8f9fa;
      overflow-x: auto;
      white-space: pre;
    }
    .code-sample code {
      display: block;
      line-height: 1.5;
      color: #202124;
    }
    .warn { color: #8a5a00; }
    .err { color: #b00020; }
  </style>
</head>
<body>
  <h1>npm フック検査レポート</h1>
  <p class="meta">パッケージ数: ${report.length} / npm install 対象フック該当あり: ${hookCount} / npm install 対象フック該当なし: ${absentHookCount} / 判定不能: ${unknownHookCount} / npm install 評価対象外フックあり: ${nonInstallHookCount} / integrity 不一致: ${integrityMismatchCount}</p>
  <h2>列の説明</h2>
  <table>
    <tbody>
${descriptionRows}
    </tbody>
  </table>
  <h2>npm install 評価対象フック</h2>
  <table>
    <tbody>
${installHookDescriptionRows}
    </tbody>
  </table>
  <h2>npm install 評価対象外フック</h2>
  <table>
    <tbody>
${nonInstallHookDescriptionRows}
    </tbody>
  </table>
  <h2>npm 設定例</h2>
  <p class="meta">npm 11.16 以降で、install script を持つモジュールを個別に許可するための設定例。本レポートは install script の有無を検出するものであり、モジュールや script の安全性は評価していない。</p>
  <h3>package.json</h3>
  <pre class="code-sample"><code>${htmlEscape(JSON.stringify(allowScriptsExample, null, 2))}</code></pre>
  <h3>.npmrc</h3>
  <p class="meta"><code>strict-allow-scripts=true</code> は、<code>allowScripts</code> で許可されていない依存モジュールの install script をエラーにする設定。</p>
  <pre class="code-sample"><code>${htmlEscape(npmrcExample)}</code></pre>
  <h2>パッケージ別結果</h2>
  <table>
    <thead>
      <tr>
        <th>モジュール</th>
        <th>バージョン</th>
        <th>配置パス</th>
        <th>依存種別</th>
        <th>該当判定</th>
        <th>判定不能理由</th>
        <th>npm install 対象フック名</th>
        <th>npm install 対象フックスクリプト</th>
        <th>npm install 評価対象外フック名</th>
        <th>npm install 評価対象外フックスクリプト</th>
        <th>検証状態</th>
        <th>解決元</th>
        <th>integrity</th>
        <th>検証元</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>
`
}

async function main() {
  const lock = readJson(lockPath)
  const records = []

  for (const [packagePath, pkg] of Object.entries(lock.packages || {})) {
    if (!packagePath || !isNodeModulePath(packagePath)) {
      continue
    }
    if (shouldOmitPackageFromReport(pkg)) {
      continue
    }

    let linkTarget = undefined
    let targetPackage = undefined
    if (pkg.link && pkg.resolved) {
      linkTarget = path.resolve(projectDir, pkg.resolved)
      targetPackage = safeReadPackageJson(path.join(linkTarget, 'package.json'))
    }

    const name = pkg.name || targetPackage?.name || nameFromPackageLockPath(packagePath)
    const version = pkg.version || targetPackage?.version || ''
    if (!name) {
      continue
    }

    records.push({
      name,
      version,
      path: packagePath,
      resolved: pkg.resolved || '',
      integrity: pkg.integrity || '',
      dependencyType: pkg.link ? 'link' : 'dependency',
      lockHasInstallScript: pkg.hasInstallScript === true,
      linkTarget
    })
  }

  const seen = new Set()
  const uniqueRecords = []
  for (const record of records) {
    const key = `${record.path}\n${record.name}\n${record.version}\n${record.resolved}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    uniqueRecords.push(record)
  }

  console.error(`==> Inspecting ${uniqueRecords.length} packages with concurrency=${inspectionConcurrency}...`)

  const report = await mapLimit(uniqueRecords, inspectionConcurrency, async (record) => {
    const inspected = await inspectScripts(record)
    const installEvaluationHooks = installHooksForRecord(record)
    const referenceHooks = lifecycleHooks.filter((hook) => !installEvaluationHooks.includes(hook))
    const dependencyTypeForEvaluation = dependencySourceType(record)
    const { hasHook, hasInstallHook, hasNonInstallHook, hooks } = buildHookResult(inspected.scripts, installEvaluationHooks, record.lockHasInstallScript)
    const verificationStatus = inspected.lookup.verificationStatus || 'unresolved'
    const lookupStatus = verificationStatus
    const integrityStatus = inspected.lookup.integrity?.status || 'unknown'
    const determination = buildHookDetermination({ lookup: inspected.lookup, hasHook, hooks, installHooks: installEvaluationHooks })
    return {
      name: record.name,
      version: record.version,
      path: record.path,
      resolved: record.resolved,
      integrity: record.integrity,
      dependencyType: record.dependencyType,
      lockHasInstallScript: record.lockHasInstallScript,
      dependencySourceType: dependencyTypeForEvaluation,
      installEvaluationHooks,
      referenceHooks,
      lookupStatus,
      inspectionStatus: lookupStatus,
      verificationStatus,
      integrityStatus,
      hookStatus: determination.hookStatus,
      hookReason: determination.hookReason,
      undeterminedReason: determination.undeterminedReason,
      hasHook,
      hasInstallHook,
      hasNonInstallHook,
      hooks,
      allScripts: inspected.scripts,
      lookup: inspected.lookup
    }
  })

  report.sort((a, b) => {
    if (a.hookStatus !== b.hookStatus) {
      if (a.hookStatus === 'present') return -1
      if (b.hookStatus === 'present') return 1
      if (a.hookStatus === 'unknown') return -1
      if (b.hookStatus === 'unknown') return 1
    }
    if (a.verificationStatus !== b.verificationStatus) {
      if (a.verificationStatus === 'integrity-mismatch') return -1
      if (b.verificationStatus === 'integrity-mismatch') return 1
      if (a.verificationStatus === 'unresolved') return -1
      if (b.verificationStatus === 'unresolved') return 1
    }
    return `${a.name}@${a.version}:${a.path}`.localeCompare(`${b.name}@${b.version}:${b.path}`)
  })

  fs.writeFileSync(outputJsonPath, JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync(outputHtmlPath, renderHtml(report))

  console.error(`==> Wrote ${outputJsonPath}`)
  console.error(`==> Wrote ${outputHtmlPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
NODE

echo "JSON: $OUT_DIR_ABS/npm-hook-report.json"
echo "HTML: $OUT_DIR_ABS/npm-hook-report.html"

