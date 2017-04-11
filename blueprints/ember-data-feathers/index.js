/* eslint-env node */
module.exports = {
  normalizeEntityName() {
  },

  afterInstall() {
    return this.addBowerPackagesToProject([
      { name: 'feathers-client', target: '2.0.0-pre.2' },
      { name: 'socket.io-client', target: '1.7.2' },
    ]);
  }
};
