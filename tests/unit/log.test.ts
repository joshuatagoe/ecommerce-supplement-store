// Server errors as log lines (ARCHITECTURE.md §11, L3): one JSON line per error
// with the request's ID, and nothing private: no pay-link token, no query string,
// no request headers, and no database error text, which can quote the data.
import { afterEach, describe, expect, it, vi } from "vitest";
import { log, logRequestError } from "@/server/log";

const context = { routerKind: "App Router", routePath: "/sales", routeType: "render" } as const;

afterEach(() => vi.restoreAllMocks());

describe("logRequestError", () => {
  it("writes one line with the request ID, the route, and the error's name, message and digest", () => {
    const error = vi.spyOn(log, "error");
    const thrown = Object.assign(new Error("Sales couldn't load"), { digest: "123456" });
    logRequestError(thrown, { path: "/sales?status=paid", method: "GET", headers: { "x-request-id": "req-1", cookie: "session=abc" } }, context);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toEqual({
      event: "request_error",
      requestId: "req-1",
      method: "GET",
      path: "/sales",
      routePath: "/sales",
      routeType: "render",
      digest: "123456",
      error: { name: "Error", message: "Sales couldn't load" },
    });
  });

  it("never writes a pay-link token, and keeps only a database error's code", () => {
    const error = vi.spyOn(log, "error");
    const database = Object.assign(new Error('invalid input syntax for type uuid: "Sam Okafor"'), { name: "DatabaseError", code: "22P02" });
    logRequestError(database, { path: "/pay/K7Q2-M9XD.secret-token-part", method: "POST", headers: {} }, { ...context, routePath: "/pay/[token]", routeType: "action" });
    const line = JSON.stringify(error.mock.calls[0][0]);
    expect(line).not.toContain("secret-token-part");
    expect(line).not.toContain("Sam Okafor");
    expect(error.mock.calls[0][0]).toMatchObject({ path: "/pay/[token]", requestId: null, error: { name: "DatabaseError", code: "22P02" } });
  });

  it("copes with something thrown that isn't an Error", () => {
    const error = vi.spyOn(log, "error");
    logRequestError("a string", { path: "/", method: "GET", headers: { "x-request-id": ["req-2", "req-3"] } }, context);
    expect(error.mock.calls[0][0]).toMatchObject({ requestId: "req-2", error: { name: "unknown" } });
  });
});
