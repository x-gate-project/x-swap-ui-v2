# x-swap e2e tests

Playwright tests that drive the real swap page through the x-swap flows. The x-swap API, the chain RPCs and the wallet are all stubbed, so the suite needs no network, no funds and no secrets, and can simulate any chain the API lists.

## Run

From `apps/web`:

```bash
yarn e2e:install   # once: downloads Playwright's Chromium
yarn e2e           # starts the dev server on :3100 if none is running, then runs every spec
yarn e2e:ui        # same, in Playwright's UI mode
yarn e2e e2e/xswap/errors.spec.ts -g "reverted"   # one file / one test
```

Playwright starts `yarn start` with the env below, or reuses a server already listening on that port. Start it yourself to keep it warm between runs (the first compile takes a minute or two):

```bash
PORT=3100 BROWSER=none REACT_APP_XSWAP_API_URL=/api/xswap/v1 REACT_APP_SKIP_CSP=1 CI=true yarn start
```

- `REACT_APP_XSWAP_API_URL` turns the x-swap API on. Its requests stay on the dev server's origin, where the tests intercept them; `XSWAP_API_PROXY_TARGET` in `.env.local` is never reached.
- `REACT_APP_SKIP_CSP` drops the CSP meta, which would block some RPC hosts.
- `CI=true` skips craco's dev-time ESLint and type-check plugins.
- `E2E_PORT` changes the port.

On failure, the trace, screenshot and page snapshot are in `e2e/.results/`. The HTML report is in `e2e/.report/`. Open a trace with `npx playwright show-trace <trace.zip>`.

## How it works

```
browser                                       Node (the Playwright test)
window.ethereum (init script) ── exposeFunction ──► MockChain: accounts, txs, receipts, balances
wagmi / multicall ── chain RPC URL ── context.route ──► rpc.ts answers from MockChain
x-swap client ── /api/xswap/v1/* ── context.route ──► XSwapApiStub answers from the test's scenario
anything else (GraphQL, Statsig, Amplitude, token lists...) ──► aborted
```

| File | Role |
|---|---|
| `support/test.ts` | The `test` fixture. Each test gets `chain` (a MockChain), `api` (an XSwapApiStub) and `swap` (a SwapPage). The wallet is on Sepolia with 1 ETH and 1,000 USDC/USDT. The API lists `CHAINS` and `ALL_TOKENS`, with every pair reachable. |
| `support/mockChain.ts` | Chain state shared by the wallet and the RPC stub. A sent tx is mined at once unless the test calls `hold(kind)` first (then later `mine(hash)`) or `revert(kind)`. `rejectNext(method)` makes the wallet answer EIP-1193 4001. |
| `support/wallet.ts` | The injected EIP-1193 provider. It sets `window.__XSWAP_E2E__`, which makes `src/components/Web3Provider/wagmi.ts` connect to it on load. |
| `support/rpc.ts` | JSON-RPC handler for the `rpcUrls.appOnly` hosts in `RPC_HOSTS`. It decodes `eth_call` for ERC-20, Permit2 and both multicall contracts. An unknown method is recorded in `chain.unhandled`. A test fails if a method the execute path needs was left unanswered. |
| `support/xswapApi.ts` | `/api/xswap/v1/*` stub. `api.set({...})` swaps handlers, `ApiError` answers `{ code, message }` with a status, and `api.calls('POST /orders')` lists what the app sent. |
| `support/fixtures.ts` | Chains, tokens (real testnet addresses), and builders for quotes with valid calldata and for orders. |
| `support/scenario.ts` | `serveQuote(api, quote, options)`: the happy path for one quote (quote, permit, register, order polling), with hooks for failures. |
| `support/swapPage.ts` | Page helpers: pick tokens and chains, type the amount, open the details, execute. |

The execute panel polls an approval's receipt every 4 s, and asks the API (`POST /quote/:id/refresh`) at the same pace whether the approval is still needed. A test that holds a receipt and then mines it therefore waits a few seconds (`swap.expectTrackerAfterMined()`), and its unstubbed refreshes answer 501, which the app takes as transient.

## Adding a test

```ts
import { xchainQuote } from '../support/fixtures'
import { serveQuote } from '../support/scenario'
import { expect, test } from '../support/test'
import { ApiError } from '../support/xswapApi'

test('shows a quote error', async ({ swap, api }) => {
  api.set({ quote: () => new ApiError(422, 'no_route') })
  await swap.goto()
  await swap.quote('USDC', { symbol: 'USDC', chain: 'Arbitrum Sepolia' }, '100')
  await expect(swap.quoteError).toHaveText('No route for this pair')
})
```

- Build quotes with the builders in `fixtures.ts`. The app validates tx calldata (`planXSwapTxs`), so do not hand-write `data`.
- Keep `expiresAt` more than 15 s ahead unless the test is about refresh. The app refreshes any quote inside that margin.
- Use the existing `data-testid`s (`xswap-*`). Add one to the component rather than selecting by CSS structure.

## Not covered

On-chain behaviour (real reverts, gas, allowances) is mocked. That is the job of a live smoke run against the testnet API with a funded wallet, tracked as a follow-up of #92.
