/* eslint-env node */
const RSVP = require('rsvp');

module.exports = {
  normalizeEntityName() {
  },

  afterInstall() {
    return RSVP.all([
      this.addPackageToProject('feathers-client'),
      this.addPackageToProject('socket.io-client'),
    ]);
  }
};
