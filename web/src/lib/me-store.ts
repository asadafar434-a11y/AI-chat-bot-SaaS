import { STORES, transaction } from "@/lib/db";
import { EMPTY_PROFILE, type Profile } from "@/lib/profile";
import { SAMPLES_LIMIT } from "@/lib/tp";

// Образец — настоящий документ участника, который он уже подавал: по нему ИИ пишет новые.
export type Sample = { id: string; name: string; text: string; addedAt: string };

const PROFILE_KEY = "profile";

export async function getProfile(): Promise<Profile> {
  const stored = await transaction<Partial<Profile> | undefined>([STORES.settings], "readonly", (tx) =>
    tx.objectStore(STORES.settings).get(PROFILE_KEY)
  );
  return { ...EMPTY_PROFILE, ...stored };
}

export const saveProfile = (profile: Profile) =>
  transaction<void>([STORES.settings], "readwrite", (tx) => {
    tx.objectStore(STORES.settings).put(profile, PROFILE_KEY);
  });

export const listSamples = async () =>
  (await transaction<Sample[]>([STORES.samples], "readonly", (tx) => tx.objectStore(STORES.samples).getAll())).sort(
    (a, b) => b.addedAt.localeCompare(a.addedAt)
  );

export const addSamples = (samples: Sample[]) =>
  transaction<void>([STORES.samples], "readwrite", (tx) => {
    for (const sample of samples) tx.objectStore(STORES.samples).put(sample);
  });

export const deleteSample = (id: string) =>
  transaction<void>([STORES.samples], "readwrite", (tx) => {
    tx.objectStore(STORES.samples).delete(id);
  });

// В запрос уходят самые свежие образцы, пока хватает места.
export function samplesForRequest(samples: Sample[]): Sample[] {
  const picked: Sample[] = [];
  let total = 0;
  for (const sample of samples) {
    if (total + sample.text.length > SAMPLES_LIMIT) continue;
    picked.push(sample);
    total += sample.text.length;
  }
  return picked;
}
