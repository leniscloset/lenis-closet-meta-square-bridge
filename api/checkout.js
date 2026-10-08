const crypto = require("crypto");

const API_VERSION = process.env.SQUARE_API_VERSION || "2026-09-16";
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const BASE = (process.env.SQUARE_ENV || "production") === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function parseProducts(req) {
  const url = new URL(req.url, "https://bridge.local");
  const values = url.searchParams.getAll("products");
  const alt = url.searchParams.getAll("product");
  const rawValues = [...values, ...alt].filter(Boolean);

  if (!rawValues.length) return [];

  const out = [];

  for (const raw of rawValues) {
    const trimmed = raw.trim();

    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        const arr = Array.isArray(parsed) ? parsed : [parsed];

        for (const p of arr) {
          const id = p.id || p.retailer_id || p.product_id || p.content_id;
          const quantity = Number(p.quantity || p.qty || 1);

          if (id) {
            out.push({
              id: String(id),
              quantity: Math.max(1, quantity || 1),
            });
          }
        }

        continue;
      } catch (_) {}
    }

    for (const token of trimmed
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      let id = token;
      let quantity = 1;

      const match = token.match(/^(.*?)(?::|\|)(\d+)$/);

      if (match) {
        id = match[1];
        quantity = Number(match[2]);
      }

      out.push({
        id: decodeURIComponent(id),
        quantity: Math.max(1, quantity || 1),
      });
    }
  }

  return out;
}

async function square(path, options = {}) {
  if (!ACCESS_TOKEN) {
    const error = new Error("Square access token is not configured.");
    error.code = "MISSING_SQUARE_ACCESS_TOKEN";
    throw error;
  }

  const response = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + ACCESS_TOKEN,
      "Square-Version": API_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = {};

  try {
    body = text ? JSON.parse(text) : {};
  } catch (_) {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error("Square API request failed.");
    error.status = response.status;
    error.square = body;
    throw error;
  }

  return body;
}

async function getLocationId() {
  if (process.env.SQUARE_LOCATION_ID) {
    return process.env.SQUARE_LOCATION_ID;
  }

  const data = await square("/v2/locations");
  const locations = (data.locations || []).filter(
    (location) => location.status === "ACTIVE"
  );

  if (!locations.length) {
    throw new Error("No active Square location was found.");
  }

  return locations[0].id;
}

async function retrieveObject(id) {
  try {
    return await square("/v2/catalog/object/" + encodeURIComponent(id));
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function exactSkuLookup(id) {
  const data = await square("/v2/catalog/search-catalog-items", {
    method: "POST",
    body: JSON.stringify({ text_filter: id }),
  });

  const matches = [];

  for (const item of data.items || []) {
    for (const variation of item.item_data?.variations || []) {
      const sku = variation.item_variation_data?.sku;

      if (sku && sku === id) {
        matches.push(variation);
      }
    }
  }

  if (matches.length === 1) {
    return matches[0].id;
  }

  if (matches.length > 1) {
    const error = new Error("More than one Square variation uses this SKU.");
    error.code = "AMBIGUOUS_SKU";
    error.productId = id;
    throw error;
  }

  return null;
}

async function resolveVariationId(metaId) {
  const direct = await retrieveObject(metaId);

  if (direct?.object?.type === "ITEM_VARIATION") {
    return direct.object.id;
  }

  if (direct?.object?.type === "ITEM") {
    const variations = direct.object.item_data?.variations || [];

    if (variations.length === 1) {
      return variations[0].id;
    }

    const error = new Error(
      "Meta supplied a Square item ID that has multiple variations. A variation ID is required."
    );
    error.code = "PARENT_ITEM_WITH_MULTIPLE_VARIATIONS";
    error.productId = metaId;
    throw error;
  }

  const bySku = await exactSkuLookup(metaId);

  if (bySku) {
    return bySku;
  }

  const error = new Error(
    "No Square catalog variation matched the Meta product ID."
  );
  error.code = "PRODUCT_NOT_FOUND";
  error.productId = metaId;
  throw error;
}

module.exports = async (req, res) => {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed" });
  }

  try {
    const url = new URL(req.url, "https://bridge.local");
    const products = parseProducts(req);

    if (!products.length) {
      return send(res, 400, {
        error: "No products supplied.",
        expected: "/checkout?products=PRODUCT_ID:1",
        note: "The bridge accepts comma separated product IDs and quantities.",
      });
    }

    const locationId = await getLocationId();
    const lineItems = [];

    for (const product of products) {
      const variationId = await resolveVariationId(product.id);

      lineItems.push({
        catalog_object_id: variationId,
        quantity: String(product.quantity),
      });
    }

    const checkoutOptions = {
      ask_for_shipping_address: true,
    };

    if (process.env.SQUARE_REDIRECT_URL) {
      checkoutOptions.redirect_url = process.env.SQUARE_REDIRECT_URL;
    }

    const body = {
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: locationId,
        line_items: lineItems,
      },
      checkout_options: checkoutOptions,
    };

    const result = await square("/v2/online-checkout/payment-links", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const checkoutUrl =
      result.payment_link?.url || result.payment_link?.long_url;

    if (!checkoutUrl) {
      return send(res, 502, {
        error: "Square did not return a checkout URL.",
        square: result,
      });
    }

    const coupon = url.searchParams.get("coupon");

    res.statusCode = 302;
    res.setHeader("Location", checkoutUrl);
    res.setHeader("Cache-Control", "no-store");

    if (coupon) {
      res.setHeader("X-Lenis-Closet-Coupon-Received", "true");
    }

    res.end();
  } catch (error) {
    return send(res, error.status || 500, {
      error: error.message || "Bridge error",
      code: error.code || "BRIDGE_ERROR",
      product_id: error.productId || undefined,
      square: error.square || undefined,
    });
  }
};
