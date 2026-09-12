const { formatActivityBar, formatProgressBar, withProgress } = require("./display");

describe("CLI progress display", () => {
  test("renders a fixed-width block progress bar", () => {
    expect(formatProgressBar(10, 10)).toBe("▰▱▱▱▱▱▱▱▱▱  10%");
    expect(formatProgressBar(100, 10)).toBe("▰▰▰▰▰▰▰▰▰▰ 100%");
  });

  test("renders a moving activity segment for indeterminate work", () => {
    expect(formatActivityBar(0, 10, 3)).toBe("▰▰▰▱▱▱▱▱▱▱ …");
    expect(formatActivityBar(7, 10, 3)).toBe("▱▱▱▱▱▱▱▰▰▰ …");
  });

  test("keeps progress silent when no interactive terminal is available", async () => {
    await expect(withProgress("Loading", async (progress) => {
      progress.update(50);
      return "done";
    }, { stream: { isTTY: false } })).resolves.toBe("done");
  });
});
