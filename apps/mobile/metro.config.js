// Metro config for the npm-workspaces monorepo.
// npm hoists `expo` to the root and installs a second, incompatible
// react-native (a peer of @expo/vector-icons) under node_modules/expo/node_modules.
// Pin react / react-native to this app's copies so only one of each is bundled.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const pinned = {
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [name, dir] of Object.entries(pinned)) {
    if (moduleName === name || moduleName.startsWith(`${name}/`)) {
      return context.resolveRequest(context, dir + moduleName.slice(name.length), platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
