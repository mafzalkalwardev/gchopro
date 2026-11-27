"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

const SOURCES = [
  ["existing_customer", "Existing customer"],
  ["verbal", "Verbal"],
  ["written", "Written"],
  ["web_form", "Web form"],
  ["imported_with_consent", "Imported with consent"],
  ["other", "Other"],
] as const;

export type SavedContact = {
  id: string;
  name: string;
  number: string;
  consentSource: string;
  consentNote: string | null;
  consentAt: string | null;
  tags: string[];
};

function optedOutNote(): string {
  const numbers = new URLSearchParams(window.location.search).get("optedOut");
  if (numbers === null || numbers.length === 0) return "";
  return `Opted out: ${numbers}`;
}

function useOptedOutNote(): string {
  return useSyncExternalStore(
    () => () => undefined,
    optedOutNote,
    () => "",
  );
}

async function sendContact(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<string | null> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-csrf-token": csrf() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json()) as { message?: string };
    return payload.message ?? "The contact was not saved.";
  }
  window.location.reload();
  return null;
}

function Fields({ contact, numberLocked }: { contact?: SavedContact; numberLocked?: string }) {
  const number = numberLocked ?? contact?.number ?? "";
  return (
    <>
      <label className="grid gap-1 font-body text-sm">
        Name
        <input
          className="w-full border border-ink bg-paper px-3"
          name="name"
          defaultValue={contact?.name ?? ""}
          autoComplete="name"
          required
        />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Number
        <input
          className="w-full border border-ink bg-paper px-3 font-mono"
          name="number"
          defaultValue={number}
          readOnly={numberLocked !== undefined}
          autoComplete="tel"
          required
        />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Consent
        <select
          className="w-full border border-ink bg-paper px-3"
          name="consentSource"
          defaultValue={contact?.consentSource ?? "existing_customer"}
          required
        >
          {SOURCES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 font-body text-sm">
        Consent note
        <input
          className="w-full border border-ink bg-paper px-3"
          name="consentNote"
          defaultValue={contact?.consentNote ?? ""}
        />
      </label>
    </>
  );
}

export function ContactForm() {
  const [error, setError] = useState("");
  const note = useOptedOutNote();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const noteValue = String(form.get("consentNote") ?? "");
    const message = await sendContact("/api/portal/contacts", "POST", {
      name: String(form.get("name") ?? ""),
      number: String(form.get("number") ?? ""),
      consentSource: String(form.get("consentSource") ?? ""),
      consentNote: noteValue.length > 0 ? noteValue : undefined,
    });
    if (message !== null) setError(message);
  }

  async function upload(file: File) {
    const text = await file.text();
    const response = await fetch("/api/portal/contacts/import", {
      method: "POST",
      headers: { "content-type": "text/csv", "x-csrf-token": csrf() },
      body: text,
    });
    if (!response.ok) {
      setError("The file was not imported.");
      return;
    }
    const payload = (await response.json()) as { data?: { optedOutNumbers?: string[] } };
    const numbers = payload.data?.optedOutNumbers ?? [];
    const next = new URL(window.location.href);
    if (numbers.length > 0) next.searchParams.set("optedOut", numbers.join(","));
    else next.searchParams.delete("optedOut");
    window.location.assign(`${next.pathname}${next.search}`);
  }

  return (
    <div className="mt-8 grid max-w-xl gap-8">
      <form className="grid gap-3" onSubmit={(event) => void save(event)}>
        <h2 className="font-display text-2xl">Save a contact</h2>
        <Fields />
        <button className="mt-1 w-full bg-ink font-body text-paper" type="submit">
          Save contact
        </button>
      </form>
      <label className="grid gap-2 font-body text-sm">
        CSV import
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      {note.length > 0 ? <p className="font-body text-sm">{note}</p> : null}
      {error.length > 0 ? <p className="font-body text-sm text-signal">{error}</p> : null}
    </div>
  );
}

export function ContactEditor({ contact }: { contact: SavedContact }) {
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const noteValue = String(form.get("consentNote") ?? "");
    const message = await sendContact(`/api/portal/contacts/${contact.id}`, "PATCH", {
      name: String(form.get("name") ?? ""),
      number: String(form.get("number") ?? ""),
      consentSource: String(form.get("consentSource") ?? ""),
      consentNote: noteValue.length > 0 ? noteValue : undefined,
      consentAt: contact.consentAt ?? undefined,
      tags: contact.tags,
    });
    if (message !== null) setError(message);
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void save(event)}>
      <Fields contact={contact} />
      <button className="mt-1 w-full bg-ink font-body text-paper md:w-fit" type="submit">
        Save
      </button>
      {error.length > 0 ? <p className="font-body text-sm text-signal">{error}</p> : null}
    </form>
  );
}

export function SavePeerContact({ number, heading = true }: { number: string; heading?: boolean }) {
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const noteValue = String(form.get("consentNote") ?? "");
    const message = await sendContact("/api/portal/contacts", "POST", {
      name: String(form.get("name") ?? ""),
      number,
      consentSource: String(form.get("consentSource") ?? ""),
      consentNote: noteValue.length > 0 ? noteValue : undefined,
    });
    if (message !== null) setError(message);
  }

  if (number.length === 0) return null;

  return (
    <form className="mt-4 grid max-w-xl gap-3" onSubmit={(event) => void save(event)}>
      {heading ? <h2 className="font-display text-2xl">Save contact</h2> : null}
      <Fields numberLocked={number} />
      <button className="mt-1 w-full bg-ink font-body text-paper" type="submit">
        Save contact
      </button>
      {error.length > 0 ? <p className="font-body text-sm text-signal">{error}</p> : null}
    </form>
  );
}
