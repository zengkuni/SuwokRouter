import { buildModelsList } from "../src/routes/api/v1/models/route.js";
console.log(JSON.stringify(await buildModelsList(["llm"]), null, 2));
