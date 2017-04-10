import Ember from 'ember';
import DS from 'ember-data';
import ERRORS from '../utils/feathers/errors';

const { inject, RSVP, run, computed, assert, get, typeOf } = Ember;


const METHODS_MAP = {
  create: { eventType: 'created', lock: true },
  update: { eventType: 'updated', lock: false },
  patch: { eventType: 'patched', lock: false },
  remove: { eventType: 'removed', lock: true },
};

const RELATIONSHIP_LINK_PARSER = /^\/([a-z0-9_\/-]+)(?:\/([a-z0-9_:-]+)|\?(.+))$/i;

const parseQueryString = (function () {
  const setValue = function (root, path, value) {
    if (path.length > 1) {
      const dir = path.shift();
      if (typeof root[dir] == 'undefined') {
        root[dir] = path[0] == '' ? [] : {};
      }

      arguments.callee(root[dir], path, value);
    } else {
      if (root instanceof Array) {
        root.push(value);
      } else {
        root[path] = value;
      }
    }
  };
  return function parseQueryString(query) {
    const nvp = query.split('&');
    const data = {};
    for (let i = 0; i < nvp.length; i++) {
      const pair = nvp[i].split('=');
      const name = decodeURIComponent(pair[0]);
      const value = decodeURIComponent(pair[1]);

      let path = name.match(/(^[^\[]+)(\[.*\]$)?/);
      const first = path[1];
      if (path[2]) {
        //case of 'array[level1]' || 'array[level1][level2]'
        path = path[2].match(/(?=\[(.*)\]$)/)[1].split('][')
      } else {
        //case of 'name'
        path = [];
      }
      path.unshift(first);

      setValue(data, path, value);
    }
    return data;
  }
})();

/**
 * @class FeathersSocketAdapter
 * @extends {DS.Adapter}
 */
export default DS.Adapter.extend({
  defaultSerializer: '-feathers-socket',

  coalesceFindRequests: true,

  feathers: inject.service(),

  debug() {
    const feathers = this.get('feathers');
    feathers.debug && feathers.debug(...arguments);
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
    return this.serviceCall(type, this.get('feathers.updateUsesPatch') ? 'patch' : 'update', snapshot.id, data);
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


  findMany(store, type, ids/*, snapshots*/) {
    const { modelName } = type;
    const id = store.serializerFor(modelName).primaryKey;
    return this.serviceCall(modelName, 'find', { query: { [id]: { $in: ids } } });
  },


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

  urlToServiceCall(url, modelName) {
    let matches, invoker;
    if (url && (matches = url.match(RELATIONSHIP_LINK_PARSER))) {
      const meta = {
        service: matches[1],
        modelName: modelName || this.get('feathers').modelNameForServiceName(matches[1]),
        method: matches[2] ? 'get' : 'find',
        arguments: [matches[2] || parseQueryString(decodeURI(matches[3]))],
      };
      invoker = this.serviceCall.bind(this, meta.modelName, meta.method, ...meta.arguments);
      invoker.meta = meta;
    }
    return invoker;
  },


  feathersServiceFor(modelName) {
    return this.get('feathers').serviceForModelName(modelName);
  },


  feathersServiceNameFor(modelName) {
    return this.get('feathers').serviceNameForModelName(modelName);
  },

  serviceCall(typeOrModelName, methodName, ...args) {
    const modelName = typeOf(typeOrModelName) === 'string' ? typeOrModelName : typeOrModelName.modelName;
    const serviceName = this.feathersServiceNameFor(modelName);
    return this.get('feathers')
      .serviceCall(serviceName, methodName, ...args)
      .then(
        (response) => run(this, 'handleServiceResponse', response, { modelName, methodName }),
        (error) => run(this, 'handleServiceError', error, { modelName, methodName })
      );
  },

  handleServiceResponse(data, { modelName, methodName }) {
    if (METHODS_MAP.hasOwnProperty(methodName) && METHODS_MAP[methodName].lock) {
      this.discardOnce(modelName, METHODS_MAP[methodName].eventType, data);
    }
    return data;
  },

  // - `DS.InvalidError`
  // - `DS.TimeoutError`
  // - `DS.AbortError`
  // - `DS.UnauthorizedError`
  // - `DS.ForbiddenError`
  // - `DS.NotFoundError`
  // - `DS.ConflictError`
  // - `DS.ServerError`
  handleServiceError(error, { modelName, methodName }) {
    // TODO: make the error more ember friendly
    let err = error;
    if (error.name && ERRORS[error.name]) {
      const msg = this.get('feathers.appConfig.environment') === 'development'
        ? `${error.message} [${modelName}#${methodName}]`
        : error.message;
      err = new ERRORS[error.name](toJsonApiErrors(error), msg);
      err.originalError = error;
    }
    return RSVP.reject(err);
  },

  handleServiceEvent(eventType, modelName, message) {
    if (this.shouldDiscard(modelName, eventType, message, true)) {
      this.debug(`[${modelName}] discarding one ${eventType} message: %O`, message);
      return;
    }

    const store = this.get('store');
    let id, record, an;

    switch (eventType) {
    case 'created':
    case 'updated':
    case 'patched':
      if (eventType === 'patched' && !store.peekRecord(modelName, message[this.primaryKeyOf(modelName)])) {
        this.debug(
          `[${modelName}] NOT pushing a patched record that is not present in the store: %O`,
          message
        );
        break;
      }
      an = eventType === 'updated' ? 'an' : 'a';
      this.debug(`[${modelName}] pushing ${an} ${eventType} record into the store: %O`, message);
      run.schedule('afterRender', store, 'push', store.normalize(modelName, message));
      break;

    case 'removed':
      id = message[this.primaryKeyOf(modelName)];
      assert('The incoming message must have the id of deleted record but none was found', id);
      this.debug(`[${modelName}] unloading a deleted record from the store: %O`, message);
      record = store.peekRecord(modelName, id);
      record && run.schedule('afterRender', store, 'unloadRecord', record);
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
    assert('Returned message should have an id', id);
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

function toJsonApiErrors(owner) {
  const { errors } = owner;
  if (errors) {
    return Object.keys(errors).map((key) => {
      const error = errors[key];
      const normalized = { meta: {} };
      if (owner && owner.type === 'FeathersError') {
        normalized.status = owner.code;
        normalized.meta.className = owner.className;
        normalized.meta.data = owner.data;
      }
      normalized.title = error.name;
      normalized.detail = error.message;
      if (error.path) {
        normalized.meta.path = error.path;
        normalized.source = {
          pointer: `/data/attributes/${error.path.split('.').shift()}`,
        }
      }

      return normalized;
    });
  }
}
