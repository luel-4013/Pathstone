'use strict';

const { getMakers } = require('./scripts/packaging');

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'Pathstone',
    appBundleId: 'org.pathstone.app',
    appCategoryType: 'public.app-category.productivity',
    executableName: 'pathstone',
    icon: 'icons/icon-512.png',
    appCopyright: 'MIT licensed.',
    win32metadata: {
      CompanyName: 'Pathstone',
      FileDescription: 'Local-first task and project planner',
      ProductName: 'Pathstone',
      InternalName: 'pathstone',
      OriginalFilename: 'pathstone.exe',
      'requested-execution-level': 'asInvoker',
    },
    ignore: [
      /^\/data(\/|$)/,
      /^\/tests(\/|$)/,
      /^\/scripts(\/|$)/,
      /^\/server\.py$/,
      /^\/forge\.config\.js$/,
      /^\/\.git(\/|$)/,
      /^\/\.github(\/|$)/,
      /^\/\.venv(\/|$)/,
      /^\/out(\/|$)/,
      /^\/dist(\/|$)/,
      /^\/release(\/|$)/,
      /^\/artifacts(\/|$)/,
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
  makers: getMakers(),
};
