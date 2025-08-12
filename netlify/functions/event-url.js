// netlify/functions/event-url.js
export const handler = async (req) => {
  const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
  const endpoint = process.env.ADMINISTRATE_GRAPHQL_ENDPOINT;
  const token = process.env.ADMINISTRATE_API_TOKEN; // access token (temporary until we add refresh)
  const SITE_BASE = process.env.PUBLIC_SITE_BASE || ""; // optional override like https://your-domain.com

  // Small helper for consistent responses
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

  // 1) Parse payload (Administrate sends JSON); also allow manual testing via query params
  let payload = {};
  try { payload = JSON.parse(req.body || "{}"); } catch { payload = {}; }

  // Try common webhook shapes to extract an event GraphQL ID
  let eventIdFromPayload =
    payload?.event?.id ||
    payload?.payload?.event?.id ||
    payload?.entity?.id ||
    payload?.data?.event?.id ||
    payload?.id ||
    null;

  // Support manual test: ?eventId=<GraphQL ID> or ?legacyId=123
  const u = new URL(req.rawUrl || `https://example.com${req.path}?${req.queryStringParameters || ""}`);
  const qpEventId = u.searchParams.get("eventId");
  const qpLegacyId = u.searchParams.get("legacyId");

  // 2) GraphQL helper
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
    if (json.errors) {
      throw new Error(JSON.stringify(json.errors));
    }
    return json.data;
  }

  // Queries: note the filter `value` expects a String
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

  // Mutation: write the URL into your Event custom field
  // Change apiName if your field is named differently
  const UPSERT_EVENT_CUSTOM_FIELD = `
    mutation UpsertEventField($eventId: ID!, $apiName: String!, $value: String!) {
      training {
        eventCustomFieldValueUpsert(input: {
          eventId: $eventId,
          apiName: $apiName,
          value: $value
        }) {
          customFieldValue { apiName value }
          errors { label message value }
        }
      }
    }
  `;

  try {
    // 3) Resolve the event node we’re working with
    let eventNode = null;

    if (qpLegacyId) {
      const d = await gql(GET_EVENT_BY_LEGACY_ID, { legacyId: qpLegacyId });
      eventNode = d?.events?.edges?.[0]?.node || null;
    } else {
      const idToUse = qpEventId || eventIdFromPayload;
      if (!idToUse) {
        return resp(400, { error: "No event id found. Provide ?eventId=<GraphQL ID> or ?legacyId=<legacyId> for manual testing." });
      }
      const d = await gql(GET_EVENT_BY_ID, { id: idToUse });
      eventNode = d?.events?.edges?.[0]?.node || null;
    }

    if (!eventNode) {
      return resp(404, { error: "Event not found" });
    }

    // 4) Build the public URL (prefer legacyId, then code, then id)
    const base = SITE_BASE || new URL(req.rawUrl).origin; // ensures we write your site’s domain
    let publicUrl = "";
    if (eventNode.legacyId) {
      publicUrl = `${base}/?legacyId=${encodeURIComponent(eventNode.legacyId)}`;
    } else if (eventNode.code) {
      publicUrl = `${base}/e/${encodeURIComponent(eventNode.code)}`;
    } else {
      publicUrl = `${base}/?id=${encodeURIComponent(eventNode.id)}`;
    }

    // 5) Upsert into your Event custom field (apiName must match your Admin setup)
    const up = await gql(UPSERT_EVENT_CUSTOM_FIELD, {
      eventId: eventNode.id,             // NOTE: this is ID! for the mutation
      apiName: "cf-public-url",          // <-- change if your field is named differently
      value: publicUrl
    });

    const errs = up?.training?.eventCustomFieldValueUpsert?.errors;
    if (errs && errs.length) {
      return resp(400, { error: "Custom field upsert error", details: errs, publicUrl });
    }

    return resp(200, {
      status: "success",
      eventId: eventNode.id,
      legacyId: eventNode.legacyId,
      code: eventNode.code,
      publicUrl
    });

  } catch (e) {
    return resp(500, { error: String(e) });
  }
};
