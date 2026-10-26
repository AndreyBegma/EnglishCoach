import { GrammyError } from "grammy";

function descriptionOf(error: unknown): string | undefined {
  return error instanceof GrammyError ? error.description.toLowerCase() : undefined;
}

/**
 * A failed deleteMessage that cleanup should shrug off: the message is already gone, or too old
 * (Telegram refuses deletion after 48 hours), or otherwise no longer deletable by the bot.
 */
export function isIgnorableDeleteError(error: unknown): boolean {
  const description = descriptionOf(error);
  return (
    description !== undefined &&
    (description.includes("message to delete not found") ||
      description.includes("message can't be deleted"))
  );
}

/** editMessage* with the same content and markup the message already has. */
export function isNotModifiedError(error: unknown): boolean {
  return descriptionOf(error)?.includes("message is not modified") ?? false;
}

/** editMessage* on a message that no longer exists or can no longer be edited. */
export function isMessageGoneError(error: unknown): boolean {
  const description = descriptionOf(error);
  return (
    description !== undefined &&
    (description.includes("message to edit not found") ||
      description.includes("message can't be edited"))
  );
}
