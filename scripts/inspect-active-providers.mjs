import { getActiveProviderRows } from "../src/lib/localDb.js";
console.log(JSON.stringify(await getActiveProviderRows(), null, 2));
