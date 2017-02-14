/* eslint-env node */
'use strict';

module.exports = {
  name: 'ember-data-feathers',

  included(app) {
    let feathersPath = require('path').join('lib', 'client.js');
    let ioPath = require('path').join('lib', 'index.js');
    feathersPath = require.resolve('feathers-client').replace(feathersPath, '') + 'dist/feathers.js';
    ioPath = require.resolve('socket.io-client').replace(ioPath, '') + 'dist/socket.io.js';
    app.import(feathersPath);
    app.import(ioPath);
    app.import('vendor/feathers.js', {
      exports: {
        feathers: ['default', 'io']
      }
    });
  }
};
