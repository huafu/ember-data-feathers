import Ember from "ember";
import { io, default as feathers } from "feathers";
import FeathersSocketAdapter from "../adapters/feathers-socket";

const { computed, inject, run, String:{ pluralize, singularize }, RSVP } = Ember;

export function modelNameToServiceName(modelName) {
  return pluralize(modelName);
}
export function serviceNameToModelName(modelName) {
  return singularize(modelName);
}

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

  app: computed.alias('client'),
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
      const owner = this;
      return Ember.Object.extend({
        unknownProperty(key) {
          if (!owner.isDestroyed && !owner.isDestroying) {
            const service = owner.setupService(key);
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

  setupService(name, { modelName } = {}) {
    const service = this.get('client').service(name);
    const coupledModels = this.get('coupledModels');
    if (coupledModels[name]) {
      return service;
    }
    if (modelName === undefined) {
      const guessedModelName = serviceNameToModelName(name);
      try {
        const store = this.get('store');
        // next instruction will fail if no such model
        store.modelFor(guessedModelName);
        modelName = store.adapterFor(guessedModelName) instanceof FeathersSocketAdapter ? guessedModelName : null;
      } catch (e) {
        modelName = null;
      }
    }
    if (modelName) {
      const config = coupledModels[modelName] = {
        service,
        serviceName: name,
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
   * @param {String} serviceName
   * @param {String} method
   * @param {*} args
   * @returns {RSVP.Promise}
   */
  serviceCall(serviceName, method, ...args) {
    return new RSVP.Promise((resolve, reject) => {
      this.get(`services.${serviceName}`)[method](...args)
        .then(
          run.bind(this, (response) => {
            this.debug && this.debug(
              `[${serviceName}][${method}] sent %O <=> received %O`, args[0], response
            );
            resolve(response);
          }),
          run.bind(this, (error) => {
            this.debug && this.debug(
              `[${serviceName}][${method}] sent %O <=> ERROR %O`, args[0], error
            );
            reject(error);
          })
        );
    });
  },

  handleServiceEvent(serviceName, eventType, modelName, message) {
    this.debug && this.debug(
      `[${serviceName}][${eventType}] received %O`,
      message
    );
    if (modelName) {
      const adapter = this.get('store').adapterFor(modelName);
      adapter instanceof FeathersSocketAdapter && adapter.handleServiceEvent(eventType, modelName, message);
    }
  },

  serviceForModelName(modelName) {
    const coupledModels = this.get('coupledModels');
    if (!coupledModels[modelName]) {
      this.setupService(modelNameToServiceName(modelName), { modelName });
    }
    return coupledModels[modelName].service;
  },

  serviceNameForModelName(modelName) {
    const coupledModels = this.get('coupledModels');
    if (!coupledModels[modelName]) {
      this.setupService(modelNameToServiceName(modelName), { modelName });
    }
    return coupledModels[modelName].serviceName;
  },

  modelNameForService(serviceName) {
    const coupledModels = this.get('coupledModels');
    let modelName = Object.keys(coupledModels).find(key => coupledModels[key].service === serviceName);
    if (!modelName) {
      modelName = serviceNameToModelName(serviceName);
      this.setupService(serviceName, { modelName });
    }
    return modelName;
  },
});
