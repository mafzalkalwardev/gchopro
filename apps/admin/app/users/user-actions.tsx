"use client";

import { useState, type FormEvent } from "react";

function csrf(): string {
  const row = document.cookie.split("; ").find((part) => part.startsWith("__Host-gcho_csrf="));
  return row ? decodeURIComponent(row.slice("__Host-gcho_csrf=".length)) : "";
}

type SimOption = { id: string; label: string };

export function UserActions({
  userId,
  status,
  subscriptionId,
  sims,
}: {
  userId: string;
  status: string;
  subscriptionId: string | null;
  sims: SimOption[];
}) {
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");

  async function send(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: body === undefined ? "{}" : JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      data?: { initialPassword?: string };
    };
    if (!response.ok) {
      setMessage(payload.message ?? "The action was not saved.");
      return;
    }
    if (payload.data?.initialPassword) setPassword(payload.data.initialPassword);
    setMessage("Saved.");
    if (payload.data?.initialPassword === undefined) window.location.reload();
  }

  function confirmSubmit(event: FormEvent<HTMLFormElement>, path: string, body?: unknown) {
    event.preventDefault();
    if (!window.confirm("Confirm this action?")) return;
    void send(path, body);
  }

  return (
    <div className="mt-8 grid max-w-lg gap-6">
      <form
        onSubmit={(event) => {
          const form = new FormData(event.currentTarget);
          confirmSubmit(event, `/api/admin/users/${userId}/assign-sim`, {
            simId: String(form.get("simId") ?? "") || null,
          });
        }}
      >
        <label className="grid gap-1 font-body text-sm" htmlFor="assign-sim">
          Assign a free SIM
        </label>
        <select id="assign-sim" className="border border-ink bg-paper px-3 py-2" name="simId">
          <option value="">Unassign</option>
          {sims.map((sim) => (
            <option key={sim.id} value={sim.id}>
              {sim.label}
            </option>
          ))}
        </select>
        <button className="mt-2 border border-ink px-3 py-2" type="submit">
          Save line
        </button>
      </form>
      {subscriptionId ? (
        <div className="flex flex-wrap gap-2">
          <form
            onSubmit={(event) =>
              confirmSubmit(event, `/api/admin/subscriptions/${subscriptionId}/extend`, {
                planUnit: "month",
                planQuantity: 1,
              })
            }
          >
            <button className="border border-ink px-3 py-2" type="submit">
              Extend one month
            </button>
          </form>
          <form
            onSubmit={(event) =>
              confirmSubmit(event, `/api/admin/subscriptions/${subscriptionId}/pause`)
            }
          >
            <button className="border border-ink px-3 py-2" type="submit">
              Pause
            </button>
          </form>
          <form
            onSubmit={(event) =>
              confirmSubmit(event, `/api/admin/subscriptions/${subscriptionId}/resume`)
            }
          >
            <button className="border border-ink px-3 py-2" type="submit">
              Resume
            </button>
          </form>
          <form
            onSubmit={(event) =>
              confirmSubmit(event, `/api/admin/subscriptions/${subscriptionId}/disable`, {
                reason: "admin",
              })
            }
          >
            <button className="border border-ink px-3 py-2" type="submit">
              Disable subscription
            </button>
          </form>
          <form
            onSubmit={(event) =>
              confirmSubmit(event, `/api/admin/subscriptions/${subscriptionId}/enable`)
            }
          >
            <button className="border border-ink px-3 py-2" type="submit">
              Enable subscription
            </button>
          </form>
        </div>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void (async () => {
            const sudo = await fetch("/api/admin/auth/sudo", {
              method: "POST",
              headers: { "content-type": "application/json", "x-csrf-token": csrf() },
              body: JSON.stringify({
                password: String(form.get("password") ?? ""),
                code: String(form.get("code") ?? ""),
              }),
            });
            if (!sudo.ok) {
              setMessage("Sudo was not granted.");
              return;
            }
            if (!window.confirm("Reset this password and sign the user out?")) return;
            await send(`/api/admin/users/${userId}/reset-password`, {});
          })();
        }}
      >
        <h2 className="font-display text-2xl">Reset password</h2>
        <label className="mt-2 grid gap-1 font-body text-sm">
          Your password
          <input
            className="border border-ink bg-paper px-3 py-2"
            name="password"
            type="password"
            required
          />
        </label>
        <label className="mt-2 grid gap-1 font-body text-sm">
          Authenticator code
          <input
            className="border border-ink bg-paper px-3 py-2"
            name="code"
            inputMode="numeric"
            required
          />
        </label>
        <button className="mt-2 bg-ink px-3 py-2 font-body text-paper" type="submit">
          Reset password
        </button>
      </form>
      {password.length > 0 ? (
        <p className="font-body text-sm">
          New password, shown once: <code className="font-mono">{password}</code>
        </p>
      ) : null}
      {status === "active" ? (
        <form
          onSubmit={(event) => {
            const form = new FormData(event.currentTarget);
            confirmSubmit(event, `/api/admin/users/${userId}/disable`, {
              reason: String(form.get("reason") ?? "disabled"),
            });
          }}
        >
          <label className="grid gap-1 font-body text-sm">
            Disable reason
            <input className="border border-ink bg-paper px-3 py-2" name="reason" required />
          </label>
          <button className="mt-2 border border-ink px-3 py-2" type="submit">
            Disable user
          </button>
        </form>
      ) : (
        <form onSubmit={(event) => confirmSubmit(event, `/api/admin/users/${userId}/enable`)}>
          <button className="border border-ink px-3 py-2" type="submit">
            Enable user
          </button>
        </form>
      )}
      <form
        onSubmit={(event) => confirmSubmit(event, `/api/admin/users/${userId}/revoke-sessions`)}
      >
        <button className="border border-ink px-3 py-2" type="submit">
          Revoke sessions
        </button>
      </form>
      {message.length > 0 ? <p className="font-body text-sm text-signal">{message}</p> : null}
    </div>
  );
}
