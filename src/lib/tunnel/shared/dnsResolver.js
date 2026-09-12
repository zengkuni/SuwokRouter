import dns from "dns";

const resolver = new dns.promises.Resolver();
resolver.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);

export async function resolveDns(hostname, timeoutMs) {
  const tryResolver = (resolve) => {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("dns timeout")), timeoutMs);
    });
    return Promise.race([resolve(), timeout]).then(() => true).catch(() => false);
  };

  if (await tryResolver(() => resolver.resolve4(hostname))) return true;
  return tryResolver(() => dns.promises.resolve4(hostname));
}
