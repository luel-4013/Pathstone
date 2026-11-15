'use strict';

const { spawnSync } = require('node:child_process');

const hasDebTools =
  process.platform === 'linux' &&
  spawnSync(
    'sh',
    ['-c', 'command -v dpkg-deb >/dev/null 2>&1 && command -v fakeroot >/dev/null 2>&1']
  ).status === 0;

const hasZipTool =
  process.platform === 'win32' ||
  spawnSync('sh', ['-c', 'command -v zip >/dev/null 2>&1']).status === 0;

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'pathstone',
    icon: 'icons/icon-512.png',
    appCopyright: 'MIT licensed.',
    ignore: [
      /^\/data(\/|$)/,
      /^\/tests(\/|$)/,
      /^\/server\.py$/,
      /^\/\.git(\/|$)/,
      /^\/\.github(\/|$)/,
      /^\/\.venv(\/|$)/,
      /^\/out(\/|$)/,
      /^\/dist(\/|$)/,
      /^\/node_modules\/\.cache(\/|$)/,
      /^\/_app\.js$/,
      /^\/_body\.html$/,
      /^\/mock\.html$/,
      /^\/DB_POSTMORTEM\.md$/,
      /^\/POSTMORTEM\.md$/,
      /^\/README\.md$/,
      /^\/package-lock\.json$/,
      /^\/\.editorconfig$/,
      /^\/\.gitattributes$/,
      /^\/\.gitignore$/,
    ],
  },
  makers: [
    {
      name: '@reforged/maker-appimage',
      platforms: ['linux'],
      config: {
        options: {
          productName: 'Pathstone',
          bin: 'pathstone',
          genericName: 'Local-first task and project planner',
          categories: ['Office', 'Utility'],
          icon: 'icons/icon-512.png',
          keywords: ['tasks', 'projects', 'planner', 'local-first', 'offline'],
        },
      },
    },
    ...(hasDebTools
      ? [
          {
            name: '@electron-forge/maker-deb',
            platforms: ['linux'],
            config: {
              options: {
                maintainer: 'luel-4013 <luelworkneh@gmail.com>',
                homepage: 'https://github.com/luel-4013/Pathstone',
                icon: 'icons/icon-512.png',
                categories: ['Office', 'Utility'],
                genericName: 'Local-first task and project planner',
              },
            },
          },
        ]
      : []),
    ...(hasZipTool
      ? [
          {
            name: '@electron-forge/maker-zip',
            platforms: ['linux', 'win32'],
          },
        ]
      : []),
  ],
};
