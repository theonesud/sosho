import { describe, expect, it } from "vitest";
import { type FetchState, fetchReducer, idleState } from "./use-fetch";

describe("fetchReducer", () => {
  it("moves through loading, success, refetch, and failure", () => {
    let s: FetchState<number> = idleState<number>();
    s = fetchReducer(s, { type: "start", keepData: false });
    expect(s).toEqual({ status: "loading", data: null, error: null });
    s = fetchReducer(s, { type: "success", data: 7 });
    expect(s.data).toBe(7);
    s = fetchReducer(s, { type: "start", keepData: true });
    expect(s).toEqual({ status: "loading", data: 7, error: null });
    const error = new Error("boom");
    s = fetchReducer(s, { type: "failure", error });
    expect(s).toEqual({ status: "error", data: 7, error });
    s = fetchReducer(s, { type: "start", keepData: false });
    expect(s.data).toBeNull();
    expect(fetchReducer(s, { type: "reset" })).toEqual(idleState());
  });
});
