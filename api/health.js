module.exports = async (req, res) => {
  const configured = Boolean(process.env.SQUARE_ACCESS_TOKEN);

  res.statusCode = configured ? 200 : 503;
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  res.end(
    JSON.stringify(
      {
        service: "Leni's Closet Meta to Square checkout bridge",
        status: configured ? "ready" : "setup_required",
        square_environment: process.env.SQUARE_ENV || "production",
        access_token_configured: configured,
        location: process.env.SQUARE_LOCATION_ID ? "explicit" : "auto_detect",
        checkout_endpoint: "/checkout?products=PRODUCT_ID:1",
      },
      null,
      2
    )
  );
};
