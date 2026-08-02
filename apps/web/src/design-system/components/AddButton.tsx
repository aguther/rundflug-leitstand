import type { ButtonProps } from "./Button";
import { Button } from "./Button";

export interface AddButtonProps
  extends Omit<ButtonProps, "aria-label" | "children" | "type" | "variant"> {
  ariaLabel: string;
  type?: "button" | "submit" | "reset";
}

export function AddButton({ ariaLabel, type = "button", ...buttonProps }: AddButtonProps) {
  return (
    <Button {...buttonProps} aria-label={ariaLabel} type={type} variant="primary">
      + Hinzufügen
    </Button>
  );
}
