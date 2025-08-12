// netlify/functions/event-url.js
// CommonJS export to avoid ESM issues on Netlify
exports.handler = async (req) => {
  const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
  const endpoint = process.env.ADMINISTRATE_GRAPHQL_ENDPOINT;
  const token = process.env.ADMINISTRATE_API_TOKEN; // current access token
  const SITE_BASE = process.env.PUBLIC_SITE_BASE || "";
  const PUBLIC_URL_CF_DEFINITION_KEY = process.env.PUBLIC_URL_CF_DEFINITION_KEY; // <-- set this in Netlify

  const resp = (status, body) => ({
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ORIGIN
    },
    body: JSON.stringify(body)
  });

  if (!endpoint || !token) {
    return resp(500, { error: "Missing ADMINISTRATE_GRAPHQL_ENDPOINT or ADMINISTRATE_API_TOKEN" });
  }
  if (!PUBLIC_URL_CF_DEFINITION_KEY) {
    return resp(500, { error: "Missing PUBLIC_URL_CF_DEFINITION_KEY env var (custom field definitionKey/ID)" });
  }

  // Parse payload (webhook) and query params for manual testing
  let payload = {};
  try { payload = JSON.parse(req.body || "{}"); } catch {}
  const urlObj = new URL(req.rawUrl || `https://example.com${req.path}?${req.queryStringParameters || ""}`);
const qpEventId = urlObj.searchParams.get("eventId"); // manual GraphQL id test
const qpCode    = urlObj.searchParams.get("code");    // manual code test

// Your webhook sends a numeric id and a code; we'll use the code from payload
const payloadCode =
  (payload && payload.event && payload.event.code) ||
  (payload && payload.payload && payload.payload.event && payload.payload.event.code) ||
  (payload && payload.entity && payload.entity.code) ||
  (payload && payload.code) ||
  null;

// Choose resolver: if you explicitly pass ?eventId= use that; else use code
const resolver = qpEventId ? "id" : "code";
const resolverValue = qpEventId || qpCode || payloadCode;

if (!resolverValue) {
  return resp(400, { error: "No usable event identifier. Provide ?eventId=<GraphQL ID> or ensure payload.event.code is present." });
}

  async function gql(query, variables) {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ query, variables })
    });
    const json = await r.json().catch(() => ({}));
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }

  // Filters expect String values
const GET_EVENT_BY_CODE = `
  query GetEventByCode($code: String!) {
    events(filters: [{ field: code, operation: eq, value: $code }]) {
      edges { node { id code title } }
    }
  }
`;

  // Correct mutation shape for your tenant: update(eventId: ..., input: { customFieldValues: [{ definitionKey, value }] })
  const UPDATE_EVENT_CF = `
    mutation UpdateEventCF($eventId: ID!, $definitionKey: ID!, $value: String!) {
      event {
        update(eventId: $eventId, input: {
          customFieldValues: [{ definitionKey: $definitionKey, value: $value }]
        }) {
          event { id }
          errors { label message value }
        }
      }
    }
  `;

  try {
    // Resolve event node
    let node = null;
if (resolver === "id") {
  const d = await gql(GET_EVENT_BY_ID, { id: resolverValue });
  node = (d && d.events && d.events.edges && d.events.edges[0] && d.events.edges[0].node) || null;
} else {
  const d = await gql(GET_EVENT_BY_CODE, { code: resolverValue });
  node = (d && d.events && d.events.edges && d.events.edges[0] && d.events.edges[0].node) || null;
}
    if (!node) return resp(404, { error: "Event not found" });

    // Build public URL (prefer legacyId, then code, then id)
const base = SITE_BASE || urlObj.origin;
const publicUrl = `${base}/?id=${encodeURIComponent(node.id)}`;

    // Update custom field using definitionKey
    const result = await gql(UPDATE_EVENT_CF, {
      eventId: node.id,
      definitionKey: PUBLIC_URL_CF_DEFINITION_KEY,
      value: publicUrl
    });
    const update = result && result.event && result.event.update;
    const errors = update && update.errors;
    if (errors && errors.length) {
      return resp(400, { error: "Custom field update error", details: errors, publicUrl });
    }

    return resp(200, {
      status: "success",
      eventId: node.id,
      legacyId: node.legacyId,
      code: node.code,
      publicUrl
    });
  } catch (e) {
    return resp(500, { error: String(e) });
  }
};
