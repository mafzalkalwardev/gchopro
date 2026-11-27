import { AppError, SAFE_TEXT, parseContactCsv, type ContactBody } from "@gchopro/core";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { getDb } from "./client.js";
import { indexPhone, normalizePhone, openSeal, readRegion, seal } from "./device-shared.js";
import { requireReady } from "./login.js";
import { contactGroupMembers, contactGroups, contacts, optOuts } from "./schema.js";

function reject(status: number, code: "not_found" | "conflict" | "invalid_body"): never {
  const message =
    code === "not_found"
      ? SAFE_TEXT.not_found
      : code === "conflict"
        ? SAFE_TEXT.conflict
        : SAFE_TEXT.invalid_body;
  throw new AppError(status, code, message);
}

function isUnique(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error ? isUnique(error.cause) : false;
}

async function ownContact(userId: string, id: string) {
  const rows = await getDb()
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) reject(404, "not_found");
  return row;
}

function viewContact(row: typeof contacts.$inferSelect) {
  return {
    id: row.id,
    name: openSeal(`contacts.name_enc.${row.id}`, row.nameEnc) ?? "",
    number: openSeal(`contacts.number_enc.${row.id}`, row.numberEnc) ?? "",
    consentSource: row.consentSource,
    consentNote: row.consentNote,
    consentAt: row.consentAt?.toISOString() ?? null,
    tags: row.tags,
  };
}

export async function listContacts(token: string | undefined) {
  const session = await requireReady(token, "portal");
  const rows = await getDb().select().from(contacts).where(eq(contacts.userId, session.userId));
  return { contacts: rows.map(viewContact) };
}

export async function createContact(token: string | undefined, input: ContactBody) {
  const session = await requireReady(token, "portal");
  const region = await readRegion(getDb());
  const number = normalizePhone(input.number, region);
  const id = uuidv7();
  try {
    await getDb()
      .insert(contacts)
      .values({
        id,
        userId: session.userId,
        nameEnc: seal(`contacts.name_enc.${id}`, input.name),
        numberEnc: seal(`contacts.number_enc.${id}`, number),
        numberHash: indexPhone(number),
        consentSource: input.consentSource,
        consentNote: input.consentNote ?? null,
        consentAt: input.consentAt ? new Date(input.consentAt) : new Date(),
        tags: input.tags ?? [],
      });
  } catch (error) {
    if (isUnique(error)) reject(409, "conflict");
    throw error;
  }
  return viewContact(await ownContact(session.userId, id));
}

export async function patchContact(token: string | undefined, id: string, input: ContactBody) {
  const session = await requireReady(token, "portal");
  await ownContact(session.userId, id);
  const number = normalizePhone(input.number, await readRegion(getDb()));
  try {
    await getDb()
      .update(contacts)
      .set({
        nameEnc: seal(`contacts.name_enc.${id}`, input.name),
        numberEnc: seal(`contacts.number_enc.${id}`, number),
        numberHash: indexPhone(number),
        consentSource: input.consentSource,
        consentNote: input.consentNote ?? null,
        consentAt: input.consentAt ? new Date(input.consentAt) : new Date(),
        tags: input.tags ?? [],
      })
      .where(and(eq(contacts.id, id), eq(contacts.userId, session.userId)));
  } catch (error) {
    if (isUnique(error)) reject(409, "conflict");
    throw error;
  }
  return viewContact(await ownContact(session.userId, id));
}

export async function deleteContact(token: string | undefined, id: string) {
  const session = await requireReady(token, "portal");
  await ownContact(session.userId, id);
  await getDb().delete(contactGroupMembers).where(eq(contactGroupMembers.contactId, id));
  await getDb()
    .delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, session.userId)));
}

