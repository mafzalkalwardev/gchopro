"use client";

import { useState, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function GroupEditor({ contacts }: { contacts: { id: string; name: string }[] }) {
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/portal/groups", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        contactIds: form.getAll("contactId").map(String),
      }),
    });
    if (!response.ok) {
      setError("The group was not saved.");
      return;
    }
    window.location.reload();
  }

  return (
    <form className="mt-8 grid max-w-xl gap-3" onSubmit={(event) => void save(event)}>
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        name="name"
        placeholder="Group name"
        required
      />
      <fieldset className="grid gap-2 font-body text-sm">
        <legend>Members</legend>
        {contacts.map((contact) => (
          <label key={contact.id} className="flex gap-2">
            <input type="checkbox" name="contactId" value={contact.id} />
            {contact.name}
          </label>
        ))}
      </fieldset>
      <button className="w-fit border border-ink px-4 py-2 font-body" type="submit">
        Save group
      </button>
      {error.length > 0 ? <p className="text-signal">{error}</p> : null}
    </form>
  );
}
