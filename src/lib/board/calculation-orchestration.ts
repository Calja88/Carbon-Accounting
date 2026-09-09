/** A pre-authored transaction contract; BD03 binds it to the approved Prisma schema. */
export interface CalculationRequest { organisationId: string; entryId: string; inputRevision: string; idempotencyKey: string; inputDigest: string }
export interface StoredRun<Result> { id: string; inputDigest: string; result: Result }
export interface CalculationTransaction<Result, Inputs> {
  /** Lock the owning entry/period BEFORE policy/read checks. Advisory key alone doesn't guard report issue. */
  lockEntryAndPeriod(request: CalculationRequest): Promise<void>;
  /** Reads current membership, scope, locked-period rule and input revision within transaction. */
  authorizeAndLoad(request: CalculationRequest): Promise<Inputs>;
  findRun(request: CalculationRequest): Promise<StoredRun<Result> | null>;
  /** One transaction creates run + ALL basis rows + effective pointer + audit/outbox. */
  saveRun(request: CalculationRequest, result: Result): Promise<StoredRun<Result>>;
}
export interface CalculationPorts<Result, Inputs> {
  transaction<T>(operation: (tx: CalculationTransaction<Result, Inputs>) => Promise<T>): Promise<T>;
  /** Existing deterministic engine; no fetch, database access or factor substitution. */
  calculate(inputs: Inputs): Result;
}
export async function executeCalculation<Result, Inputs>(ports: CalculationPorts<Result, Inputs>, request: CalculationRequest): Promise<StoredRun<Result>> {
  if (!request.inputDigest || !request.idempotencyKey || !request.inputRevision) throw new Error("Missing calculation identity");
  return ports.transaction(async tx => {
    await tx.lockEntryAndPeriod(request);
    const inputs = await tx.authorizeAndLoad(request);
    const existing = await tx.findRun(request);
    if (existing) {
      if (existing.inputDigest !== request.inputDigest) throw new Error("Idempotency key reused with different inputs");
      return existing;
    }
    return tx.saveRun(request, ports.calculate(inputs));
  });
}