export async function importContacts(token: string | undefined, csv: string) {
  if (csv.length > 1_000_000) reject(400, "invalid_body");
  const session = await requireReady(token, "portal");
  const parsed = parseContactCsv(csv);
  const region = await readRegion(getDb());
  let imported = 0;
  const rejected = [...parsed.rejected];
  for (const row of parsed.accepted) {
    try {
      await createContact(token, {
        name: row.name.length > 0 ? row.name : row.number,
        number: row.number,
        consentSource: consentOf(row.consentSource),
        consentNote: row.consentNote.length > 0 ? row.consentNote : undefined,
        consentAt: row.consentAt.length > 0 ? row.consentAt : undefined,
        tags: row.tags,
      });
      imported += 1;
    } catch {
      rejected.push({ row: imported + rejected.length + 2, reason: "invalid_number" });
    }
  }
  const candidates: { number: string; hash: string }[] = [];
  for (const row of parsed.accepted) {
    try {
      const number = normalizePhone(row.number, region);
      candidates.push({ number, hash: indexPhone(number) });
    } catch {
      continue;
    }
  }
  const optedOutNumbers = await flaggedOptOuts(session.userId, candidates);
  return { imported, rejected, optedOut: optedOutNumbers.length, optedOutNumbers };
}

function consentOf(value: string): ContactBody["consentSource"] {
  if (
    value === "verbal" ||
    value === "written" ||
    value === "web_form" ||
    value === "imported_with_consent" ||
    value === "other"
  ) {
    return value;
  }
  return "existing_customer";
}

async function flaggedOptOuts(
  userId: string,
  rows: { number: string; hash: string }[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const knownRows = await getDb().select({ hash: optOuts.numberHash }).from(optOuts);
  const known = new Set(knownRows.map((row) => row.hash));
  void userId;
  return rows.filter((row) => known.has(row.hash)).map((row) => row.number);
}

export async function listContactGroups(token: string | undefined) {
  const session = await requireReady(token, "portal");
  const rows = await getDb()
    .select()
    .from(contactGroups)
    .where(eq(contactGroups.userId, session.userId));
  const groups = [];
  for (const row of rows) {
    const members = await getDb()
      .select({ id: contactGroupMembers.contactId })
      .from(contactGroupMembers)
      .where(eq(contactGroupMembers.groupId, row.id));
    groups.push({ id: row.id, name: row.name, contactIds: members.map((member) => member.id) });
  }
  return { groups };
}

export async function saveContactGroup(
  token: string | undefined,
  input: { id?: string; name: string; contactIds?: string[] },
) {
  const session = await requireReady(token, "portal");
  const id = input.id ?? uuidv7();
  if (input.id) {
    const owned = await getDb()
      .select({ id: contactGroups.id })
      .from(contactGroups)
      .where(and(eq(contactGroups.id, id), eq(contactGroups.userId, session.userId)))
      .limit(1);
    if (owned.length === 0) reject(404, "not_found");
    await getDb().update(contactGroups).set({ name: input.name }).where(eq(contactGroups.id, id));
    await getDb().delete(contactGroupMembers).where(eq(contactGroupMembers.groupId, id));
  } else {
    try {
      await getDb().insert(contactGroups).values({ id, userId: session.userId, name: input.name });
    } catch (error) {
      if (isUnique(error)) reject(409, "conflict");
      throw error;
    }
  }
  for (const contactId of input.contactIds ?? []) {
    await ownContact(session.userId, contactId);
    await getDb().insert(contactGroupMembers).values({ groupId: id, contactId });
  }
  return { id, name: input.name, contactIds: input.contactIds ?? [] };
}

export async function deleteContactGroup(token: string | undefined, id: string) {
  const session = await requireReady(token, "portal");
  await getDb().delete(contactGroupMembers).where(eq(contactGroupMembers.groupId, id));
  const removed = await getDb()
    .delete(contactGroups)
    .where(and(eq(contactGroups.id, id), eq(contactGroups.userId, session.userId)))
    .returning({ id: contactGroups.id });
  if (removed.length === 0) reject(404, "not_found");
}
