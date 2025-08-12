// netlify/functions/event-url.js
export const handler = async (req) => {
  const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
  const endpoint = process.env.ADMINISTRATE_GRAPHQL_ENDPOINT;
  const token = process.env.ADMINISTRATE_API_TOKEN; // access token (we can add refresh later)
  const SITE_BASE = process.env.PUBLIC_SITE_BASE || "";

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

  // Parse JSON body (webhook) + allow manual test via query params
  let payload = {};
  try { payload = JSON.parse(req.body || "{}"); } catch {}
  const url = new URL(req.rawUrl || `https://example.com${req.path}?${req.queryStringParameters || ""}`);
  const qpEventId = url.searchParams.get("eventId");
  const qpLegacyId = url.searchParams.get("legacyId");

  const eventIdFromPayload =
    payload?.event?.id ||
    payload?.payload?.event?.id ||
    payload?.entity?.id ||
    payload?.data?.event?.id ||
    payload?.id ||
    null;

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
  const GET_EVENT_BY_ID = `
    query GetEventById($id: String!) {
      events(filters: [{ field: id, operation: eq, value: $id }]) {
        edges { node { id legacyId code title } }
      }
    }
  `;
  const GET_EVENT_BY_LEGACY_ID = `
    query GetEventByLegacyId($legacyId: String!) {
      events(filters: [{ field: legacyId, operation: eq, value: $legacyId }]) {
        edges { node { id legacyId code title } }
      }
    }
  `;

  // ✅ Use event.update, not training{...}
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
    // Resolve event
    let node = null;
    if (qpLegacyId) {
      const d = await gql(GET_EVENT_BY_LEGACY_ID, { legacyId: qpLegacyId });
      node = d?.events?.edges?.[0]?.node || null;
    } else {
      const idToUse = qpEventId || eventIdFromPayload;
      if (!idToUse) return resp(400, { error: "No event id. Use ?eventId=<GraphQL ID> or ?legacyId=<legacyId>." });
      const d = await gql(GET_EVENT_BY_ID, { id: idToUse });
      node = d?.events?.edges?.[0]?.node || null;
    }
    if (!node) return resp(404, { error: "Event not found" });

    // Build public URL
    const base = SITE_BASE || url.origin;
    let publicUrl = "";
    if (node.legacyId) publicUrl = `${base}/?legacyId=${encodeURIComponent(node.legacyId)}`;
    else if (node.code) publicUrl = `${base}/e/${encodeURIComponent(node.code)}`;
    else publicUrl = `${base}/?id=${encodeURIComponent(node.id)}`;

    // Write to your Event custom field (API name must match your setup)
const up = await gql(UPDATE_EVENT_CF, {
  eventId: node.id,
  definitionKey: process.env.PUBLIC_URL_CF_DEFINITION_KEY, // <-- uses your env var
  value: publicUrl
});
const errs = up?.event?.update?.errors;
    const errs = up?.event?.update?.errors;
    if (errs && errs.length) return resp(400, { error: "Custom field update error", details: errs, publicUrl });

    return resp(200, { status: "success", eventId: node.id, legacyId: node.legacyId, code: node.code, publicUrl });
  } catch (e) {
    return resp(500, { error: String(e) });
  }
};
