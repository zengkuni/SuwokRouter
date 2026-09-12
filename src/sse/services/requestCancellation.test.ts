import { describe, expect, test } from "bun:test";
import { isCallerCancellation } from "./requestCancellation.js";

describe("caller cancellation classification", () => {
  test("treats an aborted request signal as caller cancellation", () => {
    const controller = new AbortController();
    controller.abort();

    expect(isCallerCancellation({ requestSignal: controller.signal, status: 500 })).toBe(true);
  });

  test("treats HTTP 499 as caller cancellation", () => {
    expect(isCallerCancellation({ status: 499 })).toBe(true);
  });

  test("does not classify provider failures as caller cancellation", () => {
    expect(isCallerCancellation({ status: 429 })).toBe(false);
    expect(isCallerCancellation({ status: 500 })).toBe(false);
  });
});
