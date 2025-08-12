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

  // Helper to turn numeric ID into GraphQL node ID
  const toGraphId = (num) => Buffer.from(`Event:${num}`, "utf8").toString("base64");

  const urlObj = new URL(req.rawUrl || `https://example.com`);
  const qpGraphId = urlObj.searchParams.get("id");
  const numericFromPayload = payload?.payload?.event?.id || payload?.event?.id || null;
  const graphIdFromNumeric = numericFromPayload ? toGraphId(numericFromPayload) : null;

  const eventGraphId = qpGraphId || graphIdFromNumeric;

  if (!eventGraphId) {
    return resp(400, {
      error: "No event ID found",
      hint: "Manual Event Webhook sends payload.payload.event.id (numeric). For manual tests, pass ?id=<GraphQL ID>."
    });
  }

  // GraphQL helper
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

  // Query by GraphQL ID
  const GET_EVENT_BY_ID = `
    query GetEventById($id: ID!) {
      events(filters: [{ field: id, operation: eq, value: $id }]) {
        edges { node { id legacyId code title } }
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

  try {
    const d = await gql(GET_EVENT_BY_ID, { id: eventGraphId });
    const node = d?.events?.edges?.[0]?.node;
    if (!node) return resp(404, { error: "Event not found" });

    // Build the public URL using GraphQL ID
    const base = SITE_BASE || urlObj.origin;
    const publicUrl = `${base}/?id=${encodeURIComponent(node.id)}`;

    // Update the event’s custom field
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
      publicUrl
    });
  } catch (e) {
    return resp(500, { error: String(e) });
  }
};
