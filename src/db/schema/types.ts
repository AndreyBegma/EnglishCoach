import { customType } from "drizzle-orm/pg-core";

/** Postgres `bytea` as a Node Buffer (drizzle-orm has no built-in bytea column yet). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
