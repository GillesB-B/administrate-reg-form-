export const handler = async (req) => {
  const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
  if (req.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      },
      body: ""
    }
  }
  if (req.httpMethod !== "POST") {
    return { statusCode: 405, headers: {"Access-Control-Allow-Origin": ORIGIN}, body: "POST only" };
  }
  const endpoint = process.env.ADMINISTRATE_GRAPHQL_ENDPOINT;
  const token = process.env.ADMINISTRATE_API_TOKEN;
  const defaultAccountId = process.env.DEFAULT_ACCOUNT_ID;
  if (!endpoint || !token) {
    return {
      statusCode: 500,
      headers: {"Access-Control-Allow-Origin": ORIGIN},
      body: "Missing ADMINISTRATE_GRAPHQL_ENDPOINT or ADMINISTRATE_API_TOKEN",
    };
  }
  let body;
  try { body = JSON.parse(req.body || "{}"); } catch { body = {}; }
  const { identifierType = "code", identifierValue, learner } = body;
  if (!identifierValue) {
    return { statusCode: 400, headers: {"Access-Control-Allow-Origin": ORIGIN}, body: "identifierValue is required" };
  }
  if (!learner?.firstName || !learner?.lastName || !learner?.email) {
    return { statusCode: 400, headers: {"Access-Control-Allow-Origin": ORIGIN}, body: "firstName, lastName, email are required" };
  }

  async function gql(query, variables) {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables })
    });
    const json = await r.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }

  const FIND_CONTACT_BY_EMAIL = `
    query FindContactByEmail($email: String!) {
      contacts(filters: [{ field: emailAddress, operation: eq, value: $email }]) {
        edges { node { id emailAddress personalName { firstName lastName } } }
      }
    }
  `;

  const CREATE_CONTACT = `
    mutation CreateContact($input: ContactCreateInput!) {
      contact {
        create(input: $input) {
          contact { id }
          errors { label message value }
        }
      }
    }
  `;

  const REGISTER_CONTACTS = `
    mutation RegisterContacts($eventId: ID!, $contactIds: [ID!]!) {
      event {
        registerContacts(eventId: $eventId, input: { contacts: $contactIds }) {
          event { id }
          errors { label message value }
        }
      }
    }
  `;

  const GET_EVENT_BY_CODE = `
    query GetEventByCode($code: String!) {
      events(filters: [{ field: code, operation: eq, value: $code }]) {
        edges { node { id code title } }
      }
    }
  `;

  const GET_EVENT_BY_ID = `
    query GetEventById($id: ID!) {
      events(filters: [{ field: id, operation: eq, value: $id }]) {
        edges { node { id code title } }
      }
    }
  `;

  const GET_EVENT_BY_LEGACY_ID = `
    query GetEventByLegacyId($legacyId: String!) {
      events(filters: [{ field: legacyId, operation: eq, value: $legacyId }]) {
        edges { node { id code legacyId title } }
      }
    }
  `;

  try {
    let eventId;
    if (identifierType === "id") {
      eventId = identifierValue;
    } else if (identifierType === "legacyId") {
      const data = await gql(GET_EVENT_BY_LEGACY_ID, { legacyId: identifierValue });
      const node = data?.events?.edges?.[0]?.node;
      if (!node) return { statusCode: 404, headers: {"Access-Control-Allow-Origin": ORIGIN}, body: "Event not found" };
      eventId = node.id;
    } else {
      const data = await gql(GET_EVENT_BY_CODE, { code: identifierValue });
      const node = data?.events?.edges?.[0]?.node;
      if (!node) return { statusCode: 404, headers: {"Access-Control-Allow-Origin": ORIGIN}, body: "Event not found" };
      eventId = node.id;
    }

    let contactId;
    const fc = await gql(FIND_CONTACT_BY_EMAIL, { email: learner.email });
    contactId = fc?.contacts?.edges?.[0]?.node?.id;

    if (!contactId) {
      if (!defaultAccountId) {
        return {
          statusCode: 400,
          headers: {"Access-Control-Allow-Origin": ORIGIN},
          body: "Contact not found. Set DEFAULT_ACCOUNT_ID env var to allow auto-create."
        }
      }
      const createInput = {
        accountId: defaultAccountId,
        personalName: {
          firstName: learner.firstName,
          lastName: learner.lastName
        },
        emailAddress: learner.email
      };
      const cc = await gql(CREATE_CONTACT, { input: createInput });
      const created = cc?.contact?.create;
      if (created?.errors?.length) {
        return {
          statusCode: 400,
          headers: {"Access-Control-Allow-Origin": ORIGIN},
          body: "Contact create error: " + JSON.stringify(created.errors)
        }
      }
      contactId = created?.contact?.id;
    }

    const reg = await gql(REGISTER_CONTACTS, { eventId, contactIds: [contactId] });
    const errs = reg?.event?.registerContacts?.errors;
    if (errs && errs.length) {
      return {
        statusCode: 400,
        headers: {"Access-Control-Allow-Origin": ORIGIN},
        body: "Registration error: " + JSON.stringify(errs)
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ORIGIN
      },
      body: JSON.stringify({ success: true, message: "Registered", eventId, contactId })
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: {"Access-Control-Allow-Origin": ORIGIN},
      body: String(err)
    }
  }
};