"use client";

import { useState, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

type Option = { id: string; label: string };

export function UserForm({
  mode,
  userId,
  sims,
  policies,
  initial,
}: {
  mode: "create" | "edit";
  userId?: string;
  sims: Option[];
  policies: Option[];
  initial?: {
    username: string;
    displayName: string;
    timezone: string;
    userLanguage: string;
    recipientLanguage: string;
    translationEnabled: boolean;
    allowExport: boolean;
    allowSelfPasswordChange: boolean;
    policyId: string | null;
  };
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const simId = String(form.get("simId") ?? "");
    const policyId = String(form.get("policyId") ?? "");
    const shared = {
      username: String(form.get("username") ?? ""),
      displayName: String(form.get("displayName") ?? ""),
      userLanguage: String(form.get("userLanguage") ?? "en"),
      recipientLanguage: String(form.get("recipientLanguage") ?? "en"),
      translationEnabled: form.get("translationEnabled") === "on",
      timezone: String(form.get("timezone") ?? "Asia/Karachi"),
      allowExport: form.get("allowExport") === "on",
      allowSelfPasswordChange: form.get("allowSelfPasswordChange") === "on",
      policyId: policyId.length === 0 ? null : policyId,
    };
    const response = await fetch(
      mode === "create" ? "/api/admin/users" : `/api/admin/users/${userId}`,
      {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify(
          mode === "create"
            ? {
                ...shared,
                simId: simId.length === 0 ? null : simId,
                subscription:
                  String(form.get("planQuantity") ?? "").length === 0
                    ? undefined
                    : {
                        planUnit: String(form.get("planUnit") ?? "month"),
                        planQuantity: Number(form.get("planQuantity")),
                      },
              }
            : shared,
        ),
      },
    );
    const payload = (await response.json()) as {
      message?: string;
      data?: { initialPassword?: string; user?: { id: string }; id?: string };
    };
    if (!response.ok) {
      setError(payload.message ?? "The user was not saved.");
      return;
    }
    if (payload.data?.initialPassword) {
      setPassword(payload.data.initialPassword);
      return;
    }
    const id = payload.data?.user?.id ?? payload.data?.id ?? userId;
    window.location.assign(id ? `/users/${id}` : "/users");
  }

  return (
    <form onSubmit={submit} className="mt-6 grid max-w-lg gap-3">
      <label className="grid gap-1 font-body text-sm">
        Username
        <input
          className="border border-ink bg-paper px-3 py-2"
          name="username"
          defaultValue={initial?.username}
          required
        />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Display name
        <input
          className="border border-ink bg-paper px-3 py-2"
          name="displayName"
          defaultValue={initial?.displayName}
          required
        />
      </label>
      <label className="grid gap-1 font-body text-sm">
        Timezone
        <input
          className="border border-ink bg-paper px-3 py-2"
          name="timezone"
          defaultValue={initial?.timezone ?? "Asia/Karachi"}
          required
        />
      </label>
      <label className="grid gap-1 font-body text-sm">
        User language
        <select
          className="border border-ink bg-paper px-3 py-2"
          name="userLanguage"
          defaultValue={initial?.userLanguage ?? "en"}
        >
          <option value="en">English</option>
          <option value="zh">Chinese</option>
        </select>
      </label>
      <label className="grid gap-1 font-body text-sm">
        Recipient language
        <select
          className="border border-ink bg-paper px-3 py-2"
          name="recipientLanguage"
          defaultValue={initial?.recipientLanguage ?? "en"}
        >
          <option value="en">English</option>
          <option value="zh">Chinese</option>
        </select>
      </label>
      <label className="flex items-center gap-2 font-body text-sm">
        <input
          name="translationEnabled"
          type="checkbox"
          defaultChecked={initial?.translationEnabled ?? false}
        />
        Translation
      </label>
      <label className="flex items-center gap-2 font-body text-sm">
        <input name="allowExport" type="checkbox" defaultChecked={initial?.allowExport ?? true} />
        Allow export
      </label>
      <label className="flex items-center gap-2 font-body text-sm">
        <input
          name="allowSelfPasswordChange"
          type="checkbox"
          defaultChecked={initial?.allowSelfPasswordChange ?? true}
        />
        Allow self password change
      </label>
      <label className="grid gap-1 font-body text-sm">
        Policy
        <select
          className="border border-ink bg-paper px-3 py-2"
          name="policyId"
          defaultValue={initial?.policyId ?? ""}
        >
          <option value="">Default</option>
          {policies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.label}
            </option>
          ))}
        </select>
      </label>
      {mode === "create" ? (
        <>
          <label className="grid gap-1 font-body text-sm">
            SIM
            <select className="border border-ink bg-paper px-3 py-2" name="simId" defaultValue="">
              <option value="">Unassigned</option>
              {sims.map((sim) => (
                <option key={sim.id} value={sim.id}>
                  {sim.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 font-body text-sm">
            Plan
            <select
              className="border border-ink bg-paper px-3 py-2"
              name="planUnit"
              defaultValue="month"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </label>
          <label className="grid gap-1 font-body text-sm">
            Quantity
            <input
              className="border border-ink bg-paper px-3 py-2"
              name="planQuantity"
              type="number"
              min={1}
              defaultValue={1}
            />
          </label>
        </>
      ) : null}
      <button className="bg-ink px-3 py-2 font-body text-paper" type="submit">
        {mode === "create" ? "Create user" : "Save user"}
      </button>
      {error.length > 0 ? <p className="font-body text-sm text-signal">{error}</p> : null}
      {password.length > 0 ? (
        <p className="font-body text-sm">
          Initial password, shown once:{" "}
          <code className="font-mono" data-testid="initial-password">
            {password}
          </code>
          <button
            className="ml-3 border border-ink px-2 py-1"
            type="button"
            onClick={() => void navigator.clipboard.writeText(password)}
          >
            Copy
          </button>
        </p>
      ) : null}
    </form>
  );
}
