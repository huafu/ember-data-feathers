import Ember from "ember";
import { io, default as feathers } from "feathers";
import FeathersSocketAdapter from "../adapters/feathers-socket";

const { computed, inject, run, String:{ pluralize, singularize }, RSVP, isArray } = Ember;

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
  queueMethodCalls: computed.reads('config.queueMethodCalls'),

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
      const socket = this.get('socket');
      socket.on('pong', run.bind(this, 'handlePing'));
      return feathers()
        .configure(feathers.socketio(socket))
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

  handlePing() {
    if (!this.isDestroyed) {
      this.set('lastPing', Date.now());
    }
  },

  _stats: computed({
    get() {
      return [];
    },
  }),

  stats: computed({
    get() {
      const stats = this.get('_stats');
      const timeSum = (items) => items.mapBy('time').reduce((sum, t) => sum + t, 0);
      const timeAvg = (items) => timeSum(items) / items.length;
      const mapBy = (items, key) => {
        return items.reduce((map, stat) => {
          if (!map[stat[key]]) {
            map[stat[key]] = [stat];
          } else {
            map[stat[key]].push(stat);
          }
          return map;
        }, {});
      };
      const compute = (items) => {
        if (isArray(items)) {
          return {
            count: items.length,
            errorCount: items.filterBy('error', true).length,
            successCount: items.filterBy('error', false).length,
            timeAverage: timeAvg(items),
            timeTotal: timeSum(items),
          };
        }
        const set = {};
        Object.keys(items).forEach(key => set[key] = compute(items[key]));
        return set;
      };

      const res = compute(stats);
      res.services = compute(mapBy(stats, 'service'));
      res.methods = compute(mapBy(stats, 'method'));
      return res;
    }
  }).readOnly().volatile(),

  _runningProcess: RSVP.resolve(),
  enqueue(process) {
    if (!this.get('queueMethodCalls')) {
      return process();
    }
    return this._runningProcess = this._runningProcess
      .then(process)
      .catch((error) => {
        this._runningProcess = process();
        return RSVP.reject(error);
      });
  },

  lastPing: null,
  lastEvent: null,
  _isRunning: 0,
  isRunning: computed({
    get() {
      return this.get('_isRunning') > 0;
    },
    set(key, value) {
      return this.incrementProperty('_isRunning', value ? 1 : -1) > 0;
    }
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
    return this.enqueue(() => {
      return new RSVP.Promise((resolve, reject) => {
        const stat = Object.create(null);
        stat.service = serviceName;
        stat.method = method;
        stat.start = Date.now();
        const logStat = (isError) => {
          stat.end = Date.now();
          stat.time = stat.end - stat.start;
          stat.error = isError;
          this.get('_stats').push(stat);
        };
        this.set('isRunning', true);
        this.get(`services.${serviceName}`)[method](...args)
          .then(
            run.bind(this, (response) => {
              logStat(false);
              this.set('isRunning', false);
              this.debug && this.debug(
                `[${serviceName}][${method}] sent %O <=> received %O in ${Math.round(stat.time)}ms`, args[0], response
              );
              resolve(response);
            }),
            run.bind(this, (error) => {
              logStat(true);
              this.set('isRunning', false);
              this.debug && this.debug(
                `[${serviceName}][${method}] sent %O <=> ERROR %O in ${Math.round(stat.time)}ms`, args[0], error
              );
              reject(error);
            })
          );
      });
    });
  },

  handleServiceEvent(serviceName, eventType, modelName, message) {
    this.set('lastEvent', Date.now());
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
