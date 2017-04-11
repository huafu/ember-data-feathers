/* eslint-env node */
'use strict';
const sysPath = require('path');
const packageJson = require(sysPath.join(__dirname, 'package.json'));

module.exports = {
  name: 'ember-data-feathers',

  included(app) {
    this._super.included.apply(this, arguments);

    // see: https://github.com/ember-cli/ember-cli/issues/3718
    if (typeof app.import !== 'function' && app.app) {
      app = app.app;
    }

    this.app = app;

    app.import(app.bowerDirectory + '/dist/feathers.js');
    app.import(app.bowerDirectory + '/socket.io-client/dist/socket.io.js');
    app.import('vendor/feathers.js', {
      exports: {
        feathers: ['default', 'io']
      }
    });
  },

  isDevelopingAddon(){
    // return true if the package doesn't have `_id`
    // npm adds `_id` into the package.json when it is installed
    return !packageJson._id;
  },
};
