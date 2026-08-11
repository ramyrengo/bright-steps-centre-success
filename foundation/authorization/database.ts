import type { Transaction } from "encore.dev/storage/sqldb";
import { centreSuccessDB } from "../db";

export type AuthorisationQueryExecutor = Pick<
  Transaction,
  "queryAll" | "queryRow"
>;

/**
 * Reads all facts for one authorization decision from one PostgreSQL snapshot.
 */
export async function withAuthorisationSnapshot<T>(
  read: (executor: AuthorisationQueryExecutor) => Promise<T>,
): Promise<T> {
  const transaction = await centreSuccessDB.begin();

  try {
    await transaction.exec`
      SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY
    `;
    const result = await read(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
