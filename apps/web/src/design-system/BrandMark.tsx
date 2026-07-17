export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={`brand-mark ${className}`.trim()} viewBox="0 0 32 32">
      <path
        className="brand-mark-route"
        d="M4 23.5c3.5 1.4 6.7.9 9.5-1.5 2-1.7 2.9-4 5.2-5.2 2.2-1.2 5.2-.7 8.8 1.3"
      />
      <path
        className="brand-mark-aircraft"
        d="m4.5 15.8 8.1-2.7 4.7-8.4 2.4 1.2-1.8 6.6 6.5-2.2 1.6 2-7 5-1.3 7.2-2.4-1.2-.9-4.8-5.6 2.1-1.4-1.9 4.4-3.8-5.4-1.5Z"
      />
    </svg>
  );
}
