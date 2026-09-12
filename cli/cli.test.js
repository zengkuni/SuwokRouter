const { commandFor, isDefaultMenuInvocation, parseArgs, usage } = require("./cli");

describe("swayrouter CLI arguments", () => {
  test("bare invocation resolves to the default start command", () => {
    const options = parseArgs([]);
    expect(options.foreground).toBe(false);
    expect(options.background).toBe(false);
    expect(options.open).toBe(false);
    expect(options.status).toBe(false);
    expect(options.command).toBe(null);
    expect(commandFor(options)).toBe("start");
    expect(isDefaultMenuInvocation(options)).toBe(true);
    expect(isDefaultMenuInvocation(parseArgs(["start"]))).toBe(false);
    expect(isDefaultMenuInvocation(parseArgs(["start", "-b"]))).toBe(false);
  });

  test("parses explicit lifecycle commands", () => {
    expect(parseArgs(["status"]).status).toBe(true);
    expect(parseArgs(["stop"]).stop).toBe(true);
    expect(parseArgs(["restart"]).command).toBe("restart");
  });

  test("rejects unknown commands", () => {
    expect(() => parseArgs(["install"])).toThrow("unknown command: install");
  });

  test("help text is available for local checkout usage", () => {
    expect(usage()).toBeUndefined();
  });

  test("parses explicit runtime options", () => {
    expect(parseArgs(["--foreground", "--port", "8080", "--host", "127.0.0.1", "--no-browser"])).toMatchObject({
      foreground: true,
      port: 8080,
      host: "127.0.0.1",
      noBrowser: true,
    });
  });

  test("supports the short background start command", () => {
    expect(parseArgs(["start", "-b", "-n"])).toMatchObject({
      command: "start",
      background: true,
      noBrowser: true,
    });
  });

  test("keeps tray mode distinct from a plain background start", () => {
    expect(parseArgs(["--tray", "--skip-update"])).toMatchObject({
      background: true,
      tray: true,
      skipUpdate: true,
    });
  });

  test("rejects invalid ports and unknown flags", () => {
    expect(() => parseArgs(["--port", "0"])).toThrow("port must be an integer");
    expect(() => parseArgs(["--unknown"])).toThrow("unknown option");
  });
});
