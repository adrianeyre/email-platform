import {
  registerAjvFormats,
  TypeBoxValidatorCompiler,
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../lib/database.js";
import type { Server } from "../lib/http.js";
import { maxLogPage, registerLogRoutes } from "./message-routes.js";

/*
 * No Postgres listens on port 1, so a request that reaches the database fails there (500) and one the schema refuses
 * never gets that far (400 from Fastify here; the app's error handler answers it as its 422 validation_failed).
 */
const database = openDatabase("postgres://probe@127.0.0.1:1/none");

let server: Server;

beforeAll(async () => {
  registerAjvFormats();
  server = Fastify().withTypeProvider<TypeBoxTypeProvider>();
  server.setValidatorCompiler(TypeBoxValidatorCompiler);
  server.decorateRequest("user", null);
  server.decorateRequest("apiKey", null);
  registerLogRoutes(server, {
    database,
    jobs: { enqueue: () => Promise.reject(new Error("no queue")) },
  });
  await server.ready();
});

afterAll(async () => {
  await server.close();
  await database.$client.end();
});

const listStatus = async (query: Record<string, string>) =>
  (await server.inject({ method: "GET", url: "/messages", query })).statusCode;

describe("the Logs list's filters (pen test D1, #157)", () => {
  it("refuses a page past the last one, or the year 0000, in the schema before the database", async () => {
    const refused: Record<string, string>[] = [
      { page: "100000000000000000000" },
      { page: String(maxLogPage + 1) },
      { page: "0" },
      { after: "0000-01-01T00:00:00Z" },
      { before: "0000-01-01T00:00:00Z" },
      { after: "0999-12-31T23:59:59Z" },
      { after: "3000-01-01T00:00:00Z" },
      { after: "2026-02-30T00:00:00Z" },
    ];
    for (const query of refused) {
      expect(await listStatus(query), JSON.stringify(query)).toBe(400);
    }
  });

  it("lets the last page and dates from 1000 to 2999 through to the database", async () => {
    const allowed: Record<string, string>[] = [
      { page: String(maxLogPage) },
      { after: "1000-01-01T00:00:00+14:00" },
      { before: "2999-12-31T23:59:59-12:00" },
      { after: "2026-11-21T10:00:00Z" },
    ];
    for (const query of allowed) {
      expect(await listStatus(query), JSON.stringify(query)).toBe(500);
    }
  });

  it("keeps every offset an exact integer inside Postgres's bigint", () => {
    expect(Number.isSafeInteger((maxLogPage - 1) * 50)).toBe(true);
  });
});
