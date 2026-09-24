export default {
  version: 15,
  name: "remove-ip-ban-tables",
  async up(db) {
    await db.run("DROP TABLE IF EXISTS security_offenses");
    await db.run("DROP TABLE IF EXISTS ip_bans");
  },
};
