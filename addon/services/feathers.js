/* globals io */
import Ember from 'ember';
import { default as feathers } from 'feathers';
import FeathersSocketAdapter from '../adapters/feathers-socket';

const { computed, inject, run, String: { pluralize, singularize }, RSVP, isArray } = Ember;

const DEFAULT_SOCKET_OPTIONS = { timeout: 10000 };
const TIMEOUT_REGEXP = /^Timeout of \d+ms /;
const EVENT_TYPES = ['created', 'updated', 'patched', 'removed'];

export function modelNameToServiceName(modelName) {
  return pluralize(modelName);
}
export function serviceNameToModelName(modelName) {
  return singularize(modelName);
}

function uniqueItemOrAll(array) {
  return array.length === 1 ? array[0] : array;
}

/**
 * @class ServiceMeta
 * @property {ServiceRegistry} registry
 * @property {String} name
 * @property {String} modelName
 * @property {Object} service
 * @property {{created: Function, updated: Function, patched: Function, removed: Function}} eventHandlers
 *
 * @method {RSVP.Promise} find({{}} params)
 * @method {RSVP.Promise} get({String} id, {{}} [params])
 * @method {RSVP.Promise} create({{}} data, {{}} [params])
 * @method {RSVP.Promise} update({String} id, {{}} data, {{}} [params])
 * @method {RSVP.Promise} patch({String} id, {{}} data, {{}} [params])
 * @method {RSVP.Promise} remove({String} id, {{}} [params])
 */
class ServiceMeta {
  /**
   * Constructor for ServiceMeta
   * @param {ServiceRegistry} registry
   * @param {String} name
   * @param {String} modelName
   * @param {Object} service
   * @param {Function} eventsHandler
   */
  constructor(registry, { name, modelName, service, eventsHandler }) {
    const store = registry.owner.get('store');

    this.name = name;
    this.service = service;
    this.eventHandlers = Object.create(null);
    EVENT_TYPES.forEach((type) => {
      this.eventHandlers[type] = eventsHandler.bind(null, this, type);
    });
    this.registry = registry;
    this.owner = registry.owner;

    // guess the model name if not defined and not specifically set to null
    if (modelName === undefined) {
      const guessedModelName = serviceNameToModelName(name);
      try {
        // next instruction will fail if no such model
        store.modelFor(guessedModelName);
        modelName = store.adapterFor(guessedModelName) instanceof FeathersSocketAdapter ? guessedModelName : null;
      } catch (e) {
        modelName = null;
      }
    }
    this.setModelName(modelName, store).setupEvents();
    this.owner.debug && this.owner.debug(
      `Registered service '${this.name}' ${this.modelName ?
        `linked to model '${this.modelName}'` : '(no model linked)'}.`
    );
  }


  /**
   * Sets the model name
   * @private
   * @param {String} modelName
   * @param {DS.Store} [store]
   * @return {ServiceMeta}
   */
  setModelName(modelName, store = this.registry.owner.get('store')) {
    if (modelName) {
      this.modelName = modelName;
      this.storeAdapter = store.adapterFor(modelName);
    }
    return this;
  }

  /**
   * Setup events
   * @private
   * @return {ServiceMeta}
   */
  setupEvents() {
    EVENT_TYPES.forEach((eventType) => {
      this.service.on(eventType, this.eventHandlers[eventType]);
    });
    this.owner.debug && this.owner.debug(`Listening for events on '${this.name}' service (${EVENT_TYPES.join(', ')}).`);
    return this;
  }

  /**
   * Teardown events
   * @private
   * @return {ServiceMeta}
   */
  teardownEvents() {
    EVENT_TYPES.forEach((eventType) => {
      this.service.removeListener(eventType, this.eventHandlers[eventType]);
    });
    return this;
  }

  /**
   * Registers an handler
   * @param {String} eventType
   * @param {Function} handler
   * @return {*}
   */
  on(eventType, handler) {
    return this.service.on(eventType, run.bind(null, handler));
  }

  /**
   * Unregisters an handler
   * @param {String} eventType
   * @param {Function} handler
   * @return {*}
   */
  off(eventType, handler) {
    if (!handler) {
      throw new TypeError('You must give the same handler as you gave when calling `on()`');
    }
    return this.service.removeListener(eventType, handler);
  }

}

