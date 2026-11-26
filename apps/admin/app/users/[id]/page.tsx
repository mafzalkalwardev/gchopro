import { notFound } from "next/navigation";
import { AppError } from "@gchopro/core";
import { freeSims, getUser, supportViewEnabled } from "@gchopro/db";
import { screenText } from "@/lib/copy";
import { BenchNav, requireDesk } from "@/lib/desk";
import { UserActions } from "../user-actions";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireDesk();
  const { id } = await params;
  const user = await getUser(id).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  });
  if (user === null) notFound();
  const sims = await freeSims();
  const support = await supportViewEnabled();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <BenchNav username={session.username} />
      <section className="px-6 py-8">
        <div className="flex items-end justify-between gap-4">
          <h1 className="font-display text-4xl">
            <span className="sr-only">{await screenText("user")}</span>
            {user.displayName}
          </h1>
          <a
            className="border border-ink px-3 py-2 font-body text-sm"
            href={`/users/${user.id}/edit`}
          >
            Edit
          </a>
        </div>
        {support ? (
          <p className="mt-4 font-body">
            <a className="underline" href={`/users/${user.id}/support`}>
              {await screenText("support")}
            </a>
          </p>
        ) : null}
        <p className="mt-2 font-mono text-sm">{user.username}</p>
        <p className="mt-4 font-body">
          Status {user.status}. Line{" "}
          {user.sim?.phoneNumber ?? user.sim?.carrierName ?? "unassigned"}.
        </p>
        <h2 className="mt-8 font-display text-2xl">Subscription</h2>
        {user.subscription ? (
          <p className="mt-2 font-body">
            {user.subscription.status} until {user.subscription.endsAt.slice(0, 16)} (
            {user.subscription.planQuantity} {user.subscription.planUnit},{" "}
            {user.subscription.expiryBehavior})
          </p>
        ) : (
          <p className="mt-2 font-body">No subscription.</p>
        )}
        <h2 className="mt-8 font-display text-2xl">Usage</h2>
        <p className="mt-2 font-mono text-sm">
          {user.usage.minute}/min · {user.usage.hour}/hour · {user.usage.day}/day ·{" "}
          {user.usage.segmentsDay} segments
        </p>
        <h2 className="mt-8 font-display text-2xl">Sessions</h2>
        <ul className="mt-2 font-body text-sm">
          {user.sessions.map((row) => (
            <li key={row.id}>
              {row.app} from {row.ip ?? "unknown"} seen {row.lastSeenAt.slice(0, 16)}
            </li>
          ))}
        </ul>
        {user.sessions.length === 0 ? (
          <p className="font-body text-sm">No active sessions.</p>
        ) : null}
        <h2 className="mt-8 font-display text-2xl">Payments</h2>
        <ul className="mt-2 font-body text-sm">
          {user.payments.map((payment) => (
            <li key={payment.id}>
              {payment.amountMinor} {payment.currency} {payment.method}
              {payment.voidedAt ? " void" : ""}
            </li>
          ))}
        </ul>
        <UserActions
          userId={user.id}
          status={user.status}
          subscriptionId={user.subscription?.id ?? null}
          sims={sims.map((sim) => ({
            id: sim.id,
            label: sim.phoneNumber ?? sim.carrierName ?? sim.id,
          }))}
        />
      </section>
    </main>
  );
}
