import { getAdapter } from "../src/lib/db/driver.js";
import { getSettings } from "../src/lib/localDb.js";
const a = await getAdapter();
console.log("adapter:", a.driver);
const s = await getSettings();
console.log("settings:", JSON.stringify(s).slice(0, 200));
