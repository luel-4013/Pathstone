'use strict';

/*
 * Shared desktop packaging metadata.
 *
 * `forge.config.js` uses getMakers() to expose only the makers that can run
 * on this host, and scripts/package-desktop.js uses getBuildPlan() to explain
 * which artifacts a target platform will produce and which tools are missing.
 *
 * Makers are selected in three layers:
 *   1. the maker must support the target platform;
 *   2. the current host must be able to run that maker;
 *   3. the required external tools must be installed.
 *
 * This keeps `electron-forge make --platform ...` from failing merely because
 * an optional maker (deb, rpm, dmg, Squirrel) has no toolchain on this host.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

const HOST_PLATFORM = process.platform;
const TARGET_PLATFORMS = ['linux', 'win32', 'darwin'];
const TARGET_ARCHES = ['x64', 'arm64'];

const COMMON = {
  name: 'pathstone',
  productName: 'Pathstone',
  genericName: 'Local-first task and project planner',
  description: pkg.description,
  homepage: pkg.homepage,
  license: pkg.license,
  bin: 'pathstone',
  categories: ['Office', 'Utility'],
};

function commandAvailable(command) {
  if (HOST_PLATFORM === 'win32') {
    return (
      spawnSync('where', [command], {
        stdio: 'ignore',
        windowsHide: true,
      }).status === 0
    );
  }

  return (
    spawnSync('sh', ['-c', `command -v ${command} >/dev/null 2>&1`], {
      stdio: 'ignore',
    }).status === 0
  );
}

function hostSupports(maker) {
  return !maker.hosts || maker.hosts.includes(HOST_PLATFORM);
}

function requiredTools(maker) {
  return typeof maker.tools === 'function' ? maker.tools() : maker.tools || [];
}

function missingTools(maker) {
  return requiredTools(maker).filter((command) => !commandAvailable(command));
}

const MAKER_DEFS = [
  {
    key: 'appimage',
    label: 'AppImage',
    name: '@reforged/maker-appimage',
    platforms: ['linux'],
    hosts: ['linux'],
    tools: ['mksquashfs'],
    installHint: 'squashfs-tools',
    config: {
      options: {
        name: COMMON.name,
        productName: COMMON.productName,
        bin: COMMON.bin,
        genericName: COMMON.genericName,
        categories: COMMON.categories,
        icon: 'icons/icon-512.png',
        keywords: ['tasks', 'projects', 'planner', 'local-first', 'offline'],
      },
    },
  },
  {
    key: 'deb',
    label: 'Debian/Ubuntu .deb',
    name: '@electron-forge/maker-deb',
    platforms: ['linux'],
    hosts: ['linux'],
    tools: ['dpkg-deb', 'fakeroot'],
    installHint: 'dpkg fakeroot',
    config: {
      options: {
        name: COMMON.name,
        productName: COMMON.productName,
        genericName: COMMON.genericName,
        description: COMMON.description,
        maintainer: 'luel-4013 <luelworkneh@gmail.com>',
        homepage: COMMON.homepage,
        bin: COMMON.bin,
        icon: 'icons/icon-512.png',
        categories: COMMON.categories,
      },
    },
  },
  {
    key: 'rpm',
    label: 'Fedora/RHEL .rpm',
    name: '@electron-forge/maker-rpm',
    platforms: ['linux'],
    hosts: ['linux'],
    tools: ['rpmbuild'],
    installHint: 'rpm-build (rpm-tools on Arch)',
    config: {
      options: {
        name: COMMON.name,
        productName: COMMON.productName,
        genericName: COMMON.genericName,
        description: COMMON.description,
        license: COMMON.license,
        homepage: COMMON.homepage,
        bin: COMMON.bin,
        icon: 'icons/icon-512.png',
        categories: COMMON.categories,
        compressionLevel: 9,
      },
    },
  },
  {
    key: 'squirrel',
    label: 'Windows Squirrel installer',
    name: '@electron-forge/maker-squirrel',
    platforms: ['win32'],
    hosts: ['win32', 'linux'],
    tools: () => (HOST_PLATFORM === 'win32' ? [] : ['mono', 'wine']),
    installHint: 'mono wine',
    config: {
      name: COMMON.name,
      authors: 'luel-4013',
      description: COMMON.description,
      setupIcon: path.join(ROOT, 'icons/icon-512.ico'),
      setupExe: `Pathstone-${pkg.version}-Setup.exe`,
      noMsi: true,
    },
  },
  {
    key: 'dmg',
    label: 'macOS .dmg',
    name: '@electron-forge/maker-dmg',
    platforms: ['darwin'],
    hosts: ['darwin'],
    tools: ['hdiutil'],
    installHint: 'macOS',
    config: {
      title: 'Pathstone',
      icon: path.join(ROOT, 'icons/icon-512.icns'),
    },
  },
  {
    key: 'zip',
    label: 'Portable .zip',
    name: '@electron-forge/maker-zip',
    platforms: ['linux', 'win32', 'darwin'],
    hosts: null,
    tools: () => (HOST_PLATFORM === 'win32' ? [] : ['zip']),
    installHint: 'zip',
    config: {},
  },
];

function getMakers() {
  return MAKER_DEFS.filter((maker) => hostSupports(maker) && missingTools(maker).length === 0).map(
    (maker) => ({
      name: maker.name,
      platforms: maker.platforms.slice(),
      ...(maker.config ? { config: { ...maker.config } } : {}),
    })
  );
}

function getBuildPlan(platform) {
  const relevant = MAKER_DEFS.filter((maker) => maker.platforms.includes(platform));
  const available = [];
  const skipped = [];

  for (const maker of relevant) {
    if (!hostSupports(maker)) {
      skipped.push({
        key: maker.key,
        label: maker.label,
        name: maker.name,
        reason: `requires ${maker.hosts.join(' or ')} host`,
      });
      continue;
    }

    const missing = missingTools(maker);
    if (missing.length > 0) {
      skipped.push({
        key: maker.key,
        label: maker.label,
        name: maker.name,
        reason: `missing ${missing.join(', ')}${maker.installHint ? ` (install ${maker.installHint})` : ''}`,
      });
      continue;
    }

    available.push({
      key: maker.key,
      label: maker.label,
      name: maker.name,
    });
  }

  return { available, skipped };
}

function getPlatformLabel(platform) {
  return (
    {
      linux: 'Linux (AppImage / deb / rpm / zip)',
      win32: 'Windows (Squirrel / zip)',
      darwin: 'macOS (dmg / zip)',
    }[platform] || platform
  );
}

module.exports = {
  HOST_PLATFORM,
  TARGET_PLATFORMS,
  TARGET_ARCHES,
  getMakers,
  getBuildPlan,
  getPlatformLabel,
};
