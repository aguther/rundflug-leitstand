import { useEffect } from "react";
import {
  applyInstallMetadata,
  type PublicStatusTarget,
  publicStatusInstallMetadata,
} from "../../app/install-metadata";

export type { PublicStatusTarget } from "../../app/install-metadata";

export function usePublicStatusManifest(
  target: PublicStatusTarget,
  code: string,
  bookingGroupLabel?: string,
): void {
  useEffect(() => {
    applyInstallMetadata(publicStatusInstallMetadata(target, code, bookingGroupLabel));
  }, [bookingGroupLabel, code, target]);
}
