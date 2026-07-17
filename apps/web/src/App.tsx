import { LegacyApp } from "./LegacyApp";

/**
 * Root composition for the V1.2 migration.
 *
 * Feature routes are moved out of LegacyApp one vertical slice at a time. Keeping this root free
 * from workflow state makes route guards, providers and code splitting independently testable.
 */
export function App() {
  return <LegacyApp />;
}
