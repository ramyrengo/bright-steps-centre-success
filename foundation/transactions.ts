import type { Transaction } from "encore.dev/storage/sqldb";
import { centreSuccessDB } from "./db";

function isRetryableTransactionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /40001|40P01|serialization|deadlock/i.test(message);
}

/** Runs one bounded serializable mutation with rollback and conflict retry. */
export async function inSerializableTransaction<T>(
  operation: (transaction: Transaction) => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const transaction = await centreSuccessDB.begin();
    try {
      await transaction.exec`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
      const result = await operation(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      lastError = error;
      if (attempt === attempts || !isRetryableTransactionError(error)) throw error;
    }
  }
  throw lastError;
}
