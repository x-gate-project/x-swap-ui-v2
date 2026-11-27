import { test } from '@playwright/test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { runStargateRoute } from './stargateRoute'

const SEPOLIA = 11155111

// Sepolia lists two USDC and two USDT, Arbitrum Sepolia two USDC, under one symbol: the routes pick them by address.
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' // Circle
const USDT_SEPOLIA = '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06'
const SGUSDC_SEPOLIA = '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590' // Stargate test tokens
const SGUSDT_SEPOLIA = '0xF3F2b4815A58152c9BE53250275e8211163268BA'
const SGUSDC_ARB = '0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773'
const SGUSDT_ARB = '0x095f40616FA98Ff75D1a7D0c68685c5ef806f110'

// A contract on Arbitrum Sepolia whose code is a single STOP, so it accepts ETH: a contract recipient takes the unwrap
// compose on the destination. Deployed by the test wallet (tx 0xf00ba21a…).
const CONTRACT_ARB = '0x72387a183cD007f5AC0a80Ead328c35807a65c53'

// A UI without #108 (merged into dev) crashes with the wallet on Arbitrum Sepolia: UNIVERSAL_ROUTER_ADDRESS(421614)
// throws in SwapForm. Lift the fixme once the UI under test (LIVE_BASE_URL, the testnet VM by default) runs #108; a
// local UI built from dev runs them already (README, "Known gaps").
const ARB_ORIGIN_FIXME = 'needs #108 (no Universal Router crash on Arbitrum Sepolia) on the UI under test'

test.describe('Stargate V2 (live, testnet), Sepolia origin', () => {
  test('bridge: 0.001 ETH Sepolia -> ETH Arbitrum Sepolia', async ({ page }) => {
    await runStargateRoute(page, {
      name: 'eth-sepolia-eth-arb',
      startChainId: SEPOLIA,
      input: { symbol: 'ETH' },
      output: { symbol: 'ETH', chain: 'Arbitrum Sepolia' },
      amount: '0.001',
      bridgeLeg: 'Sepolia → Arbitrum Sepolia via Stargate',
    })
  })

  test('swap-bridge: 50 USDC Sepolia -> ETH Arbitrum Sepolia', async ({ page }) => {
    await runStargateRoute(page, {
      name: 'usdc-sepolia-eth-arb',
      startChainId: SEPOLIA,
      input: { symbol: 'USDC', address: USDC_SEPOLIA },
      output: { symbol: 'ETH', chain: 'Arbitrum Sepolia' },
      amount: '50',
      bridgeLeg: 'Sepolia → Arbitrum Sepolia via Stargate',
    })
  })

  test('swap-bridge: 50 USDT Sepolia -> ETH Arbitrum Sepolia', async ({ page }) => {
    await runStargateRoute(page, {
      name: 'usdt-sepolia-eth-arb',
      startChainId: SEPOLIA,
      input: { symbol: 'USDT', address: USDT_SEPOLIA },
      output: { symbol: 'ETH', chain: 'Arbitrum Sepolia' },
      amount: '50',
      bridgeLeg: 'Sepolia → Arbitrum Sepolia via Stargate',
    })
  })

  test('bridge: 10 sgUSDC Sepolia -> sgUSDC Arbitrum Sepolia', async ({ page }) => {
    await runStargateRoute(page, {
      name: 'sgusdc-sepolia-sgusdc-arb',
      startChainId: SEPOLIA,
      input: { symbol: 'USDC', address: SGUSDC_SEPOLIA },
      output: { symbol: 'USDC', chain: 'Arbitrum Sepolia', address: SGUSDC_ARB },
      amount: '10',
      bridgeLeg: 'Sepolia → Arbitrum Sepolia via Stargate',
    })
  })

  test('bridge: 10 sgUSDT Sepolia -> sgUSDT Arbitrum Sepolia', async ({ page }) => {
    await runStargateRoute(page, {
      name: 'sgusdt-sepolia-sgusdt-arb',
      startChainId: SEPOLIA,
      input: { symbol: 'USDT', address: SGUSDT_SEPOLIA },
      output: { symbol: 'USDT', chain: 'Arbitrum Sepolia', address: SGUSDT_ARB },
      amount: '10',
      bridgeLeg: 'Sepolia → Arbitrum Sepolia via Stargate',
    })
  })

  test('unwrap compose: 0.001 ETH Sepolia -> ETH to a contract on Arbitrum Sepolia', async ({ page }) => {
    await runStargateRoute(page, {
      name: 'eth-sepolia-eth-arb-contract',
      startChainId: SEPOLIA,
      input: { symbol: 'ETH' },
      output: { symbol: 'ETH', chain: 'Arbitrum Sepolia' },
      amount: '0.001',
      bridgeLeg: 'Sepolia → Arbitrum Sepolia via Stargate',
      recipient: CONTRACT_ARB,
    })
  })
})

