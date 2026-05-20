// @ts-nocheck

export const NOA_CURL_INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/rickkwang/Noa-Claude/master/install.sh | bash'

export function usesCurlInstallerBuild(): boolean {
  return MACRO.DISTRIBUTION === 'curl'
}