['find', 'get', 'create', 'update', 'patch', 'remove'].forEach((method) => {
  Object.defineProperty(ServiceMeta.prototype, method, {
    value: function (...args) {
      const { service } = this;
      return new RSVP.Promise((resolve, reject) => {
        service[method](...args).then(run.bind(null, resolve), run.bind(null, reject));
      });
    }
  })
});

/**
 * @class ServiceRegistry
 * @extends {Array}
 * @property {FeathersService} owner
 * @property {Object} nameIndex
 * @property {Object} modelNameIndex
 */
class ServiceRegistry extends Array {
  constructor(owner) {
    super();
    this.owner = owner;
    this.nameIndex = Object.create(null);
    this.modelNameIndex = Object.create(null);
  }

  /**
   * Registers a service and attach handlers to it
   * @param {String} name
   * @param {String} modelName
   * @param {Object} service
   * @param {Function} eventsHandler
   * @return {ServiceMeta}
   */
  register(name, { modelName, service, eventsHandler }) {
    if (!name || !service) {
      throw new TypeError('`name` and/or `service` mandatory arguments were not specified');
    }
    let item = this.nameIndex[name];
    if (item && modelName) {
      if (item.modelName) {
        if (item.modelName !== modelName) {
          throw new Error(`Given model name '${modelName}' does not match the old one: '${item.modelName}'.`);
        }
      } else {
        this.modelNameIndex[modelName] = item.setModelName(modelName);
      }
    } else if (!item) {
      this.push(
        item = new ServiceMeta(this, { service, modelName, name, eventsHandler })
      );
      this.nameIndex[name] = item;
      if (modelName) {
        this.modelNameIndex[modelName] = item;
      }
    }
    return item
  }

  /**
   * Unregisters a service and remove listeners
   * @param {String} name
   * @return {ServiceMeta}
   */
  unregister(name) {
    const item = this.nameIndex[name];
    if (item) {
      const index = this.indexOf(item);
      delete this.nameIndex[name];
      if (item.modelName) {
        delete this.modelNameIndex[item];
      }
      this.splice(index, 1);
      item.teardownEvents();
      Object.freeze && Object.freeze(item);
    }
    return item;
  }

  /**
   * Gets a service meta by service name
   * @param {String} name
   * @return {ServiceMeta}
   */
  forName(name) {
    return this.nameIndex[name];
  }

  /**
   * Gets a service meta by model name
   * @param {String} modelName
   * @return {ServiceMeta}
   */
  forModelName(modelName) {
    return this.modelNameIndex[modelName];
  }

  /**
   * Unregisters all services, removing all listeners
   * @return {ServiceRegistry}
   */
  unregisterAll() {
    const names = Object.keys(this.nameIndex);
    names.forEach(this.unregister.bind(this));
    return this;
  }
}

/**
 * @class EventsQueue
 * @extends {Ember.Object}
 */
const EventsQueue = Ember.Object.extend({
  /**
   * @type {Array.<EventsQueueItem>}
   */
  _items: computed({
    get(){
      return [];
    }
  }),

  schedule(callback, detail) {
    this.get('_items').unshift({ detail, callback, since: Date.now() });
    run.schedule('afterRender', this, '_start');
    return this;
  },

  paused: computed({
    get() {
      return (this._paused || 0) > 0;
    },
    set(key, value) {
      const oldPaused = this.cacheFor(key) || 0;
      this._paused = (this._paused || 0) + (value ? 1 : -1);
      value = this._paused > 0;
      if (oldPaused !== value && !value) {
        run.schedule('afterRender', this, '_start');
      }
      return value;
    }
  }),

  isIdle: computed('_items.length', 'paused', function () {
    return !this.get('paused') && !this.get('_items.length')
  }),

  pause() {
    this.set('paused', true);
    return this;
  },

  start() {
    this.set('paused', false);
    return this;
  },

  _start() {
    if (this.get('paused') || !this.owner || this.owner.isDestroyed || this.owner.isDestroying) {
      return;
    }
    const next = this.get('_items').pop();
    if (next) {
      if (next.callback) {
        run.schedule('actions', next.callback);
      }
      run.schedule('actions', this, '_start');
    }
  },

});

