const COLORS = {
  reset: "\x1b[0m",
  success: "\x1b[32m",
  error: "\x1b[31m",
  warning: "\x1b[33m",
  info: "\x1b[36m"
};

function showStatus(message, type = "info") {
  const labels = {
    success: "OK",
    error: "ERROR",
    warning: "WARN",
    info: "INFO"
  };

  const color = COLORS[type] || COLORS.info;
  const label = labels[type] || labels.info;

  console.log(`${color}${label}${COLORS.reset}  ${message}`);
}

const PROGRESS_WIDTH = 40;

function formatProgressBar(percent, width = PROGRESS_WIDTH) {
  const safeWidth = Math.max(1, Math.floor(Number(width) || PROGRESS_WIDTH));
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const filled = Math.round((value / 100) * safeWidth);
  return `${"▰".repeat(filled)}${"▱".repeat(safeWidth - filled)} ${String(value).padStart(3, " ")}%`;
}

function formatActivityBar(step, width = PROGRESS_WIDTH, pulseWidth = 8) {
  const safeWidth = Math.max(1, Math.floor(Number(width) || PROGRESS_WIDTH));
  const safePulse = Math.max(1, Math.min(safeWidth, Math.floor(Number(pulseWidth) || 8)));
  const cycleWidth = Math.max(1, safeWidth - safePulse + 1);
  const start = ((Math.floor(Number(step) || 0) % cycleWidth) + cycleWidth) % cycleWidth;
  const track = Array.from({ length: safeWidth }, () => "▱");
  for (let index = start; index < start + safePulse; index += 1) track[index] = "▰";
  return `${track.join("")} …`;
}

function createProgress(label, { stream = process.stdout, intervalMs = 80, indeterminate = false } = {}) {
  const interactive = Boolean(stream?.isTTY);
  let current = 10;
  let target = 92;
  let message = String(label || "Loading");
  let timer = null;
  let active = false;
  let rendered = false;
  let activityStep = 0;

  const render = () => {
    if (!interactive || !active) return;
    const moveToPreviousFrame = rendered ? "\x1b[1A\r\x1b[2K" : "\r\x1b[2K";
    const bar = indeterminate ? formatActivityBar(activityStep) : formatProgressBar(current);
    stream.write(`${moveToPreviousFrame}${message}\n\r\x1b[2K${bar}`);
    rendered = true;
  };

  const stopTimer = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  return {
    start() {
      if (!interactive || active) return;
      active = true;
      render();
      timer = setInterval(() => {
        if (indeterminate) {
          activityStep += 1;
          render();
          return;
        }
        if (current >= target) return;
        current = Math.min(target, current + 2);
        render();
      }, intervalMs);
      timer.unref?.();
    },
    update(percent, nextMessage = message) {
      target = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
      current = Math.min(current, target);
      message = String(nextMessage || message);
      render();
    },
    finish(doneMessage = `${label} complete`) {
      if (!interactive) return;
      current = 100;
      target = 100;
      message = String(doneMessage || label || "Complete");
      render();
      stopTimer();
      active = false;
      stream.write("\n");
    },
    fail() {
      if (!interactive) return;
      stopTimer();
      active = false;
      if (rendered) stream.write("\x1b[1A\r\x1b[2K\n\r\x1b[2K\n");
      else stream.write("\r\x1b[2K\n");
      rendered = false;
    },
  };
}

async function withProgress(label, task, options = {}) {
  const progress = createProgress(label, options);
  progress.start();
  try {
    const result = await task(progress);
    progress.finish(options.doneMessage || `${label} complete`);
    return result;
  } catch (error) {
    progress.fail();
    throw error;
  }
}

module.exports = { createProgress, formatActivityBar, formatProgressBar, showStatus, withProgress };
