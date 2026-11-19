// Public API of the stock-problems module (docs/modules/stock-problems.md, ADR-0230). Nobody
// imports it but the composition roots; named exports only (ESLint G2 rejects `export *`).
export {
  StockProblemsHttpModule,
  StockProblemsModule,
  StockProblemsWorkerModule,
} from './stock-problems.module';
export { StockProblemSheetsService } from './services/stock-problem-sheets.service';
export { StockProblemsService } from './services/stock-problems.service';
