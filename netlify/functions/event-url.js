// netlify/functions/event-url.js
exports.handler = async (req) => {
  const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
  const endpoint = process.env.ADMINISTRATE_GRAPHQL_ENDPOINT;
  const token = process.env.ADMINISTRATE_API_TOKEN;
  const SITE_BASE = process.env.PUBLIC_SITE_BASE || "";
  const PUBLIC_URL_CF_DEFINITION_KEY = process.env.PUBLIC_URL_CF_DEFINITION_KEY;

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
    return resp(500, { error: "Missing PUBLIC_URL_CF_DEFINITION_KEY env var" });
  }

  // Parse payload
  let payload = {};
  try { payload = JSON.parse(req.body || "{}"); } catch {}

  const urlObj = new URL(req.rawUrl || `https://example.com${req.path}?${req.queryStringParameters || ""}`);
  const qpGraphId = urlObj.searchParams.get("id");

  // From webhook payload: numeric ID
  const numericIdFromPayload =
    payload?.payload?.event?.id ??
    payload?.event?.id ??
    null;

  // Convert numeric ID to GraphQL ID
  const toGraphId = (num) => Buffer.from(`Event:${num}`, "utf8").toString("base64");

  const eventIdToUse = qpGraphId || (numericIdFromPayload ? toGraphId(numericIdFromPayload) : null);

  if (!eventIdToUse) {
    return resp(400, { error: "No event ID found" });
  }

  // Query helpers
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

  const GET_EVENT_BY_ID = `
    query($id: String!) {
      events(filters: [{ field: id, operation: eq, value: $id }]) {
        edges { node { id code legacyId title } }
      }
    }
  `;

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

  // Get event
  const d = await gql(GET_EVENT_BY_ID, { id: eventIdToUse });
  const node = d?.events?.edges?.[0]?.node || null;

  if (!node) {
    return resp(404, { error: "Event not found" });
  }

  // Always use GraphQL ID in URL
  const base = SITE_BASE || urlObj.origin;
  const publicUrl = `${base}/?id=${encodeURIComponent(node.id)}`;

  // Update CF
  const result = await gql(UPDATE_EVENT_CF, {
    eventId: node.id,
    definitionKey: PUBLIC_URL_CF_DEFINITION_KEY,
    value: publicUrl
  });

  const errors = result?.event?.update?.errors;
  if (errors && errors.length) {
    return resp(400, { error: "Custom field update error", details: errors, publicUrl });
  }

  return resp(200, {
    status: "success",
    eventId: node.id,
    code: node.code,
    publicUrl
  });
};