// The wallet starts on Sepolia, as the input chain is switched in the token modal: its network selector lists Arbitrum
// Sepolia only with "Show testnets" on.
test.describe('Stargate V2 (live, testnet), Arbitrum Sepolia origin', () => {
  test('bridge: 0.001 ETH Arbitrum Sepolia -> ETH to an empty Sepolia address', async ({ page }) => {
    test.fixme(true, ARB_ORIGIN_FIXME)
    // A fresh EOA each run: a delivery to an account without balance needs more gas (backend #275, #278), and the
    // wallet itself has EIP-7702 code on Sepolia, which the api takes for a contract (README, "Known gaps"). The
    // 0.001 ETH stays there.
    const recipient = privateKeyToAccount(generatePrivateKey()).address
    await runStargateRoute(page, {
      name: 'eth-arb-eth-sepolia-empty',
      startChainId: SEPOLIA,
      showTestnets: true,
      input: { symbol: 'ETH', chain: 'Arbitrum Sepolia' },
      output: { symbol: 'ETH', chain: 'Sepolia' },
      amount: '0.001',
      bridgeLeg: 'Arbitrum Sepolia → Sepolia via Stargate',
      recipient,
    })
  })

  test('bridge: 10 sgUSDC Arbitrum Sepolia -> sgUSDC Sepolia', async ({ page }) => {
    test.fixme(true, ARB_ORIGIN_FIXME)
    await runStargateRoute(page, {
      name: 'sgusdc-arb-sgusdc-sepolia',
      startChainId: SEPOLIA,
      showTestnets: true,
      input: { symbol: 'USDC', chain: 'Arbitrum Sepolia', address: SGUSDC_ARB },
      output: { symbol: 'USDC', chain: 'Sepolia', address: SGUSDC_SEPOLIA },
      amount: '10',
      bridgeLeg: 'Arbitrum Sepolia → Sepolia via Stargate',
    })
  })

  test('bridge: 10 sgUSDT Arbitrum Sepolia -> sgUSDT Sepolia', async ({ page }) => {
    test.fixme(true, ARB_ORIGIN_FIXME)
    await runStargateRoute(page, {
      name: 'sgusdt-arb-sgusdt-sepolia',
      startChainId: SEPOLIA,
      showTestnets: true,
      input: { symbol: 'USDT', chain: 'Arbitrum Sepolia', address: SGUSDT_ARB },
      output: { symbol: 'USDT', chain: 'Sepolia', address: SGUSDT_SEPOLIA },
      amount: '10',
      bridgeLeg: 'Arbitrum Sepolia → Sepolia via Stargate',
    })
  })

  test('bridge-swap (compose on Sepolia): 0.001 ETH Arbitrum Sepolia -> USDC Sepolia', async ({ page }) => {
    test.fixme(true, ARB_ORIGIN_FIXME)
    await runStargateRoute(page, {
      name: 'eth-arb-usdc-sepolia',
      startChainId: SEPOLIA,
      showTestnets: true,
      input: { symbol: 'ETH', chain: 'Arbitrum Sepolia' },
      output: { symbol: 'USDC', chain: 'Sepolia', address: USDC_SEPOLIA },
      amount: '0.001',
      bridgeLeg: 'Arbitrum Sepolia → Sepolia via Stargate',
    })
  })
})
