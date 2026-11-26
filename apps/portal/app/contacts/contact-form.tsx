"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

const SOURCES = [
  "existing_customer",
  "verbal",
  "written",
  "web_form",
  "imported_with_consent",
  "other",
];

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

export function ContactForm() {
  const [error, setError] = useState("");
  const note = useOptedOutNote();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/portal/contacts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        number: String(form.get("number") ?? ""),
        consentSource: String(form.get("consentSource") ?? ""),
        consentNote: String(form.get("consentNote") ?? "") || undefined,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? "The contact was not saved.");
      return;
    }
    window.location.reload();
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
        <input
          className="border border-ink/20 bg-paper px-3 py-2"
          name="name"
          placeholder="Name"
          required
        />
        <input
          className="border border-ink/20 bg-paper px-3 py-2 font-mono"
          name="number"
          placeholder="Number"
          required
        />
        <select className="border border-ink/20 bg-paper px-3 py-2" name="consentSource" required>
          {SOURCES.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <input
          className="border border-ink/20 bg-paper px-3 py-2"
          name="consentNote"
          placeholder="Consent note"
        />
        <button className="w-fit border border-ink px-4 py-2 font-body" type="submit">
          Add contact
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
      {error.length > 0 ? <p className="font-body text-signal">{error}</p> : null}
    </div>
  );
}
