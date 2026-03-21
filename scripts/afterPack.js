const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');

/**
 * electron-builder afterPack hook – flips Electron Fuses on the packaged binary.
 * @param {import('electron-builder').AfterPackContext} context
 */
module.exports = async function afterPack(context) {
  const { electronPlatformName, appOutDir } = context;
  const productFilename = context.packager.appInfo.productFilename;

  let electronBinaryPath;

  switch (electronPlatformName) {
    case 'win32':
      electronBinaryPath = path.join(appOutDir, `${productFilename}.exe`);
      break;
    case 'darwin':
      electronBinaryPath = path.join(
        appOutDir,
        `${productFilename}.app`,
        'Contents',
        'MacOS',
        productFilename,
      );
      break;
    case 'linux':
      electronBinaryPath = path.join(appOutDir, context.packager.executableName);
      break;
    default:
      console.warn(`[afterPack] Unknown platform: ${electronPlatformName}, skipping fuse configuration`);
      return;
  }

  console.log(`[afterPack] Flipping fuses for: ${electronBinaryPath}`);

  await flipFuses(electronBinaryPath, {
    version: FuseVersion.V1,

    // Disable ELECTRON_RUN_AS_NODE to prevent "living off the land" abuse
    [FuseV1Options.RunAsNode]: false,

    // Disable --inspect / --inspect-brk flags in production
    [FuseV1Options.EnableNodeCliInspectArguments]: false,

    // Disable NODE_OPTIONS environment variable
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,

    // Only load app code from app.asar – prevents code injection via loose folder
    [FuseV1Options.OnlyLoadAppFromAsar]: true,

    // Disable file:// extra privileges — app uses app:// custom protocol
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });

  console.log('[afterPack] Electron fuses configured successfully');
};
