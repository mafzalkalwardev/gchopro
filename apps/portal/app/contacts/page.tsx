import { cookies } from "next/headers";
import { screenText } from "@/lib/copy";
import { COOKIE, SAFE_TEXT } from "@gchopro/core";
import { listContacts, listPortalNotices } from "@gchopro/db";
import { PortalNav, requirePortal } from "@/lib/gate";
import { ContactEditor, ContactForm } from "./contact-form";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ send?: string }>;
}) {
  const session = await requirePortal();
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const rows = await listContacts(token);
  const query = await searchParams;
  const send =
    query.send !== undefined && query.send in SAFE_TEXT
      ? SAFE_TEXT[query.send as keyof typeof SAFE_TEXT]
      : "";
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <PortalNav unread={unread} username={session.username} userId={session.userId} />

      <h1 className="mt-3 font-display text-4xl">{await screenText("contacts")}</h1>
      {send.length > 0 ? <p className="mt-4 font-body text-sm text-signal">{send}</p> : null}
      {rows.contacts.length === 0 ? (
        <p className="mt-6 font-body text-sm">No contacts yet.</p>
      ) : (
        <ul className="tape mt-8 max-w-xl">
          {rows.contacts.map((contact) => (
            <li key={contact.id}>
              <ContactEditor contact={contact} />
            </li>
          ))}
        </ul>
      )}
      <ContactForm />
    </main>
  );
}
