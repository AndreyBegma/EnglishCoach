import { and, asc, eq } from "drizzle-orm";
import { decrypt, encrypt, maskSecret } from "../../crypto/secrets";
import type { Db } from "../client";
import { type ProviderConfig, providerConfigs } from "../schema";

/** What a user can choose. Bring-your-own-key providers need the key; the others carry none. */
export type ProviderConfigInput =
  | { kind: "anthropic"; apiKey: string; model?: string | null }
  | { kind: "openai"; apiKey: string; model?: string | null; baseUrl?: string | null }
  | { kind: "server" | "claude-code" | "runner"; model?: string | null };

export async function getActiveProviderConfig(
  db: Db,
  userId: number,
): Promise<ProviderConfig | undefined> {
  const [config] = await db
    .select()
    .from(providerConfigs)
    .where(and(eq(providerConfigs.userId, userId), eq(providerConfigs.isActive, true)));
  return config;
}

/**
 * Makes `input` the user's active provider: the previous active one is deactivated, an older
 * config of the same kind is replaced, and the API key (if any) is stored encrypted.
 */
export async function activateProviderConfig(
  db: Db,
  userId: number,
  input: ProviderConfigInput,
  masterKey: Buffer,
): Promise<ProviderConfig> {
  const secret = "apiKey" in input ? encrypt(input.apiKey, masterKey) : undefined;

  return db.transaction(async (tx) => {
    await tx
      .update(providerConfigs)
      .set({ isActive: false })
      .where(and(eq(providerConfigs.userId, userId), eq(providerConfigs.isActive, true)));
    await tx
      .delete(providerConfigs)
      .where(and(eq(providerConfigs.userId, userId), eq(providerConfigs.kind, input.kind)));

    const [config] = await tx
      .insert(providerConfigs)
      .values({
        userId,
        kind: input.kind,
        model: input.model ?? null,
        baseUrl: "baseUrl" in input ? (input.baseUrl ?? null) : null,
        encryptedApiKey: secret?.ciphertext ?? null,
        keyIv: secret?.iv ?? null,
        keyTag: secret?.tag ?? null,
        isActive: true,
      })
      .returning();
    if (!config) throw new Error("insert of provider_configs returned no row");
    return config;
  });
}

/** Every provider config the user has, active or saved, oldest first. */
export async function listProviderConfigs(db: Db, userId: number): Promise<ProviderConfig[]> {
  return db
    .select()
    .from(providerConfigs)
    .where(eq(providerConfigs.userId, userId))
    .orderBy(asc(providerConfigs.id));
}

/**
 * Makes a saved config the active one again (switching back to a key entered earlier). Returns
 * undefined, and changes nothing, when the config is not the user's.
 */
export async function reactivateProviderConfig(
  db: Db,
  userId: number,
  configId: number,
): Promise<ProviderConfig | undefined> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: providerConfigs.id })
      .from(providerConfigs)
      .where(and(eq(providerConfigs.id, configId), eq(providerConfigs.userId, userId)));
    if (!owned) return undefined;

    await tx
      .update(providerConfigs)
      .set({ isActive: false })
      .where(and(eq(providerConfigs.userId, userId), eq(providerConfigs.isActive, true)));
    const [config] = await tx
      .update(providerConfigs)
      .set({ isActive: true })
      .where(eq(providerConfigs.id, configId))
      .returning();
    return config;
  });
}

/** Sets the model of the active config; `null` goes back to the default. Undefined if none is active. */
export async function setActiveProviderModel(
  db: Db,
  userId: number,
  model: string | null,
): Promise<ProviderConfig | undefined> {
  const [config] = await db
    .update(providerConfigs)
    .set({ model })
    .where(and(eq(providerConfigs.userId, userId), eq(providerConfigs.isActive, true)))
    .returning();
  return config;
}

/** Decrypts the config's API key. Only provider construction may call this. */
export function decryptProviderKey(config: ProviderConfig, masterKey: Buffer): string | undefined {
  if (!config.encryptedApiKey || !config.keyIv || !config.keyTag) return undefined;
  return decrypt(
    { ciphertext: config.encryptedApiKey, iv: config.keyIv, tag: config.keyTag },
    masterKey,
  );
}

/** The masked form of the stored key (`sk-…a1b2`) — the only form the bot may show. */
export function providerKeyHint(config: ProviderConfig, masterKey: Buffer): string | undefined {
  const key = decryptProviderKey(config, masterKey);
  return key === undefined ? undefined : maskSecret(key);
}
