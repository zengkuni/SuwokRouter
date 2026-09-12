import net from "net";

const INTERNET_CHECK = {
  host: "1.1.1.1",
  port: 443,
  timeoutMs: 3000,
};

function closeSocket(socket) {
  try { socket.destroy(); } catch {}
}

export function checkInternet() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      closeSocket(socket);
      resolve(ok);
    };
    socket.setTimeout(INTERNET_CHECK.timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    try { socket.connect(INTERNET_CHECK.port, INTERNET_CHECK.host); }
    catch { finish(false); }
  });
}
