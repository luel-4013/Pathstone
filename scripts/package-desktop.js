#!/usr/bin/env node
'use strict';

/*
 * Build Pathstone desktop packages for the current OS or for another target.
 *
 *   npm run desktop:dist
 *   npm run desktop:dist -- --platform all --clean
 *   npm run desktop:dist -- --platform linux --targets @reforged/maker-appimage
 *
 * Electron Forge does the packaging; this wrapper adds target validation,
 * host/toolchain checks, artifact discovery, and a stable summary. Every
 * artifact lands under out/, which is ignored by git.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  HOST_PLATFORM,
  TARGET_PLATFORMS,
  TARGET_ARCHES,
  getBuildPlan,
  getPlatformLabel,
} = require('./packaging');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'out');
const MAKE_DIR = path.join(OUT_DIR, 'make');
const pkg = require(path.join(ROOT, 'package.json'));

let FORGE_CLI;
try {
  FORGE_CLI = require.resolve('@electron-forge/cli/dist/electron-forge.js');
} catch {
  console.error('Electron Forge is not installed. Run `npm ci` first.');
  process.exit(1);
}

const ARTIFACT_EXTENSIONS = new Set([
  '.appimage',
  '.deb',
  '.dmg',
  '.exe',
  '.flatpak',
  '.msi',
  '.nupkg',
  '.pkg',
  '.rpm',
  '.snap',
  '.zip',
]);
const ARTIFACT_NAMES = new Set(['releases', 'releases.json']);

function usage() {
  console.log(`Usage: npm run desktop:dist -- [options]

Options:
  -p, --platform <name>   linux, win32, darwin, or all (default: host)
  -a, --arch <name>       x64 or arm64 (default: host architecture)
      --targets <names>   Comma-separated Forge maker names to run
      --clean             Remove out/ before building
      --from-package      Make artifacts from the existing packaged app
      --dry-run           Show the build commands without running them
      --list              Show available makers and missing tools
  -h, --help              Show this help

Artifacts are written under out/make and are ignored by git.

Examples:
  npm run desktop:dist
  npm run desktop:dist -- --clean
  npm run desktop:dist -- --platform all
  npm run desktop:dist -- --platform linux --targets @reforged/maker-appimage
`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(2);
}

function normalizePlatform(value) {
  const key = String(value || '').toLowerCase();
  const aliases = {
    linux: 'linux',
    win: 'win32',
    windows: 'win32',
    win32: 'win32',
    mac: 'darwin',
    macos: 'darwin',
    osx: 'darwin',
    darwin: 'darwin',
    all: 'all',
  };
  const platform = aliases[key];
  if (!platform) {
    fail(`unknown platform "${value}" (use linux, win32, darwin, or all)`);
  }
  return platform;
}

function parseArch(value) {
  const arch = String(value || '').toLowerCase();
  if (!TARGET_ARCHES.includes(arch)) {
    fail(`unknown architecture "${value}" (use ${TARGET_ARCHES.join(' or ')})`);
  }
  return arch;
}

function parseArgs(argv) {
  const options = {
    platforms: null,
    explicitPlatform: false,
    arch: process.arch,
    targets: null,
    clean: false,
    fromPackage: false,
    dryRun: false,
    list: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    let argument = argv[index];
    let inlineValue;

    const equals = argument.indexOf('=');
    if (argument.startsWith('--') && equals !== -1) {
      inlineValue = argument.slice(equals + 1);
      argument = argument.slice(0, equals);
    }

    const value = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      if (index >= argv.length || argv[index].startsWith('-')) {
        fail(`${argument} needs a value`);
      }
      return argv[index];
    };

    switch (argument) {
      case '-p':
      case '--platform': {
        const requested = normalizePlatform(value());
        options.platforms = requested === 'all' ? TARGET_PLATFORMS.slice() : [requested];
        options.explicitPlatform = requested !== 'all';
        break;
      }
      case '-a':
      case '--arch':
        options.arch = parseArch(value());
        break;
      case '--targets':
        options.targets = value()
          .split(',')
          .map((target) => target.trim())
          .filter(Boolean);
        if (options.targets.length === 0) fail('--targets needs at least one maker name');
        break;
      case '--clean':
        options.clean = true;
        break;
      case '--from-package':
        options.fromPackage = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--list':
        options.list = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        fail(`unknown option "${argument}"`);
    }
  }

  if (options.clean && options.fromPackage) {
    fail('--clean and --from-package cannot be used together');
  }

  return options;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function listArtifacts() {
  const found = [];
  if (!fs.existsSync(MAKE_DIR)) return found;

  const pending = [MAKE_DIR];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();
      if (ARTIFACT_EXTENSIONS.has(extension) || ARTIFACT_NAMES.has(entry.name.toLowerCase())) {
        found.push(fullPath);
      }
    }
  }

  return found.sort();
}

function describeArtifact(file) {
  try {
    return `${formatBytes(fs.statSync(file).size).padStart(10)}  ${path.relative(ROOT, file)}`;
  } catch {
    return `     unknown  ${path.relative(ROOT, file)}`;
  }
}

function outputIsIgnored() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return true;
  const result = spawnSync('git', ['check-ignore', '-q', 'out'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function printList(platforms) {
  console.log(`Host: ${HOST_PLATFORM} ${process.arch}`);
  console.log(`Pathstone: ${pkg.version}`);
  console.log('');

  for (const platform of platforms) {
    const plan = getBuildPlan(platform);
    console.log(`${getPlatformLabel(platform)}:`);
    for (const maker of plan.available) {
      console.log(`  [ready]    ${maker.label} (${maker.name})`);
    }
    for (const maker of plan.skipped) {
      console.log(`  [skipped]  ${maker.label} - ${maker.reason}`);
    }
    if (plan.available.length === 0 && plan.skipped.length === 0) {
      console.log('  [none]     no makers configured');
    }
    console.log('');
  }
}

function forgeArgs(platform, arch, options) {
  const args = [FORGE_CLI, 'make', '--platform', platform, '--arch', arch];
  if (options.targets && options.targets.length > 0) {
    args.push('--targets', options.targets.join(','));
  }
  if (options.fromPackage) args.push('--from-package');
  return args;
}

function buildPlatform(platform, arch, options) {
  const plan = getBuildPlan(platform);

  console.log('');
  console.log(`==> ${getPlatformLabel(platform)} | ${arch}`);
  for (const maker of plan.available) {
    console.log(`    ready: ${maker.label} (${maker.name})`);
  }
  for (const maker of plan.skipped) {
    console.log(`    skip:  ${maker.label} - ${maker.reason}`);
  }

  let targets = options.targets;
  if (targets) {
    const availableNames = new Set(plan.available.map((maker) => maker.name));
    const unavailable = targets.filter((target) => !availableNames.has(target));
    if (unavailable.length > 0) {
      console.error(`    error: target(s) unavailable on this host: ${unavailable.join(', ')}`);
      return { ok: false, artifacts: [] };
    }
  } else if (plan.available.length === 0) {
    const message = `no maker can build ${platform} on ${HOST_PLATFORM} ${process.arch}`;
    if (options.explicitPlatform) {
      console.error(`    error: ${message}`);
      return { ok: false, artifacts: [] };
    }
    console.log(`    skipped: ${message}`);
    return { ok: true, skipped: true, artifacts: [] };
  }

  const args = forgeArgs(platform, arch, options);
  console.log(`    command: ${process.execPath} ${args.map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')}`);

  if (options.dryRun) {
    return { ok: true, dryRun: true, artifacts: [] };
  }

  const before = new Map(
    listArtifacts().map((file) => {
      try {
        return [file, fs.statSync(file).mtimeMs];
      } catch {
        return [file, 0];
      }
    })
  );
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATHSTONE_PACKAGE_PLATFORM: platform,
      PATHSTONE_PACKAGE_ARCH: arch,
    },
  });

  if (result.error) {
    console.error(`    error: ${result.error.message}`);
    return { ok: false, artifacts: [] };
  }
  if (result.status !== 0) {
    console.error(`    error: electron-forge exited with status ${result.status}`);
    return { ok: false, artifacts: [] };
  }

  const artifacts = listArtifacts().filter((file) => {
    if (!before.has(file)) return true;
    try {
      return fs.statSync(file).mtimeMs !== before.get(file);
    } catch {
      return false;
    }
  });
  if (artifacts.length === 0) {
    console.log('    warning: build succeeded but no new artifact was discovered under out/make');
  }

  return { ok: true, artifacts };
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  const platforms = options.platforms || (options.list ? TARGET_PLATFORMS.slice() : [HOST_PLATFORM]);
  if (!TARGET_PLATFORMS.includes(HOST_PLATFORM)) {
    fail(`unsupported host platform "${HOST_PLATFORM}" (supported: ${TARGET_PLATFORMS.join(', ')})`);
  }
  if (!TARGET_ARCHES.includes(options.arch)) {
    fail(`unsupported host architecture "${options.arch}" (supported: ${TARGET_ARCHES.join(', ')})`);
  }

  if (options.list) {
    printList(platforms);
    return;
  }

  console.log(`Pathstone ${pkg.version} desktop packages`);
  console.log(`Host: ${HOST_PLATFORM} ${process.arch}`);
  console.log(`Targets: ${platforms.map((platform) => `${platform}/${options.arch}`).join(', ')}`);

  if (!outputIsIgnored()) {
    console.warn('warning: out/ is not ignored by git; add it to .gitignore before committing');
  }

  if (options.clean) {
    if (options.dryRun) {
      console.log('Would remove out/');
    } else {
      fs.rmSync(OUT_DIR, { recursive: true, force: true });
      console.log('Removed out/');
    }
  }

  const built = [];
  let failures = 0;
  let skipped = 0;

  for (const platform of platforms) {
    const result = buildPlatform(platform, options.arch, options);
    if (!result.ok) {
      failures += 1;
      continue;
    }
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    built.push(...result.artifacts);
  }

  console.log('');
  if (built.length > 0) {
    console.log(`Artifacts (${built.length}):`);
    for (const artifact of built) {
      console.log(`  ${describeArtifact(artifact)}`);
    }
  } else if (options.dryRun) {
    console.log('Dry run: no artifacts were built.');
  } else {
    console.log('No artifacts were built.');
  }
  if (skipped > 0) console.log(`Skipped targets: ${skipped}`);
  if (failures > 0) {
    console.error(`Failed targets: ${failures}`);
    process.exitCode = 1;
  } else if (built.length === 0 && !options.dryRun) {
    process.exitCode = 1;
  }
}

main();
