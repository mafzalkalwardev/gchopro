"use client";

import { useState, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

export function SharedTemplateForm() {
  const [error, setError] = useState("");
  const [body, setBody] = useState("Hi {name}");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/templates", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        body,
        kind: String(form.get("kind") ?? "template"),
      }),
    });
    if (!response.ok) {
      setError("The template was not saved.");
      return;
    }
    window.location.reload();
  }

  return (
    <form className="mt-8 grid max-w-xl gap-3" onSubmit={(event) => void save(event)}>
      <input
        className="border border-ink/20 bg-paper px-3 py-2"
        name="name"
        placeholder="Name"
        required
      />
      <select className="border border-ink/20 bg-paper px-3 py-2" name="kind">
        <option value="template">Template</option>
        <option value="quick_reply">Quick reply</option>
      </select>
      <textarea
        className="min-h-32 border border-ink/20 bg-paper px-3 py-2"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <p className="font-mono text-xs">{body.length} characters</p>
      <button className="w-fit border border-ink px-4 py-2 font-body" type="submit">
        Save shared template
      </button>
      {error.length > 0 ? <p className="text-signal">{error}</p> : null}
    </form>
  );
}
