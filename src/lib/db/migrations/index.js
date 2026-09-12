import m001 from "./001-initial.js";
import m002 from "./002-prune-headroom-pxpipe-settings.js";
import m004 from "./004-request-details-trace-id.js";
import m005 from "./005-request-details-payload-capture.js";
import m007 from "./007-headroom-readd-settings.js";
import m008 from "./008-account-model-locks.js";
import m009 from "./009-warp-pool-lifecycle.js";
import m010 from "./010-api-key-file-permissions.js";
import m011 from "./011-remove-upstream-user-agent-profile.js";
import m012 from "./012-remove-headroom-settings.js";
import m013 from "./013-default-fill-first-routing.js";
import m014 from "./014-normalize-fill-first-routing.js";
import m015 from "./015-remove-ip-ban-tables.js";

export const MIGRATIONS = [m001, m002, m004, m005, m007, m008, m009, m010, m011, m012, m013, m014, m015].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
