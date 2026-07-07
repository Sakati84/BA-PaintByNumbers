const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(new Set([...(config.watchFolders ?? []), repoRoot]));
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: Array.from(
    new Set([...(config.resolver?.nodeModulesPaths ?? []), path.join(projectRoot, 'node_modules')]),
  ),
};

module.exports = config;
