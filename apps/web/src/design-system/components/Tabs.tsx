import { useRef } from "react";

export interface TabItem<T extends string> {
  value: T;
  label: string;
}
export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

export function Tabs<T extends string>({ items, value, onChange, label }: TabsProps<T>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(index: number) {
    const target = items[index];
    if (!target) return;
    onChange(target.value);
    buttonRefs.current[index]?.focus();
  }

  return (
    <div aria-label={label} className="ds-tabs" role="tablist">
      {items.map((item, index) => (
        <button
          aria-selected={item.value === value}
          className={item.value === value ? "active" : ""}
          key={item.value}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const nextIndex =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : event.key === "ArrowRight"
                    ? (index + 1) % items.length
                    : (index - 1 + items.length) % items.length;
            moveFocus(nextIndex);
          }}
          ref={(element) => {
            buttonRefs.current[index] = element;
          }}
          role="tab"
          tabIndex={item.value === value ? 0 : -1}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
