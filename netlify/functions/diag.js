// netlify/functions/diag.js (CommonJS)
exports.handler = async (req) => {
  const endpoint = process.env.ADMINISTRATE_GRAPHQL_ENDPOINT || "";
  const token = process.env.ADMINISTRATE_API_TOKEN || "";
  const origin = (new URL(req.rawUrl || "https://example.com")).origin;

  const resp = (status, body) => ({
    statusCode: status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body)
  });

  const url = new URL(req.rawUrl || "https://example.com");
  const testId = url.searchParams.get("testId");             // GraphQL id e.g. Q291...%3D%3D
  const testLegacyId = url.searchParams.get("testLegacyId"); // numeric e.g. 383

  async function ping(q, variables) {
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ query: q, variables })
      });
      const status = r.status;
      let json = {};
      try { json = await r.json(); } catch {}
      return { ok: r.ok, status, json };
    } catch (e) {
      return { ok: false, status: 0, json: { error: String(e) } };
    }
  }

  // Minimal ping
  const basic = await ping(`{ __typename }`);

  // Filters expect String values
  const Q_BY_ID = `
    query($id: String!) {
      events(filters: [{ field: id, operation: eq, value: $id }]) {
        edges { node { id legacyId code title } }
      }
    }`;
  const Q_BY_LEGACY = `
    query($legacyId: String!) {
      events(filters: [{ field: legacyId, operation: eq, value: $legacyId }]) {
        edges { node { id legacyId code title } }
      }
    }`;

  let byId = null, byLegacy = null;
  if (testId) byId = await ping(Q_BY_ID, { id: testId });
  if (testLegacyId) byLegacy = await ping(Q_BY_LEGACY, { legacyId: testLegacyId });

  // Mask token but show length (helps catch empty/truncated tokens)
  const tokenLen = token ? token.length : 0;

  return resp(200, {
    endpoint,
    tokenPresent: !!token,
    tokenLength: tokenLen,
    tips: "Pass ?testId=<GraphQL ID> (URL-encode =) and/or ?testLegacyId=123",
    basicPing: basic,               // {ok, status, json}
    testInputs: { testId, testLegacyId },
    byId,                           // results for id filter
    byLegacy                        // results for legacyId filter
  });
};
