-- Hand-written (ADR-0170 #10): these logs only grow. A past month's orderer rests on the first alone,
-- so role app cannot rewrite them.
REVOKE UPDATE, DELETE, TRUNCATE ON "supplier_orderer_history", "ebarimt_check_history" FROM app;