/**
 * @class EventsQueueItem
 * @property {String} direction
 * @property {String} kind
 * @property {String} service
 * @property {Object} message
 * @property {Function} callback
 */

/**
 * @class FeathersService
 * @extends {Ember.Service}
 * @mixes {Ember.Evented}
 */
export default Ember.Service.extend(Ember.Evented, {
  store: inject.service(),

  config: computed.readOnly('appConfig.feathers'),
  socketUrl: computed.reads('config.socketUrl'),
  updateUsesPatch: computed.reads('config.updateUsesPatch'),
  socketOptions: computed.reads('config.socketOptions'),
  collectStats: computed.reads('config.collectStatistics'),

  socket: computed('socketUrl', {
    get() {
      return io(this.get('socketUrl'), this.get('socketOptions') || DEFAULT_SOCKET_OPTIONS);
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
      ['pong', 'connect', 'disconnect', 'error'].forEach((type) => {
        socket.on(type, run.bind(this, 'handleSocketManagerEvent', type));
      });
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

  handleSocketManagerEvent(eventType) {
    if (this.isDestroyed || this.isDestroying) {
      return;
    }
    this.debug && this.debug('socket.core-event', ...arguments);
    switch (eventType) {
    case 'error':
      this.touch('error');
      break;
    case 'connect':
      this.set('isOnline', true);
      break;
    case 'disconnect':
      this.set('isOnline', false);
      break;
    case 'pong':
      this.touch('pong');
      break;
    }
  },

  isOffline: computed.not('isOnline'),
  isOnline: computed({
    get() {
      return false;
    },
    set(key, value){
      const old = this.cacheFor(key);
      const val = !!value;
      if (old !== val) {
        this.trigger(`became${value ? 'Online' : 'Offline'}`, old);
      }
      return val;
    }
  }),

  last: computed(function () {
    return {};
  }),
  touch(what) {
    const now = Date.now();
    this.setProperties({ [`last.${what}`]: now, beat: now });
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
      const timeoutsSum = (items) => items.mapBy('timeouts').reduce((sum, t) => sum + t, 0);
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
          const errorCount = items.filterBy('error').length;
          const count = items.length;
          return {
            count,
            errorCount,
            successCount: count - errorCount,
            timeAverage: timeAvg(items),
            timeTotal: timeSum(items),
            timeouts: timeoutsSum(items),
          };
        }
        const set = {};
        Object.keys(items).forEach(key => set[key] = compute(items[key]));
        return set;
      };

      const res = compute(stats);
      res.services = compute(mapBy(stats, 'service'));
      res.methods = compute(mapBy(stats, 'method'));
      res.all = stats;
      return res;
    }
  }).readOnly().volatile(),

  /**
   * @type {Array<EventsQueueItem>}
   */
  eventsQueue: computed(function () {
    return EventsQueue.create({ owner: this });
  }),

  runningPromise: null,
  isIdle: computed('runningPromise', 'eventsQueue.isIdle', function () {
    return !this.get('runningPromise') && this.get('eventsQueue.isIdle');
  }),
  isRunning: computed.not('isIdle'),


  /**
   * @type {ServiceRegistry}
   */
  servicesRegistry: computed(function () {
    return new ServiceRegistry(this);
  }),

  services: computed(function () {
    const owner = this;
    return Ember.Object.extend({
      unknownProperty(key) {
        if (!owner.isDestroyed && !owner.isDestroying) {
          return this.set(key, owner.setupService(key));
        }
      },
    }).create();
  }).readOnly(),


  destroy() {
    const socket = this.cacheFor('socket');
    const registry = this.cacheFor('servicesRegistry');
    if (registry) {
      registry.unregisterAll();
    }
    if (socket) {
      socket.close();
    }
    this._super(...arguments);
  },

  /**
   * Setup a service
   * @param {String} name
   * @param {String} [modelName]
   * @return {ServiceMeta}
   */
  setupService(name, { modelName } = {}) {
    const service = this.get('client').service(name);
    const registry = this.get('servicesRegistry');
    return registry.register(name, { service, modelName, eventsHandler: run.bind(this, '_handleServiceEvent') });
  },

  /**
   * Make a service call
   * @param {String} serviceName
   * @param {String} method
   * @param {*} args
   * @returns {RSVP.Promise}
   */
  serviceCall(serviceName, method, ...args) {
    const queue = this.get('eventsQueue');
    return this.set('runningPromise', new RSVP.Promise((resolve, reject) => {
      const callback = run.bind(this, '_serviceCall', { serviceName, method, args }, resolve, reject);
      queue.schedule(callback, { service: serviceName, method });
    }));
  },

  _serviceCall({ serviceName, method, args }, resolve, reject) {
    const queue = this.get('eventsQueue');
    const gatherStats = this.get('collectStats');
    queue.pause();
    const stat = Object.create(null);
    stat.service = serviceName;
    stat.method = method;
    stat.timeouts = 0;
    stat.start = Date.now();
    const logStat = (error) => {
      stat.end = Date.now();
      stat.time = stat.end - stat.start;
      stat.error = error;
      if (error && error.isTimeout) {
        stat.timeouts++;
      }
      if (gatherStats) {
        this.get('_stats').push(stat);
      }
    };

    this.get(`services.${serviceName}`)[method](...args)
      .then((response) => {
        logStat();
        this.touch('response');
        this.debug && this.debug(
          `[${serviceName}][${method}] sent %O <=> received %O in ${Math.round(stat.time)}ms`,
          uniqueItemOrAll(args),
          response
        );
        return resolve(response);
      })
      .catch((error) => {
          error.isTimeout = TIMEOUT_REGEXP.test(error.message);
          logStat(error);
          this.touch('error');
          this.debug && this.debug(
            `[${serviceName}][${method}] sent %O <=> ERROR %O in ${Math.round(stat.time)}ms`,
            uniqueItemOrAll(args),
            error
          );
          reject(error);
        }
      )
      .finally(() => {
        this.set('runningPromise', null);
        queue.start();
      });
  },

  /**
   * Handles a service event
   * @param {ServiceMeta} meta
   * @param {String} eventType
   * @param {*} message
   */
  _handleServiceEvent(meta, eventType, message) { // eslint-disable-line no-unused-vars
    this.get('eventsQueue').schedule(
      run.bind(this, 'handleServiceEvent', ...arguments),
      { service: meta.name, eventType }
    );
  },

  /**
   * Handles a service event
   * @param {ServiceMeta} meta
   * @param {String} eventType
   * @param {*} message
   */
  handleServiceEvent(meta, eventType, message)
  {
    this.touch('event');
    this.debug && this.debug(`[${meta.name}][${eventType}] received %O`, message);
    if (meta.modelName) {
      meta.storeAdapter instanceof FeathersSocketAdapter && meta.storeAdapter.handleServiceEvent(
        eventType,
        meta.modelName,
        message
      );
    }
  },

  /**
   * Returns the service for a given model name
   * @param {String} modelName
   * @return {ServiceMeta}
   */
  serviceForModelName(modelName)
  {
    const registry = this.get('servicesRegistry');
    const meta = registry.forModelName(modelName);
    return meta || this.setupService(modelNameToServiceName(modelName), { modelName });
  },

  /**
   * Gets the service name associated with given model name
   * @param {String} modelName
   * @return {String}
   */
  serviceNameForModelName(modelName)
  {
    return (this.serviceForModelName(modelName) || {}).name;
  },

  /**
   * Returns the model name associated with given service mame
   * @param {String} serviceName
   * @return {String}
   */
  modelNameForServiceName(serviceName)
  {
    const registry = this.get('servicesRegistry');
    const meta = registry.forName(serviceName);
    return (meta || this.setupService(serviceName)).modelName;
  },

  /**
   * Authenticate
   * @param {String|Array.<String>} strategy
   * @return {Promise.<*>}
   */
  authenticate(strategy) {
    return new RSVP.Promise((resolve, reject) => {
      this.get('client').authenticate(strategy)
        .then(run.bind(null, resolve), run.bind(null, reject));
    });
  },

  /**
   * Logout sending the extra data if necessary
   * @param {*} [data]
   * @return {Promise.<*>}
   */
  logout(data) {
    return new RSVP.Promise((resolve, reject) => {
      this._logoutData = data;
      this.get('client').logout()
        .then(run.bind(null, resolve), run.bind(null, reject));
    });
  },
});
