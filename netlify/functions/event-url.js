// netlify/functions/event-url.js
// CommonJS export to avoid ESM issues on Netlify
exports.handler = async (req) => {
  const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
  const endpoint = process.env.ADMINISTRATE_GRAPHQL_ENDPOINT;
  const token = process.env.ADMINISTRATE_API_TOKEN; // current access token
  const SITE_BASE = process.env.PUBLIC_SITE_BASE || "";
  const PUBLIC_URL_CF_DEFINITION_KEY = process.env.PUBLIC_URL_CF_DEFINITION_KEY; // <-- set this in Netlify (Custom Field definitionKey/ID)

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

  // ---------------------------
  // NEW ID EXTRACTION + LOOKUP
  // ---------------------------

  // Parse payload (manual webhook sends numeric ID in payload.event.id)
  let payload = {};
  try { payload = JSON.parse(req.body || "{}"); } catch {}

  const urlObj = new URL(req.rawUrl || `https://example.com${req.path}?${req.queryStringParameters || ""}`);

  // For browser/manual testing: pass GraphQL ID via ?id=Q291cnNlOjE=
  const qpGraphId = urlObj.searchParams.get("id");

  // For manual webhook payload: numeric ID from Administrate (e.g. 456)
  const numericIdFromPayload =
    payload?.payload?.event?.id ??
    payload?.event?.id ??
    payload?.data?.event?.id ??
    null;

  // GraphQL query helper
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

  // Query by GraphQL ID (node lookup)
  const GET_BY_NODE = `
    query($id: ID!) {
      node(id: $id) { 
        id 
        ... on Event { id code legacyId title } 
      }
    }
  `;

  // Query by numeric ID (Events filter on id field)
  const GET_BY_NUMERIC_ID = `
    query($id: String!) {
      events(filters: [{ field: id, operation: eq, value: $id }]) {
        edges { node { id code legacyId title } }
      }
    }
  `;

  // Resolve the event node
  let node = null;
  if (qpGraphId) {
    const d = await gql(GET_BY_NODE, { id: qpGraphId });
    node = d?.node ?? null;
  } else if (numericIdFromPayload != null) {
    const d = await gql(GET_BY_NUMERIC_ID, { id: String(numericIdFromPayload) });
    node = d?.events?.edges?.[0]?.node ?? null;
  } else {
    return resp(400, { error: "No event id found. Use ?id=<GraphQL ID> for testing, or trigger from the Administrate UI." });
  }

  if (!node || !node.id) {
    return resp(404, { error: "Event not found" });
  }

  // Mutation to update custom field on Event
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

  // Build public URL (always use GraphQL ID for uniqueness)
  const base = SITE_BASE || urlObj.origin;
  const publicUrl = `${base}/?id=${encodeURIComponent(node.id)}`;

  // Update custom field using definitionKey (as per Administrate docs)
  const result = await gql(UPDATE_EVENT_CF, {
    eventId: node.id,
    definitionKey: PUBLIC_URL_CF_DEFINITION_KEY,
    value: publicUrl
  });

  const update = result?.event?.update;
  const errors = update?.errors;
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
