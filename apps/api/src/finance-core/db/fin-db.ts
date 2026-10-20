import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { AnyTx } from '../../common/db/any-tx';
import {
  finAccounts,
  finAuditLog,
  finBranches,
  finBranchRefs,
  finCompanies,
  finCompanyTaxRegistrations,
  finFiscalPeriods,
  finJournalEntries,
  finJournalLines,
  finMoneyAccounts,
  finParties,
  finPartyCompanies,
  finPartyRefs,
  finPostingKeys,
  finPostingRules,
  finSourceGrants,
  finSourceSystems,
  finTenants,
} from '../schema';

/**
 * The core's own Drizzle database over the process's shared pool, with the core's schema only (the
 * `createEdgeDb` pattern, ADR-0069 #7). The tables are listed by name: ESLint G2 refuses namespace
 * imports.
 */
const schema = {
  finAccounts,
  finAuditLog,
  finBranches,
  finBranchRefs,
  finCompanies,
  finCompanyTaxRegistrations,
  finFiscalPeriods,
  finJournalEntries,
  finJournalLines,
  finMoneyAccounts,
  finParties,
  finPartyCompanies,
  finPartyRefs,
  finPostingKeys,
  finPostingRules,
  finSourceGrants,
  finSourceSystems,
  finTenants,
};

export type FinSchema = typeof schema;
export type FinDb = NodePgDatabase<FinSchema> & { $client: Pool };
/** Any node-postgres transaction: the core's own, or a source system's (Bto's `Tx`). */
export type FinTx = AnyTx;

export const FIN_DB = Symbol('FIN_DB');

export function createFinDb(pool: Pool): FinDb {
  return drizzle({ client: pool, schema });
}
