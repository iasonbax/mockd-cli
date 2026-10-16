import { describe, expect, it } from "vitest";
import { ApiError } from "../../core/errors.js";
import { explained, refusalOf } from "../try-refusals.js";

const inUse = (reopens_at) =>
  new ApiError(409, { reason: "address_in_use", reopens_at, detail: "A run from this browser is already in progress." });

describe("refusalOf", () => {
  it("says from when the next run can start after the lock", () => {
    const refusal = refusalOf(inUse("2026-09-26T11:58:00Z"), { mockId: "hubspot" });
    expect(refusal.message).toBe(
      "HTTP 409: this machine already had a playground run on hubspot; the next one can start at 2026-09-26T11:58:00Z (address_in_use)"
    );
  });

  it("says that the other run is still going and that its end starts a 24-hour lock", () => {
    const refusal = refusalOf(inUse(null), { mockId: "stripe" });
    expect(refusal.message).toBe(
      "HTTP 409: this machine already has a playground run on stripe that is still going; the next one can start 24 hours after it ends (address_in_use)"
    );
  });

  // Regression: both sentences once promised a run right after the other one ends. An ended
  // run keeps the machine and the address locked for 24 hours, so an agent that closed the
  // other run and minted again was refused a second time.
  it("never promises a run right when the other one ends", () => {
    const sentence = refusalOf(inUse(null), { mockId: "stripe" }).message;
    expect(sentence).not.toContain("can start after it ends");
    expect(sentence).toContain("can start 24 hours after it ends");
  });

  it("names the mock that is not free and says an account is needed, without a command the CLI cannot offer", () => {
    const error = new ApiError(403, { reason: "mock_not_free", mock: "stripe", detail: "nicht frei" });
    expect(refusalOf(error, { mockId: "stripe" }).message).toBe(
      "HTTP 403: stripe is not free on the playground; only a few mocks are, the others need an account (https://mock-d.com) (mock_not_free)"
    );
    expect(refusalOf(error, { token: "tok-a" }).message).toContain("the mock of this address is not free");
  });

  it("explains a closed address", () => {
    const closed = new ApiError(409, { reason: "address_closed", reopens_at: "2026-09-26T11:58:00Z" });
    expect(refusalOf(closed, { token: "t" }).message).toBe(
      "HTTP 409: this address is closed; its next run can start at 2026-09-26T11:58:00Z (address_closed)"
    );
  });

  // run_active only answered a reset command, which does not exist; no command reaches it.
  it("leaves run_active unnamed", () => {
    expect(refusalOf(new ApiError(409, { reason: "run_active" }), { token: "t" })).toBeNull();
  });

  it("keeps status and detail as data", () => {
    const refusal = refusalOf(inUse(null), { mockId: "hubspot" });
    expect(refusal).toBeInstanceOf(ApiError);
    expect(refusal).toMatchObject({ status: 409, detail: { reason: "address_in_use", reopens_at: null } });
  });

  it("leaves everything it does not know alone", () => {
    expect(refusalOf(new ApiError(404, "not found"), {})).toBeNull();
    expect(refusalOf(new ApiError(409, { reason: "job_not_open" }), {})).toBeNull();
    expect(refusalOf(new ApiError(409, { reason: "toString" }), {})).toBeNull();
    expect(refusalOf(new Error("boom"), {})).toBeNull();
  });
});

describe("explained", () => {
  it("passes the answer through", async () => {
    const execute = explained(async (i) => ({ got: i.mockId }));
    expect(await execute({ mockId: "hubspot" }, {})).toEqual({ got: "hubspot" });
  });

  it("turns a known refusal into its sentence", async () => {
    const execute = explained(async () => {
      throw inUse(null);
    });
    await expect(execute({ mockId: "hubspot" }, {})).rejects.toThrow("still going; the next one can start 24 hours after it ends (address_in_use)");
  });

  it("rethrows every other error unchanged", async () => {
    const boom = new ApiError(500, "kaputt");
    const execute = explained(async () => {
      throw boom;
    });
    await expect(execute({}, {})).rejects.toBe(boom);
  });
});
