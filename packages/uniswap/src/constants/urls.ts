import { isDevEnv, isTestEnv } from 'utilities/src/environment'
import { isAndroid, isExtension, isInterface, isMobileApp } from 'utilities/src/platform'

enum TrafficFlows {
  GraphQL = 'graphql',
  Metrics = 'metrics',
  Gating = 'gating',
  TradingApi = 'trading-api-labs',
  Unitags = 'unitags',
  FOR = 'for',
  Scantastic = 'scantastic',
}

const FLOWS_USING_BETA = [TrafficFlows.FOR]

export const UNISWAP_WEB_HOSTNAME = 'app.uniswap.org'

export const UNISWAP_WEB_URL = `https://${UNISWAP_WEB_HOSTNAME}`
export const UNISWAP_APP_URL = 'https://uniswap.org/app'

const helpUrl = 'https://docs.x-gate.org'

export const uniswapUrls = {
  // Help and web articles/items
  helpUrl,
  helpRequestUrl: `${helpUrl}`,
  helpArticleUrls: {
    approvalsExplainer: `${helpUrl}`,
    extensionHelp: `${helpUrl}`,
    extensionWaitlist: `${helpUrl}`,
    extensionDappTroubleshooting: `${helpUrl}`,
    feeOnTransferHelp: `${helpUrl}`,
    howToSwapTokens: `${helpUrl}`,
    impermanentLoss: `${helpUrl}`,
    limitsFailure: `${helpUrl}`,
    limitsInfo: `${helpUrl}`,
    limitsNetworkSupport: `${helpUrl}`,
    moonpayHelp: `${helpUrl}`,
    fiatOnRampHelp: `${helpUrl}`,
    moonpayRegionalAvailability: `${helpUrl}`,
    networkFeeInfo: `${helpUrl}`,
    recoveryPhraseHowToImport: `${helpUrl}`,
    recoveryPhraseHowToFind: `${helpUrl}`,
    recoveryPhraseForgotten: `${helpUrl}`,
    supportedNetworks: `${helpUrl}`,
    swapFeeInfo: `${helpUrl}`,
    swapProtection: `${helpUrl}`,
    swapSlippage: `${helpUrl}`,
    tokenWarning: `${helpUrl}`,
    transactionFailure: `${helpUrl}`,
    uniswapXInfo: `${helpUrl}`,
    uniswapXFailure: `${helpUrl}`,
    unitagClaimPeriod: `${helpUrl}`,
    unsupportedTokenPolicy: `${helpUrl}`,
    walletHelp: `${helpUrl}`,
    wethExplainer: `${helpUrl}`,
  },
  termsOfServiceUrl: `${helpUrl}`,
  privacyPolicyUrl: `${helpUrl}`,
  // TODO(EXT-668): Remove this after beta launch
  extensionFeedbackFormUrl: `${helpUrl}`,
  chromeExtension: 'https://wallet.gu.net',

  // Core API Urls
  apiOrigin: 'https://api.uniswap.org',
  apiBaseUrl: getCloudflareApiBaseUrl(),
  graphQLUrl: `${getCloudflareApiBaseUrl(TrafficFlows.GraphQL)}/v1/graphql`,

  // Proxies
  amplitudeProxyUrl: `${getCloudflareApiBaseUrl(TrafficFlows.Metrics)}/v1/amplitude-proxy`,
  statsigProxyUrl: `${getCloudflareApiBaseUrl(TrafficFlows.Gating)}/v1/statsig-proxy`,

  // Feature service URL's
  unitagsApiUrl: `${getCloudflareApiBaseUrl(TrafficFlows.Unitags)}/v2/unitags`,
  scantasticApiUrl: `${getCloudflareApiBaseUrl(TrafficFlows.Scantastic)}/v2/scantastic`,
  fiatOnRampApiUrl: `${getCloudflareApiBaseUrl(TrafficFlows.FOR)}/v2/fiat-on-ramp`,
  tradingApiUrl: getCloudflareApiBaseUrl(TrafficFlows.TradingApi),

  // API Paths
  trmPath: '/v1/screen',
  gasServicePath: '/v1/gas-fee',
  tradingApiPaths: {
    quote: '/v1/quote',
    approval: '/v1/check_approval',
    swap: '/v1/swap',
    order: '/v1/order',
    orders: '/v1/orders',
  },

  // App and Redirect URL's
  appBaseUrl: UNISWAP_APP_URL,
  redirectUrlBase: isAndroid ? UNISWAP_WEB_URL : UNISWAP_APP_URL,
  requestOriginUrl: UNISWAP_WEB_URL,

  // Web Interface Urls
  webInterfaceSwapUrl: `${UNISWAP_WEB_URL}/#/swap`,
  webInterfaceTokensUrl: `${UNISWAP_WEB_URL}/explore/tokens`,
  webInterfaceAddressUrl: `${UNISWAP_WEB_URL}/address`,
  webInterfaceNftItemUrl: `${UNISWAP_WEB_URL}/nfts/asset`,
  webInterfaceNftCollectionUrl: `${UNISWAP_WEB_URL}/nfts/collection`,
  webInterfaceBuyUrl: `${UNISWAP_WEB_URL}/buy`,
}

function getCloudflarePrefix(flow?: TrafficFlows): string {
  if (flow && isDevEnv() && FLOWS_USING_BETA.includes(flow)) {
    return `beta`
  }

  if (isMobileApp) {
    return `${isAndroid ? 'android' : 'ios'}.wallet`
  }

  if (isExtension) {
    return 'extension'
  }

  if (isInterface) {
    return 'interface'
  }

  if (isTestEnv()) {
    return 'wallet'
  }

  throw new Error('Could not determine app to generate Cloudflare prefix')
}

function getServicePrefix(flow?: TrafficFlows): string {
  if (flow && !(isDevEnv() && FLOWS_USING_BETA.includes(flow))) {
    return flow + '.'
  } else {
    return ''
  }
}

function getCloudflareApiBaseUrl(flow?: TrafficFlows): string {
  return `https://${getServicePrefix(flow)}${getCloudflarePrefix(flow)}.gateway.uniswap.org`
}
