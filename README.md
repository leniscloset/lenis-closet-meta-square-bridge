# Leni's Closet Meta to Square Checkout Bridge

This project bridges Meta Commerce checkout requests to Square hosted checkout.

## What it does

1. Receives Meta product IDs and quantities at `/checkout`.
2. Resolves each ID against the Square production catalog.
3. Falls back to an exact Square SKU match when a direct catalog object match is not available.
4. Creates a Square hosted checkout with the correct catalog variations.
5. Requests the buyer's shipping address.
6. Redirects the buyer back to the Leni's Closet Square site after checkout.

The bridge is designed so newly added Square products do not require code changes when Meta sends a Square variation ID or a unique Square SKU.

## Public checkout endpoint

Production endpoint:

`https://lenis-closet-meta-square-bridge.vercel.app/checkout`

Example test format:

`/checkout?products=PRODUCT_ID:1`

## Required environment variables

Set these in Vercel. Never commit real credentials to this repository.

- `SQUARE_ACCESS_TOKEN` — Square production access token. Store as a Vercel Secret.
- `SQUARE_ENV` — `production`
- `SQUARE_API_VERSION` — current Square API version used by the deployment
- `SQUARE_REDIRECT_URL` — `https://leniscloset.square.site`
- `SQUARE_LOCATION_ID` — optional. If omitted, the bridge uses the first active Square location returned by the Locations API.

## Meta URL format

The bridge accepts a `products` query parameter in the form:

`PRODUCT_ID:QUANTITY,PRODUCT_ID_2:QUANTITY`

It also accepts repeated `products` or `product` parameters and a small set of JSON product formats for testing.

## Security

The Square access token is read only from the Vercel runtime environment. It is not stored in this repository, returned to the browser, or included in URLs.

## Current limitation

A Meta `coupon` query parameter is accepted so checkout validation can proceed, but this bridge does not currently translate that value into a Square discount. Coupon handling should be added only after confirming the exact desired Square discount behavior.

## Health check

Open the project root:

`https://lenis-closet-meta-square-bridge.vercel.app/`

A configured production deployment should report `"status": "ready"`.
