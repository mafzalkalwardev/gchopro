import { cookies } from "next/headers";
import { screenText } from "@/lib/copy";
import { COOKIE } from "@gchopro/core";
import { listContacts, listPortalNotices } from "@gchopro/db";
import { PortalNav, requirePortal } from "@/lib/gate";
import { ContactForm } from "./contact-form";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const session = await requirePortal();
  const token = (await cookies()).get(COOKIE.portal)?.value;
  const notices = await listPortalNotices(session.userId);
  const unread = notices.filter((notice) => notice.read !== true).length;
  const rows = await listContacts(token);
  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <p className="font-mono text-sm text-signal">GChoPro</p>
      <h1 className="mt-3 font-display text-4xl">{await screenText("contacts")}</h1>
      <PortalNav unread={unread} />
      <table className="mt-8 w-full max-w-3xl border-collapse font-body text-sm">
        <thead>
          <tr className="border-b border-ink/20 text-left font-mono text-xs uppercase">
            <th className="py-2">Name</th>
            <th>Number</th>
            <th>Consent</th>
          </tr>
        </thead>
        <tbody>
          {rows.contacts.map((contact) => (
            <tr key={contact.id} className="border-b border-ink/10">
              <td className="py-2">{contact.name}</td>
              <td className="font-mono">{contact.number}</td>
              <td>{contact.consentSource}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ContactForm />
    </main>
  );
}
