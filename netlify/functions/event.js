export const handler = async (req) => {
  const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
  const endpoint = process.env.ADMINISTRATE_GRAPHQL_ENDPOINT;
  const token = process.env.ADMINISTRATE_API_TOKEN;
  if (!endpoint || !token) {
    return {
      statusCode: 500,
      headers: {"Access-Control-Allow-Origin": ORIGIN},
      body: "Missing ADMINISTRATE_GRAPHQL_ENDPOINT or ADMINISTRATE_API_TOKEN",
    };
  }
  const url = new URL(req.rawUrl || `https://example.com${req.path}?${req.queryStringParameters || ""}`);
  const code = url.searchParams.get('code');
  const id = url.searchParams.get('id');
  const legacyId = url.searchParams.get('legacyId');

  if (!code && !id && !legacyId) {
    return { statusCode: 400, headers: {"Access-Control-Allow-Origin": ORIGIN}, body: "Provide ?code= or ?id= or ?legacyId=" };
  }

  const GET_EVENT_BY_CODE = `
    query GetEventByCode($code: String!) {
      events(filters: [{ field: code, operation: eq, value: $code }]) {
        edges { node { id code legacyId title start end learningMode } }
      }
    }
  `;

  const GET_EVENT_BY_ID = `
    query GetEventById($id: ID!) {
      events(filters: [{ field: id, operation: eq, value: $id }]) {
        edges { node { id code legacyId title start end learningMode } }
      }
    }
  `;

  const GET_EVENT_BY_LEGACY_ID = `
    query GetEventByLegacyId($legacyId: String!) {
      events(filters: [{ field: legacyId, operation: eq, value: $legacyId }]) {
        edges { node { id code legacyId title start end learningMode } }
      }
    }
  `;

  let query, variables;
  if (legacyId) {
    query = GET_EVENT_BY_LEGACY_ID;
    variables = { legacyId };
  } else if (code) {
    query = GET_EVENT_BY_CODE;
    variables = { code };
  } else {
    query = GET_EVENT_BY_ID;
    variables = { id };
  }

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = await r.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    const edges = json.data?.events?.edges || [];
    const node = edges[0]?.node;
    if (!node) return { statusCode: 404, headers: {"Access-Control-Allow-Origin": ORIGIN}, body: "Event not found" };
    const payload = {
      id: node.id,
      code: node.code,
      legacyId: node.legacyId,
      title: node.title,
      start: node.start,
      end: node.end,
      learningMode: node.learningMode,
      locationText: node.locationText || null
    };
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ORIGIN,
        "Cache-Control": "no-store"
      },
      body: JSON.stringify(payload)
    }
  } catch (err) {
    return { statusCode: 500, headers: {"Access-Control-Allow-Origin": ORIGIN}, body: String(err) }
  }
};