# x-swap live e2e

Playwright smoke runs against a deployed UI, the real testnet x-swap API and real chains, with a funded wallet. This is the
on-chain coverage that the stubbed suite in `e2e/` leaves out (`e2e/README.md`, "Not covered"). Nothing is stubbed:
every run sends real transactions and spends testnet funds.

## Run

From `apps/web`:

```bash
yarn e2e:install   # once: downloads Playwright's Chromium
LIVE_ENV_FILE=/path/to/.env yarn e2e:live
LIVE_ENV_FILE=/path/to/.env yarn e2e:live -g "sgUSDC"   # matching routes only
LIVE_ENV_FILE=/path/to/.env LIVE_QUOTE_ONLY=1 yarn e2e:live   # quote and check every route, send nothing
```

| Variable          | Meaning                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LIVE_ENV_FILE`   | Required. A dotenv file with `KEY` (the wallet's private key) and `RPC_SEPOLIA`. The file is read at run time, and the key never leaves the Node process. |
| `LIVE_BASE_URL`   | The UI under test. Default `http://35.239.192.88:8081` (the testnet VM).                                                                                  |
| `LIVE_OUT_DIR`    | Screenshots and traces. Default `e2e-live/.results`, which Playwright empties at the start of each run.                                                   |
| `LIVE_QUOTE_ONLY` | Set to stop each route once its Stargate route and execute button are checked. Quotes are free.                                                           |

To test a UI branch before it is deployed, run the dev server against the testnet API and point `LIVE_BASE_URL` at it:

```bash
XSWAP_API_PROXY_TARGET=http://35.239.192.88:8081/api/xswap REACT_APP_XSWAP_API_URL=/api/xswap/v1 yarn start
LIVE_ENV_FILE=/path/to/.env LIVE_BASE_URL=http://localhost:3000 yarn e2e:live
```

## Wallet funding

| Chain            | The wallet needs                                                                                                                                   | One run spends                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Sepolia          | ETH for gas and the LayerZero fees; 50 USDC (Circle, `0x1c7D…7238`), 50 USDT (`0x7169…BA06`), 10 sgUSDC (`0x2F6F…7590`), 10 sgUSDT (`0xF3F2…68BA`) | 0.002 ETH plus fees, 50 USDC, 50 USDT, 10 sgUSDC, 10 sgUSDT |
| Arbitrum Sepolia | ETH for gas and the LayerZero fees; 10 sgUSDC (`0x3253…9773`), 10 sgUSDT (`0x095f…f110`)                                                           | 0.002 ETH plus fees, 10 sgUSDC, 10 sgUSDT                   |

Arbitrum Sepolia is only spent once its origin tests run (see "Known gaps"). The ETH sent to an empty Sepolia address
is not recovered.

sgUSDC and sgUSDT are Stargate's test tokens, the ones its testnet pools hold. Anyone can mint them with
`mint(address to, uint256 amount)` (6 decimals):

```bash
cast send 0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590 'mint(address,uint256)' <wallet> 100000000 \
  --rpc-url <sepolia rpc> --private-key <key>   # 100 sgUSDC on Sepolia
```

The same call mints sgUSDT on Sepolia (`0xF3F2b4815A58152c9BE53250275e8211163268BA`), and sgUSDC
(`0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773`) and sgUSDT (`0x095f40616FA98Ff75D1a7D0c68685c5ef806f110`) on Arbitrum
Sepolia.

## How it works

- `liveWallet.ts` injects an EIP-1193 provider, as `e2e/support/wallet.ts` does, and sets `__XSWAP_E2E__` so the app
  connects on load. It signs with the key and sends to the real RPCs. Every other request is forwarded to the RPC of the
  current chain. Sepolia and Arbitrum Sepolia are the only chains it knows.
- `stargateRoute.ts` quotes a pair on the swap page, picks the Stargate route when the details list more than one, checks
  that the bridge leg reads `via Stargate` with a LayerZero fee, executes, and expects the order to end `Completed`. It
  logs the wallet's transactions, the quote and order calls, and the tracker's text, and saves screenshots of each step.
- Each chain lists Circle's (or Tether's) and Stargate's USDC under the same symbol, so the routes pick an ERC-20 by
  address. An input on another chain than the wallet's is picked by switching the wallet with the token modal's network
  selector, after turning on "Show testnets" in the account drawer.
- Each test has 5 minutes from loading the page to a terminal order. An order still "Updating…" after that fails the
  test.
- If no order appears after execute, the helper clicks again, up to three times within the 5 minutes. A user would do the
  same. On testnet, the dex search on Sepolia often times out. A refresh after an approval then answers 410 and returns
  the panel to the quote. The approval is already on chain, so the next click goes straight to the deposit.

## Known gaps

- The Arbitrum Sepolia origin tests are `fixme`. With the wallet on Arbitrum Sepolia, the deployed swap page crashes
  (`UNIVERSAL_ROUTER_ADDRESS(421614)` throws in `SwapForm`), and its network selector lists Arbitrum Sepolia only with
  "Show testnets" on. The UI branch `fix/swap-chain-without-universal-router` fixes the crash and adds the x-swap chain
  chips to the input side. Remove the `fixme` once the UI under test has it. On 2026-11-27 all four passed
  `LIVE_QUOTE_ONLY` against a local UI with the fix, and the ETH, sgUSDC and sgUSDT lanes filled through the API
  directly (orders `fff9ee73`, `f3325d1a`, `58d867aa`, about 3 minutes each).
- Native ETH to an empty Sepolia address works since backend #278: the Stargate delivery no longer runs out of gas.
- 0.001 ETH Arbitrum Sepolia → ETH to the wallet's own Sepolia address (order `7d49cc9b`, from a local UI with the fix
  on 2026-11-27): the UI flow worked, and the delivery failed on a backend bug. The test wallet has EIP-7702 delegation
  code on Sepolia, so the api takes it for a contract and picks the unwrap compose. Its lzCompose reverted with
  `InsufficientComposeGas(285938, 266627)`: on Sepolia (Glamsterdam) the runner's first storage write of a compose
  (the WETH deposit) also pays ~98k state gas, which the compose budget does not cover. A manual `lzCompose` retry
  filled the order. Until the backend fixes the compose gas, ETH from Arbitrum Sepolia goes to a fresh EOA, as the
  suite does.
- The routes with a swap on Sepolia (50 USDC and 50 USDT Sepolia → ETH Arbitrum Sepolia, ETH Arbitrum Sepolia → USDC
  Sepolia) fail when the backend's dex search on Sepolia times out: the quote flaps to `no_route`.
