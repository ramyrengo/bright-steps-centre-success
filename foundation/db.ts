import { SQLDatabase } from "encore.dev/storage/sqldb";

export const centreSuccessDB = new SQLDatabase("centre_success", {
  migrations: "./migrations",
});
