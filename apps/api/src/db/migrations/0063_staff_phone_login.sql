-- ADR-0128 #3: the registered phone is the staff sign-in identifier, one account per phone;
-- records without a phone (registered before ADR-0128) keep signing in by login name.
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone") WHERE "users"."phone" IS NOT NULL;