# x-swap live e2e

Playwright smoke runs against a deployed UI, the real testnet x-swap API and real chains, with a funded wallet. This is the
on-chain coverage that the stubbed suite in `e2e/` leaves out (`e2e/README.md`, "Not covered"). Nothing is stubbed:
every run sends real transactions and spends testnet funds.

## Run

From `apps/web`:

```bash
yarn e2e:install   # once: downloads Playwright's Chromium
LIVE_ENV_FILE=/path/to/.env yarn e2e:live
LIVE_ENV_FILE=/path/to/.env yarn e2e:live -g "USDC"   # one route
```

| Variable        | Meaning                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LIVE_ENV_FILE` | Required. A dotenv file with `KEY` (the wallet's private key) and `RPC_SEPOLIA`. The file is read at run time, and the key never leaves the Node process. |
| `LIVE_BASE_URL` | The deployed UI. Default `http://35.239.192.88:8081` (the testnet VM).                                                                                    |
| `LIVE_OUT_DIR`  | Screenshots and traces. Default `e2e-live/.results`, which Playwright empties at the start of each run.                                                   |

The wallet needs, on Sepolia: ETH for gas and the LayerZero fee, plus 50 USDC and 50 USDT. Each run spends about
0.001 ETH plus fees, 50 USDC and 50 USDT. Arbitrum Sepolia receives the output.

## How it works

- `liveWallet.ts` injects an EIP-1193 provider, as `e2e/support/wallet.ts` does, and sets `__XSWAP_E2E__` so the app
  connects on load. It signs with the key and sends to the real RPCs. Every other request is forwarded to the RPC of the
  current chain. Sepolia and Arbitrum Sepolia are the only chains it knows.
- `stargateRoute.ts` quotes a pair on the swap page, picks the Stargate route when the details list more than one, checks
  that the bridge leg reads `via Stargate` with a LayerZero fee, executes, and waits for the order to reach a terminal
  status (the "Updating…" label disappears). It logs the wallet's transactions, the quote and order calls, and the
  tracker's text, and saves screenshots of each step.
- If no order appears 180 s after execute, the helper clicks again, up to three times. A user would do the same. On
  testnet, the dex search on Sepolia often times out. A refresh after an approval then answers 410 and returns the panel
  to the quote. The approval is already on chain, so the next click goes straight to the deposit.

## Known gaps

- ETH Arbitrum Sepolia → USDC Sepolia (a Stargate compose with a swap on Sepolia) is `fixme`. With the wallet on
  Arbitrum Sepolia, the swap page crashes: `UNIVERSAL_ROUTER_ADDRESS(421614)` throws in `SwapForm`.
- No route ends with native ETH on Sepolia. A Stargate delivery to an empty Sepolia address runs out of gas, and the
  order stays deposited until someone retries the message.
