import Ember from "ember";
import DS from "ember-data";

const { inject, RSVP, run, computed, assert, get, isString } = Ember;

const METHODS_MAP = {
  create: { eventType: 'created', lock: true },
  update: { eventType: 'updated', lock: false },
  patch: { eventType: 'patched', lock: false },
  remove: { eventType: 'removed', lock: true },
};

const RELATIONSHIP_LINK_PARSER = /^\/([a-z0-9_\/-]+)(?:\/([a-z0-9_:-]+)|\?(.+))$/i;

const parseQueryString = (function () {
  const search = /([^&=]+)=?([^&]*)/g;
  const decode = function (s) {
    return decodeURIComponent(s.replace(/\+/g, " "));
  };

  return function parseQueryString(queryString) {
    let match;
    const urlParams = {};
    while ((match = search.exec(queryString))) {
      urlParams[decode(match[1])] = decode(match[2]);
    }
  }
})();

export default DS.Adapter.extend({
  defaultSerializer: '-feathers-socket',

  coalesceFindRequests: true,

  feathers: inject.service(),

  init() {
    this._super(...arguments);
    this.debug = this.get('feathers').debug;
  },

  // required methods when extending an adapter ===============================

  findRecord(store, type, id/*, snapshot*/) {
    return this.serviceCall(type, 'get', id);
  },

  createRecord(store, type, snapshot) {
    const data = this.serialize(snapshot, { includeId: true });
    return this.serviceCall(type, 'create', data);
  },

  updateRecord(store, type, snapshot) {
    const data = this.serialize(snapshot, { includeId: true });
    return this.serviceCall(type, 'patch', snapshot.id, data);
  },

  deleteRecord(store, type, snapshot) {
    //const data = this.serialize(snapshot, { includeId: true });
    return this.serviceCall(type, 'remove', snapshot.id);
  },

  findAll(store, type/*, sinceToken*/) {
    return this.serviceCall(type, 'find', {});
  },

  query(store, type, query/*, recordArray*/) {
    return this.serviceCall(type, 'find', query);
  },

  queryRecord(store, type, query/*, recordArray*/) {
    return this.serviceCall(type, 'find', query)
      .then((response) => {
        const count = get(response, 'data.length');
        assert(`Loaded a unique record but got ${count} records`, count <= 1);
        return response.data[0] || null;
      });
  },

  /*findMany() {

   },*/

  // end of required methods ==================================================


  // able to load relationships from the socket as well

  findBelongsTo(store, snapshot, url/*, relationship*/) {
    const serviceCall = this.urlToServiceCall(url, snapshot.modelName);
    if (serviceCall) {
      return serviceCall()
        .then((response) => {
          if (serviceCall.meta.method === 'find') {
            const count = get(response, 'data.length');
            assert(`Loaded a belongsTo record but got ${count} records`, count <= 1);
            return response.data[0] || null;
          }
          return response;
        });
    }
    return this._super(...arguments);
  },

  findHasMany(store, snapshot, url/*, relationship*/) {
    const serviceCall = this.urlToServiceCall(url);
    if (serviceCall) {
      return serviceCall()
        .then((response) => {
          if (serviceCall.meta.method === 'get') {
            return response ? [response] : [];
          }
          return response;
        });
    }
    return this._super(...arguments);
  },

  findMany(store, type, ids/*, snapshots*/) {
    const { modelName } = type;
    const id = store.serializerFor(modelName).primaryKey;
    return this.serviceCall(modelName, 'find', { query: { [id]: { $in: ids } } });
  },

  urlToServiceCall(url, modelName) {
    let matches, invoker;
    if (url && (matches = url.match(RELATIONSHIP_LINK_PARSER))) {
      const meta = {
        service: matches[1],
        modelName: modelName || this.get('feathers').modelNameForService(matches[1]),
        method: matches[2] ? 'get' : 'find',
        arguments: [matches[2] || parseQueryString(matches[3])],
      };
      invoker = this.serviceCall.bind(this, meta.modelName, meta.method, ...meta.arguments);
      invoker.meta = meta;
    }
    return invoker;
  },


  feathersServiceFor(modelName) {
    return this.get('feathers').serviceForModelName(modelName);
  },

  serviceCall(typeOrModelName, method, ...args) {
    const modelName = isString(typeOrModelName) ? typeOrModelName : typeOrModelName.modelName;
    const service = this.feathersServiceFor(modelName);
    return new RSVP.Promise((resolve, reject) => {
      service[method](...args).then(
        run.bind(this, 'handleServiceResponse', modelName, method, resolve),
        run.bind(this, 'handleServiceError', modelName, method, reject)
      );
    });
  },

  handleServiceResponse(modelName, method, resolver, data) {
    if (METHODS_MAP.hasOwnProperty(method) && METHODS_MAP[method].lock) {
      this.discardOnce(modelName, METHODS_MAP[method].eventType, data);
    }
    resolver(data);
  },

  handleServiceError(modelName, method, rejecter, error) {
    rejecter(error);
  },

  handleServiceEvent(eventType, modelName, message) {
    if (this.shouldDiscard(modelName, eventType, message, true)) {
      this.debug && this.debug(`[${modelName}] discarding one ${eventType} message: %O`, message);
      return;
    }

    const store = this.get('store');
    let id, record;

    switch (eventType) {
      case 'created':
      case 'updated':
      case 'patched':
        store.push(store.normalize(modelName, message));
        break;

      case 'removed':
        id = message[this.primaryKeyOf(modelName)];
        assert('The incoming message must have the id of deleted record but none was found', id);
        record = store.peekRecord(modelName, id);
        record && store.unloadRecord(record);
        break;

      default:
        assert(`Unknown event type: ${eventType}`);
    }
  },

  discarded: computed({
    get() {
      return {
        created: Object.create(null),
        updated: Object.create(null),
        patched: Object.create(null),
        removed: Object.create(null),
      };
    }
  }).readOnly(),

  discardOnce(modelName, eventType, data) {
    const { discarded, key } = this.discardedMeta(modelName, eventType, data);
    if (discarded[key]) {
      discarded[key]++;
    } else {
      discarded[key] = 1;
    }
  },

  shouldDiscard(modelName, eventType, data, willDiscard = false) {
    const { discarded, key } = this.discardedMeta(modelName, eventType, data);
    let shouldDiscard = (discarded[key] || 0) > 0;

    if (shouldDiscard && willDiscard) {
      if (--discarded[key] === 0) {
        delete discarded[key];
      }
    }

    return shouldDiscard;
  },


  discardedMeta(modelName, eventType, data) {
    const discarded = this.get('discarded')[eventType];
    const id = data[this.primaryKeyOf(modelName)];
    const key = modelName + ':' + id;
    assert("Returned message should have an id", id);
    return { discarded, key };
  },

  primaryKeyOf(modelName) {
    const cache = this._primaryKeyOf || (this._primaryKeyOf = Object.create(null));
    if (!cache[modelName]) {
      return cache[modelName] = this.get('store').serializerFor(modelName).primaryKey;
    }
    return cache[modelName];
  },
});
