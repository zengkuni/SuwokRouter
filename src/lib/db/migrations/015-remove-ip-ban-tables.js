export default {
  version: 15,
  name: "remove-ip-ban-tables",
  up(db) {
    db.run("DROP TABLE IF EXISTS security_offenses");
    db.run("DROP TABLE IF EXISTS ip_bans");
  },
};
