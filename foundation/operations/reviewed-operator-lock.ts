/**
 * The advisory lock the two reviewed operator tools share — ADR-0021 D5.
 *
 * The organisation reference load and the D5 first-administrator ceremony both
 * took `pg_advisory_xact_lock(1112691796, …)` under different low keys, so each
 * excluded a second copy of ITSELF and neither excluded the other. Nothing was
 * unsafe: the load reads the membership count the ceremony writes, so under
 * SERIALIZABLE the SSI machinery aborts one of them. But it aborts as a
 * serialization failure, which tells an operator running a reviewed,
 * human-approved ceremony nothing about what actually happened, on a ceremony
 * that then refuses to run a second time.
 *
 * They now take the same lock. The second tool waits for the first and proceeds
 * against the state the first actually left behind, which is the only ordering
 * that means anything: in production these two are a sequence — the load
 * creates the organisation, the ceremony creates the first administrator inside
 * it — and a sequence should not be able to interleave with itself.
 *
 * The low key is the load's original rather than a fresh one, so that exactly
 * one of the two tools changes behaviour.
 *
 * `local-first-administrator-bootstrap.ts` keeps its own low key and is
 * deliberately not touched. It runs only in local development, which the D5
 * ceremony can never reach, so those two cannot collide however long either
 * holds a transaction open.
 */
export const REVIEWED_OPERATOR_LOCK_KEY_HIGH = 1112691796;
export const REVIEWED_OPERATOR_LOCK_KEY_LOW = 20260814;
