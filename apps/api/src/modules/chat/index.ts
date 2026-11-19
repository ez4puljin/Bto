// Public API of the chat module (docs/modules/chat.md, ADR-0224): only its HTTP module, which the
// api's AppModule loads. No other module imports it; named exports only (ESLint G2).
export { ChatHttpModule } from './chat.module';
