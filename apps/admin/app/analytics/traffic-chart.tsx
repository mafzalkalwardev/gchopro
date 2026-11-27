"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartPoint = {
  bucket: string;
  sent: number;
  delivered: number;
  failed: number;
  received: number;
  deliveryRatio: number | null;
};

export function TrafficChart({ points }: { points: ChartPoint[] }) {
  const rows = points.map((point) => ({ ...point, deliveryRatio: point.deliveryRatio ?? 0 }));
  return (
    <div className="mt-8 h-72 w-full min-w-0 max-w-4xl">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows}>
          <CartesianGrid stroke="var(--color-ink)" strokeOpacity={0.15} />
          <XAxis dataKey="bucket" />
          <YAxis yAxisId="count" />
          <YAxis yAxisId="ratio" orientation="right" domain={[0, 1]} />
          <Tooltip />
          <Bar yAxisId="count" dataKey="sent" fill="var(--color-ink)" />
          <Bar yAxisId="count" dataKey="delivered" fill="var(--color-signal)" />
          <Bar yAxisId="count" dataKey="failed" fill="var(--color-ink)" fillOpacity={0.35} />
          <Bar yAxisId="count" dataKey="received" fill="var(--color-signal)" fillOpacity={0.45} />
          <Line yAxisId="ratio" dataKey="deliveryRatio" stroke="var(--color-signal)" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
