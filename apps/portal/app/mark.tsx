export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="7.5"
        fill="#1C1915"
        stroke="#C46B1A"
        strokeWidth="1.5"
      />
      <rect x="6.5" y="6" width="4.2" height="13" rx="1.2" fill="#F4F0E6" />
      <rect x="13.9" y="6" width="4.2" height="13" rx="1.2" fill="#F4F0E6" />
      <rect x="21.3" y="6" width="4.2" height="13" rx="1.2" fill="#F4F0E6" />
      <circle cx="23.4" cy="23.6" r="2.3" fill="#C46B1A" />
    </svg>
  );
}
