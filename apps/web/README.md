# Uniswap Labs Web Interface

## Accessing the Uniswap Interface

To access the Uniswap Interface, use an IPFS gateway link from the
[latest release](https://github.com/Uniswap/uniswap-interface/releases/latest),
or visit [app.uniswap.org](https://app.uniswap.org).

## Running the interface locally

```bash
yarn
yarn web start
```

## x-swap API

On chains the x-swap API (`xswap-router-worker`) enables, the swap form reads its token list and quotes from the API.
Every other chain keeps the token lists and the client-side router. The API sends no CORS headers, so the browser calls
it through `/api/xswap`:

| Variable | Where | Value |
|---|---|---|
| `REACT_APP_XSWAP_API_URL` | build time, set per Vercel environment | `/api/xswap/v1`. Unset turns the API off on every chain. Production leaves it unset until the API serves mainnets; set it on Preview / stage. |
| `XSWAP_API_URL` | Vercel project | API origin the `api/xswap` function forwards to, e.g. `https://xswap-api.example.com`. |
| `XSWAP_API_PROXY_TARGET` | local dev | API origin `src/setupProxy.js` forwards `/api/xswap` to. |

Local development against an API on port 3001:

```bash
XSWAP_API_PROXY_TARGET=http://localhost:3001 REACT_APP_XSWAP_API_URL=/api/xswap/v1 yarn web start
```

Chains and tokens come from `GET /v1/chains` and `GET /v1/tokens`, so changing the API config changes the swap form
without a new release: a token or route class turned off is blocked on API chains, and a chain turned off falls back to
the token lists and the client-side router.

On API chains every swap is sent from the API's quote, same-chain (`local`) and cross-chain alike, and registered as an
order (`POST /v1/orders`) so it shows in the Activity tab. When a quote offers a Permit2 `permit` (ERC-20 input), the
wallet signs it instead of sending the `permit2-approve` tx, and `POST /v1/quote/:quoteId/permit` returns the deposit
built from the signature. Native input needs no approval.

### End-to-end tests

The x-swap flows are covered by a Playwright suite in [`e2e/`](./e2e/README.md). It runs against a stubbed API, a mock
wallet and stubbed chain RPCs, so it needs no network or funds:

```bash
yarn web e2e:install # once
yarn web e2e
```

## Translations

To get translations to work you'll need to set up 1Password, and then:

```
eval $(op signin)
```

Sign into 1Password, then:

```
yarn mobile env:local:download
```

Which downs a `.env.defaults.local` file at the root. Finally:

```
yarn web i18n:download
```

Which will download the translations to `./apps/web/src/i18n/locales/translations`.

## Accessing Uniswap V2

The Uniswap Interface supports swapping, adding liquidity, removing liquidity and migrating liquidity for Uniswap protocol V2.

- Swap on Uniswap V2: <https://app.uniswap.org/swap?use=v2>
- View V2 liquidity: <https://app.uniswap.org/pools/v2>
- Add V2 liquidity: <https://app.uniswap.org/add/v2>
- Migrate V2 liquidity to V3: <https://app.uniswap.org/migrate/v2>

## Accessing Uniswap V1

The Uniswap V1 interface for mainnet and testnets is accessible via IPFS gateways
linked from the [v1.0.0 release](https://github.com/Uniswap/uniswap-interface/releases/tag/v1.0.0).
