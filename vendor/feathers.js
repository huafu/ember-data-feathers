/**
 * Created by huafu on 2/14/17.
 */
(function () {
  /* globals define, feathers, io */

  function generateModule(name, values) {
    define(name, [], function () {
      'use strict';

      return values;
    });
  }

  generateModule('feathers', { 'default': feathers, io: io });
})();
