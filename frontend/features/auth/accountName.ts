import { getAuth } from "@react-native-firebase/auth";

import { readAppleName } from "./appleName";

export interface AccountName {
  givenName: string;
  familyName: string;
}

/**
 * The user's name as their sign-in provider gave it, so we never ask for it again
 * (App Review Guideline 4). Apple's name is persisted at sign-in because Apple only
 * sends it once; Google's arrives as the Firebase `displayName`. Null when neither
 * exists (e.g. an Apple user who chose to hide their name). Never throws.
 */
export async function readAccountName(): Promise<AccountName | null> {
  const apple = await readAppleName();
  if (apple?.givenName || apple?.familyName) return apple;

  const [givenName = "", ...rest] = (getAuth().currentUser?.displayName ?? "")
    .trim()
    .split(/\s+/);
  const familyName = rest.join(" ");
  if (!givenName && !familyName) return null;
  return { givenName, familyName };
}
