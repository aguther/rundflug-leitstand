import { useId, useRef } from "react";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  id?: string;
  panelId?: string;
}
export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  idPrefix?: string;
}

function keyboardTabIndex(key: string, index: number, tabCount: number): number | null {
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return tabCount - 1;
    case "ArrowRight":
      return (index + 1) % tabCount;
    case "ArrowLeft":
      return (index - 1 + tabCount) % tabCount;
    default:
      return null;
  }
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
}: Readonly<TabsProps<T>>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const generatedId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const resolvedPrefix = idPrefix ?? `tabs-${generatedId}`;

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
          aria-controls={item.panelId ?? `${resolvedPrefix}-${item.value}-panel`}
          aria-selected={item.value === value}
          className={item.value === value ? "active" : ""}
          id={item.id ?? `${resolvedPrefix}-${item.value}-tab`}
          key={item.value}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            const nextIndex = keyboardTabIndex(event.key, index, items.length);
            if (nextIndex === null) return;
            event.preventDefault();
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
