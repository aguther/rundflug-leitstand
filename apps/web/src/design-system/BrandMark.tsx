export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={`brand-mark ${className}`.trim()} viewBox="0 0 32 32">
      <circle className="brand-mark-route" cx="16" cy="16" r="12.5" />
      <path
        className="brand-mark-aircraft"
        d="m8.6 15.6 7.6-2.5 4.4-7.9 2.2 1.1-1.7 6.2 6.1-2.1 1.5 1.9-6.6 4.7-1.2 6.8-2.2-1.1-.9-4.5-5.3 2-1.3-1.8 4.1-3.6-5-1.4Z"
      />
      <path
        className="brand-mark-tower"
        d="M14.6 27.4v-4.1c0-.9.6-1.6 1.4-1.6s1.4.7 1.4 1.6v4.1"
      />
      <path
        className="brand-mark-tower brand-mark-tower-wave"
        d="M13.3 21.7a3.9 3.9 0 0 1 5.4 0M12.1 19.8a6.2 6.2 0 0 1 7.8 0"
      />
    </svg>
  );
}
