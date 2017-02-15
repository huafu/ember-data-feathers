import Ember from "ember";
import { io, default as feathers } from "feathers";
import FeathersSocketAdapter from "../adapters/feathers-socket";

const { computed, inject, run, String:{ pluralize, singularize }, RSVP } = Ember;

/**
 * @class FeathersService
 */
export default Ember.Service.extend({
  store: inject.service(),

  socketUrl: computed.reads('config.socketUrl'),

  socket: computed('socketUrl', {
    get() {
      return io(this.get('socketUrl'));
    },
    set(key, value) {
      // ensure the old socket if any is closed
      const old = this.cacheFor(key);
      old && old.close();
      return value;
    }
  }),

  client: computed('socket', {
    get() {
      return feathers()
        .configure(feathers.socketio(this.get('socket')))
        .configure(feathers.hooks())
        // Use localStorage to store our login token
        .configure(feathers.authentication({
          storage: window.localStorage
        }));
    },
    set(key, value) {
      // TODO: teardown old object
      return value;
    },
  }),

  services: computed({
    get() {
      const svc = this;
      return Ember.CoreObject.extend({
        unknownProperty(key) {
          if (!svc.isDestroyed && !svc.isDestroying) {
            const service = svc.setupService(key);
            this.set(key, service);
            return service;
          }
        },
      }).create();
    }
  }).readOnly(),


  coupledModels: computed({
    get() {
      return Object.create(null);
    }
  }).readOnly(),

  destroy() {
    const socket = this.cacheFor('socket');
    if (socket) {
      socket.close();
    }
    this._super(...arguments);
  },

  setupService(name, { modelName }) {
    const service = this.get('client').service(name);
    const coupledModels = this.get('coupledModels');
    if (coupledModels[name]) {
      return service;
    }
    if (modelName === undefined) {
      const singularized = singularize(name);
      try {
        const store = this.get('store');
        // next instruction will fail if no such model
        store.modelFor(singularized);
        modelName = store.adapterFor(singularized) instanceof FeathersSocketAdapter ? singularized : null;
      } catch (e) {
        modelName = null;
      }
    }
    if (modelName) {
      const config = coupledModels[modelName] = {
        service,
        events: {
          created: run.bind(this, 'handleServiceEvent', name, 'created', modelName),
          updated: run.bind(this, 'handleServiceEvent', name, 'updated', modelName),
          patched: run.bind(this, 'handleServiceEvent', name, 'patched', modelName),
          removed: run.bind(this, 'handleServiceEvent', name, 'removed', modelName),
        }
      };
      Object.keys(config.events).forEach((eventType) => {
        service.on(eventType, config.events[eventType]);
      });
      this.debug && this.debug(`listening for Feathers service ${name} bound to model ${modelName}`);
    }
    return service;
  },

  /**
   * Make a service call
   * @param {String} service
   * @param {String} method
   * @param {*} args
   * @returns {RSVP.Promise}
   */
  serviceCall(service, method, ...args) {
    return new RSVP.Promise((resolve, reject) => {
      this.get(`services.${service}`)[method](...args)
        .then(run.bind(null, resolve), run.bind(null, reject));
    });
  },

  handleServiceEvent(serviceName, eventType, modelName, message) {
    this.debug && this.debug(
      `[${serviceName}] received event ${eventType}${modelName ? ' (mapped to ' + modelName + ' model)' : ''}: %O`,
      message
    );
    if (modelName) {
      const adapter = this.get('store').adapterFor(modelName);
      adapter instanceof FeathersSocketAdapter && adapter.handleServiceEvent(eventType, modelName, message);
    }
  },

  serviceForModel(modelName) {
    const coupledModels = this.get('coupledModels');
    if (!coupledModels[modelName]) {
      this.setupService(pluralize(modelName), { modelName });
    }
    return coupledModels[modelName].service;
  }
});
